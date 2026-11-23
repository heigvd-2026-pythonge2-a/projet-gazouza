"""Subprocess runner for executing SPICE netlists with bundled ngspice."""

import math
import os
import re
import subprocess
import sys
import tempfile
from collections import deque
from pathlib import Path

from app.engines.locator import NgspiceNotFoundError, locate_ngspice
from app.engines.parser import MAX_RESULT_POINTS, parse_ngspice_output, resolve_dc_source_name
from app.models.netlist import (
    ComponentTarget,
    Diagnostic,
    DiagnosticCode,
    NetlistResult,
    NetTarget,
    Target,
)
from app.models.simulation import (
    Analysis,
    DcAnalysis,
    OpAnalysis,
    SimulationResult,
    TranAnalysis,
)

DEFAULT_TIMEOUT_SECONDS: float = 10.0
MAX_NETLIST_BYTES: int = 1_048_576
MAX_RAWFILE_BYTES: int = 50 * 1024 * 1024

_CIRCUIT_FILENAME = "circuit.cir"
_RAWFILE_FILENAME = "output.raw"
_SAVE_ITEMS_PER_LINE = 10
_FORBIDDEN_DIRECTIVES: frozenset[str] = frozenset(
    {".control", ".endc", ".include", ".lib", ".shell", "shell"}
)
_FORBIDDEN_PREFIXES: tuple[str, ...] = (".inc", ".lib")
_CONTROL_DIRECTIVE = ".control"
_MIN_CONTROL_PREFIX_LEN = 5


class UnsafeNetlistError(ValueError):
    """Raised when a SPICE netlist contains unsafe or forbidden directives."""

    def __init__(self, message: str, *, user_message: str | None = None) -> None:
        super().__init__(message)
        self.user_message = user_message or message


_CHECK_BRANCH_RE = re.compile(r"check\s+nodes?\s+([A-Za-z0-9_]+)#branch\b", re.IGNORECASE)
_ANY_BRANCH_RE = re.compile(r"\b([A-Za-z0-9_]+)#branch\b", re.IGNORECASE)
_CHECK_NODE_RE = re.compile(r"check\s+nodes?\s+([^\s,;]+)", re.IGNORECASE)
_TROUBLE_INSTANCE_RE = re.compile(
    r"trouble\s+with\s+(?:[A-Za-z0-9_]+-)?instance\s+([A-Za-z0-9_]+)", re.IGNORECASE
)


def _error_result(
    analysis: Analysis,
    code: DiagnosticCode,
    message: str,
    warnings: list[Diagnostic],
    *,
    targets: list[Target] | None = None,
) -> SimulationResult:
    """Build a failed SimulationResult preserving any netlist warnings."""
    return SimulationResult(
        analysis=analysis.kind,
        errors=[
            Diagnostic(
                code=code,
                message=message,
                targets=list(targets) if targets else [],
            )
        ],
        warnings=list(warnings),
    )


def _collect_save_tokens(
    components: dict[str, str],
    existing_tokens: set[str],
) -> list[str]:
    """Build missing .save tokens for node voltages and component branch currents."""
    needed: list[str] = []
    seen = set(existing_tokens)

    if "all" not in seen:
        needed.append("all")
        seen.add("all")

    for spice_name in components:
        comp_lower = spice_name.strip().lower()
        # Voltage sources and inductors are already saved by `all` as `i(v*)` / `i(l*)`.
        if not comp_lower or comp_lower.startswith(("v", "l")):
            continue
        if comp_lower.startswith("d"):
            token = f"@{comp_lower}[id]"
        elif comp_lower.startswith("i"):
            token = f"@{comp_lower}[c]"
        else:
            token = f"@{comp_lower}[i]"
        if token not in seen:
            needed.append(token)
            seen.add(token)

    return needed


def _format_save_lines(tokens: list[str]) -> list[str]:
    """Format .save tokens into SPICE lines, wrapping long lists with '+' continuations."""
    if not tokens:
        return []

    lines: list[str] = []
    for start in range(0, len(tokens), _SAVE_ITEMS_PER_LINE):
        chunk = " ".join(tokens[start : start + _SAVE_ITEMS_PER_LINE])
        prefix = ".save " if start == 0 else "+ "
        lines.append(f"{prefix}{chunk}")
    return lines


def _is_forbidden_first_token(token: str) -> bool:
    """Return True if a lowercased first token is a forbidden SPICE/ngspice command."""
    base_token = token.split(";", 1)[0]
    if base_token in _FORBIDDEN_DIRECTIVES or base_token.startswith(_FORBIDDEN_PREFIXES):
        return True
    return len(base_token) >= _MIN_CONTROL_PREFIX_LEN and _CONTROL_DIRECTIVE.startswith(base_token)


def _unfold_spice_lines(netlist: str) -> tuple[list[str], list[str]]:
    """Unfold SPICE '+' continuations logically, ignoring '*' comment lines.

    Returns both standard space-joined logical lines and compact-joined lines (without
    inserting spaces when '+' has no following whitespace) to catch split tokens.
    """
    normalized = netlist.replace("\r\n", "\n").replace("\r", "\n")
    spaced_lines: list[str] = []
    compact_lines: list[str] = []

    for raw_line in normalized.splitlines():
        stripped = raw_line.strip().lstrip("\ufeff").strip()
        if not stripped or stripped.startswith("*"):
            continue

        if stripped.startswith("+"):
            after_plus = stripped[1:]
            continuation = after_plus.strip()
            if not continuation:
                continue
            if spaced_lines:
                spaced_lines[-1] = f"{spaced_lines[-1]} {continuation}"
                if not after_plus[0].isspace():
                    compact_lines[-1] = f"{compact_lines[-1]}{continuation}"
                else:
                    compact_lines[-1] = f"{compact_lines[-1]} {continuation}"
            else:
                spaced_lines.append(continuation)
                compact_lines.append(continuation)
        else:
            spaced_lines.append(stripped)
            compact_lines.append(stripped)

    return spaced_lines, compact_lines


def validate_netlist_safety(netlist: str) -> None:
    """Validate that a SPICE netlist contains no null bytes or forbidden directives.

    Raises:
        UnsafeNetlistError: If null bytes or forbidden commands (``.control`` or
            ngspice prefixes >=5 chars, ``.endc``, ``.shell``, ``shell``, ``.include`` /
            ``.inc*`` prefixes >=4 chars, or ``.lib`` / ``.lib*``) are found.
    """
    if "\x00" in netlist:
        raise UnsafeNetlistError(
            "Null byte detected in SPICE netlist.",
            user_message="La netlist SPICE contient un caractère nul interdit.",
        )

    spaced_lines, compact_lines = _unfold_spice_lines(netlist)
    for line in (*spaced_lines, *compact_lines):
        first_token = line.split()[0]
        if _is_forbidden_first_token(first_token.lower()):
            raise UnsafeNetlistError(
                f"Forbidden SPICE directive or command: {first_token!r}.",
                user_message=(
                    f"La directive SPICE « {first_token} » n'est pas autorisée "
                    "pour des raisons de sécurité."
                ),
            )


def prepare_netlist(netlist_result: NetlistResult) -> str:
    """Prepare a netlist string for ngspice batch execution.

    Validates safety, preserves the SPICE title line and existing analysis directives,
    injects any missing ``.save`` tokens for node voltages and component branch currents
    before ``.end``, and terminates cleanly with ``.end``.
    """
    if not netlist_result.netlist.strip():
        raise ValueError("Cannot prepare an empty netlist.")

    validate_netlist_safety(netlist_result.netlist)

    normalized = netlist_result.netlist.replace("\r\n", "\n").replace("\r", "\n")
    raw_lines = normalized.splitlines()

    # Preserve line 0 intact because SPICE treats the first line as the circuit title.
    body_lines: list[str] = [raw_lines[0]]
    existing_save_tokens: set[str] = set()
    in_existing_save = False

    for line in raw_lines[1:]:
        stripped = line.strip()
        if not stripped:
            in_existing_save = False
            body_lines.append(line)
            continue

        if stripped.startswith("*"):
            in_existing_save = False
            body_lines.append(line)
            continue

        if in_existing_save and stripped.startswith("+"):
            existing_save_tokens.update(tok.lower() for tok in stripped[1:].split())
            body_lines.append(line)
            continue

        in_existing_save = False
        first_token = stripped.split()[0].lower()

        if first_token == ".end":
            break

        if first_token == ".save":
            in_existing_save = True
            existing_save_tokens.update(tok.lower() for tok in stripped.split()[1:])
            body_lines.append(line)
            continue

        body_lines.append(line)

    while len(body_lines) > 1 and not body_lines[-1].strip():
        body_lines.pop()

    save_tokens = _collect_save_tokens(netlist_result.components, existing_save_tokens)
    body_lines.extend(_format_save_lines(save_tokens))
    body_lines.append(".end")

    return "\n".join(body_lines) + "\n"


def _find_matching_component(
    candidate: str,
    components: dict[str, str],
) -> tuple[str, str] | None:
    """Resolve a case-insensitive SPICE element name to (spice_name, component_id)."""
    target = candidate.strip().lower()
    for spice_name, component_id in components.items():
        if target and spice_name.lower() == target:
            return spice_name, component_id
    return None


def _find_matching_net(
    candidate: str,
    nets: dict[str, list[str]],
) -> str | None:
    """Resolve a case-insensitive SPICE node name to its key in NetlistResult.nets."""
    target = candidate.strip().lower()
    for net_name in nets:
        if target and net_name.lower() == target:
            return net_name
    return None


def _find_vl_loop_components(
    netlist: str,
    components: dict[str, str],
    seed_comp_ids: set[str],
) -> list[tuple[str, str]]:
    """Find voltage sources and inductors participating in a SPICE loop via 2-core pruning."""
    lines = netlist.replace("\r\n", "\n").replace("\r", "\n").splitlines()
    edges: list[tuple[str, str, str, str]] = []
    for line in lines[1:]:
        stripped = line.strip()
        if not stripped or stripped.startswith(("*", ".", "+")):
            continue
        tokens = stripped.split()
        if len(tokens) < 3 or not tokens[0].lower().startswith(("v", "l")):
            continue
        resolved = _find_matching_component(tokens[0], components)
        if resolved is not None:
            spice_name, comp_id = resolved
            edges.append((tokens[1].lower(), tokens[2].lower(), spice_name, comp_id))

    if not edges:
        return []

    adj: dict[str, list[tuple[int, str]]] = {}
    degree: dict[str, int] = {}
    for idx, (u, v, _, _) in enumerate(edges):
        adj.setdefault(u, []).append((idx, v))
        adj.setdefault(v, []).append((idx, u))
        degree[u] = degree.get(u, 0) + 1
        degree[v] = degree.get(v, 0) + 1

    active_edges = set(range(len(edges)))
    queue = deque(node for node, deg in degree.items() if deg <= 1)
    while queue:
        node = queue.popleft()
        if degree.get(node, 0) <= 0:
            continue
        for edge_idx, neighbor in adj[node]:
            if edge_idx not in active_edges:
                continue
            active_edges.remove(edge_idx)
            degree[node] -= 1
            degree[neighbor] -= 1
            if degree[neighbor] == 1:
                queue.append(neighbor)

    if not active_edges:
        return []

    selected_edges = active_edges
    if seed_comp_ids:
        seed_nodes: deque[str] = deque()
        for edge_idx in active_edges:
            u, v, _, comp_id = edges[edge_idx]
            if comp_id in seed_comp_ids:
                seed_nodes.extend((u, v))
        if seed_nodes:
            visited_nodes = set(seed_nodes)
            component_edges: set[int] = set()
            while seed_nodes:
                curr = seed_nodes.popleft()
                for edge_idx, neighbor in adj[curr]:
                    if edge_idx in active_edges:
                        component_edges.add(edge_idx)
                        if neighbor not in visited_nodes:
                            visited_nodes.add(neighbor)
                            seed_nodes.append(neighbor)
            selected_edges = component_edges

    seen_ids: set[str] = set()
    loop_components: list[tuple[str, str]] = []
    for edge_idx in sorted(selected_edges):
        _, _, spice_name, comp_id = edges[edge_idx]
        if comp_id not in seen_ids:
            seen_ids.add(comp_id)
            loop_components.append((spice_name, comp_id))
    return loop_components


def _extract_error_summary(stderr: str, stdout: str) -> str | None:
    """Extract the most informative raw error detail from ngspice stderr/stdout."""
    generic_phrases = (
        "simulation interrupted due to error",
        "run simulation(s) aborted",
        "circuit not parsed",
        "no resource usage information",
        "or no active circuit available",
    )
    error_markers = (
        "error",
        "fatal",
        "unknown",
        "could not find",
        "unable to find",
        "invalid",
    )
    candidates: list[str] = []
    for stream in (stderr, stdout):
        lines = stream.splitlines()
        for idx, line in enumerate(lines):
            stripped = line.strip()
            if not stripped:
                continue
            lowered = stripped.lower()
            if any(phrase in lowered for phrase in generic_phrases):
                continue
            if any(marker in lowered for marker in error_markers):
                if lowered.startswith("error on line") and stripped.endswith(":"):
                    details = [stripped]
                    for follow in lines[idx + 1 : idx + 3]:
                        follow_stripped = follow.strip()
                        if not follow_stripped:
                            break
                        if any(phrase in follow_stripped.lower() for phrase in generic_phrases):
                            break
                        details.append(follow_stripped)
                    candidates.append(" ".join(details))
                else:
                    candidates.append(stripped)

    if candidates:
        return candidates[0][:300]

    for stream in (stderr, stdout):
        lines = [line.strip() for line in stream.splitlines() if line.strip()]
        if lines:
            return lines[-1][:300]

    return None


def _match_voltage_loop(
    combined: str,
    lowered: str,
    netlist_result: NetlistResult,
) -> Diagnostic | None:
    """Detect voltage-source or inductor loop diagnostics from ngspice output."""
    has_loop_text = any(
        phrase in lowered
        for phrase in (
            "voltage source/inductor loop",
            "v-source/inductor loop",
            "loop of voltage sources",
            "zero-resistance loop",
        )
    )
    check_branch_matches = [m.group(1) for m in _CHECK_BRANCH_RE.finditer(combined)]
    if not has_loop_text and not ("singular matrix" in lowered and check_branch_matches):
        return None

    resolved_matches: list[tuple[str, str]] = []
    seen_ids: set[str] = set()
    for candidate in check_branch_matches:
        resolved = _find_matching_component(candidate, netlist_result.components)
        if resolved is not None and resolved[1] not in seen_ids:
            seen_ids.add(resolved[1])
            resolved_matches.append(resolved)

    loop_components = _find_vl_loop_components(
        netlist_result.netlist,
        netlist_result.components,
        seen_ids,
    )
    if not loop_components:
        if not resolved_matches:
            for match in _ANY_BRANCH_RE.finditer(combined):
                resolved = _find_matching_component(match.group(1), netlist_result.components)
                if resolved is not None and resolved[1] not in seen_ids:
                    seen_ids.add(resolved[1])
                    resolved_matches.append(resolved)
        loop_components = resolved_matches

    targets: list[Target] = [ComponentTarget(comp=comp_id) for _, comp_id in loop_components]
    names = [spice_name for spice_name, _ in loop_components]

    if len(names) == 1:
        message = f"Boucle de sources de tension ou d'inductance détectée autour de {names[0]}."
    elif len(names) > 1:
        joined = ", ".join(names)
        message = f"Boucle de sources de tension ou d'inductance détectée ({joined})."
    else:
        message = "Boucle de sources de tension (ou source court-circuitée) détectée."

    return Diagnostic(code="VOLTAGE_SOURCE_LOOP", message=message, targets=targets)


def _match_singular_matrix(
    combined: str,
    lowered: str,
    netlist_result: NetlistResult,
) -> Diagnostic | None:
    """Detect floating-node / singular-matrix diagnostics from ngspice output."""
    if not any(
        phrase in lowered for phrase in ("singular matrix", "no dc path to ground", "floating node")
    ):
        return None

    node_match = _CHECK_NODE_RE.search(combined)
    raw_node = node_match.group(1).rstrip(".,;:") if node_match is not None else ""
    resolved_net = _find_matching_net(raw_node, netlist_result.nets) if raw_node else None
    if resolved_net is not None:
        return Diagnostic(
            code="SINGULAR_MATRIX",
            message=(
                f"Matrice singulière : le nœud « {resolved_net} » est flottant "
                "ou sans chemin DC vers la masse."
            ),
            targets=[NetTarget(net=resolved_net)],
        )
    if raw_node:
        return Diagnostic(
            code="SINGULAR_MATRIX",
            message=(
                f"Matrice singulière : le nœud « {raw_node} » est flottant "
                "ou sans chemin DC vers la masse."
            ),
            targets=[],
        )
    return Diagnostic(
        code="SINGULAR_MATRIX",
        message=(
            "Matrice singulière : un nœud du circuit est flottant ou sans chemin DC vers la masse."
        ),
        targets=[],
    )


def _match_non_convergence(
    combined: str,
    lowered: str,
    netlist_result: NetlistResult,
) -> Diagnostic | None:
    """Detect timestep/iteration convergence failures from ngspice output."""
    if not any(
        phrase in lowered
        for phrase in (
            "timestep too small",
            "gmin stepping failed",
            "source stepping failed",
            "no convergence",
            "did not converge",
            "convergence failed",
            "iteration limit reached",
            "operating point could not be simulated",
            "trouble with",
        )
    ):
        return None

    targets: list[Target] = []
    trouble_match = _TROUBLE_INSTANCE_RE.search(combined) or _ANY_BRANCH_RE.search(combined)
    if trouble_match is not None:
        resolved_comp = _find_matching_component(trouble_match.group(1), netlist_result.components)
        if resolved_comp is not None:
            targets = [ComponentTarget(comp=resolved_comp[1])]

    return Diagnostic(
        code="NO_CONVERGENCE",
        message=(
            "La simulation n'a pas convergé "
            "(pas de temps trop petit ou limite d'itérations atteinte)."
        ),
        targets=targets,
    )


def _match_syntax_or_model_error(
    lowered: str,
    stdout: str,
    stderr: str,
) -> Diagnostic | None:
    """Detect SPICE syntax, parameter, or missing-model errors from ngspice output."""
    if not any(
        phrase in lowered
        for phrase in (
            "error on line",
            "could not find a valid modelname",
            "unable to find definition of model",
            "unknown subckt",
            "unknown parameter",
            "circuit not parsed",
            "tstep is invalid",
            "syntax error",
        )
    ):
        return None

    summary = _extract_error_summary(stderr, stdout)
    message = (
        f"Erreur dans la netlist SPICE : {summary}"
        if summary
        else "Erreur de syntaxe ou de modèle dans la netlist SPICE."
    )
    return Diagnostic(code="SIMULATION_FAILED", message=message, targets=[])


def _match_structural_ngspice_diagnostic(
    stdout: str,
    stderr: str,
    netlist_result: NetlistResult,
) -> Diagnostic | None:
    """Detect structural singularity or voltage-source loops even if transient OP masked them."""
    combined = "\n".join(part for part in (stderr, stdout) if part)
    lowered = combined.lower()
    for matcher in (_match_voltage_loop, _match_singular_matrix):
        diagnostic = matcher(combined, lowered, netlist_result)
        if diagnostic is not None:
            return diagnostic
    return None


def _match_ngspice_diagnostic(
    stdout: str,
    stderr: str,
    netlist_result: NetlistResult,
) -> Diagnostic | None:
    """Translate known ngspice stderr/stdout errors into a French Diagnostic."""
    structural = _match_structural_ngspice_diagnostic(stdout, stderr, netlist_result)
    if structural is not None:
        return structural

    combined = "\n".join(part for part in (stderr, stdout) if part)
    lowered = combined.lower()
    convergence = _match_non_convergence(combined, lowered, netlist_result)
    if convergence is not None:
        return convergence

    return _match_syntax_or_model_error(lowered, stdout, stderr)


def _build_failure_diagnostic(
    stdout: str,
    stderr: str,
    returncode: int,
    netlist_result: NetlistResult,
) -> Diagnostic:
    """Return a known ngspice Diagnostic or a generic French failure message."""
    matched = _match_ngspice_diagnostic(stdout, stderr, netlist_result)
    if matched is not None:
        return matched
    summary = _extract_error_summary(stderr, stdout)
    message = (
        f"Échec de la simulation ngspice (code {returncode}) : {summary}"
        if summary
        else f"Échec de la simulation ngspice (code {returncode})."
    )
    return Diagnostic(code="SIMULATION_FAILED", message=message, targets=[])


def _find_spice_scripts_dir(executable: Path) -> Path | None:
    """Return the ngspice scripts directory when ``spinit`` exists under the vendor root."""
    resolved = executable.resolve()
    for vendor_root in (resolved.parent.parent, resolved.parent):
        scripts_dir = vendor_root / "share" / "ngspice" / "scripts"
        if (scripts_dir / "spinit").is_file():
            return scripts_dir
    return None


def _build_ngspice_env(executable: Path) -> dict[str, str]:
    """Build subprocess environment variables for batch ngspice execution."""
    env = {**os.environ, "SPICE_ASCIIRAWFILE": "1"}
    if not env.get("SPICE_SCRIPTS"):
        scripts_dir = _find_spice_scripts_dir(executable)
        if scripts_dir is not None:
            env["SPICE_SCRIPTS"] = str(scripts_dir)
    return env


def run_simulation(
    netlist_result: NetlistResult,
    analysis: Analysis,
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ngspice_path: Path | None = None,
    max_points: int = MAX_RESULT_POINTS,
    max_raw_bytes: int = MAX_RAWFILE_BYTES,
) -> SimulationResult:
    """Execute a SPICE netlist with ngspice in an isolated temporary directory.

    Predictable errors (netlist errors, unsafe directives, oversized inputs/outputs,
    missing binary, timeout, ngspice failure, or malformed output) are returned inside
    ``SimulationResult.errors`` as French ``Diagnostic`` entries rather than raising
    exceptions.
    """
    warnings = list(netlist_result.warnings)

    if netlist_result.errors:
        return SimulationResult(
            analysis=analysis.kind,
            errors=list(netlist_result.errors),
            warnings=warnings,
        )

    if not netlist_result.netlist.strip():
        return _error_result(
            analysis,
            "SIMULATION_FAILED",
            "La netlist SPICE est vide.",
            warnings,
        )

    if not isinstance(analysis, OpAnalysis | TranAnalysis | DcAnalysis):
        return _error_result(
            analysis,
            "SIMULATION_FAILED",
            f"Le type d'analyse « {analysis.kind} » n'est pas encore pris en charge.",
            warnings,
        )

    if isinstance(timeout, bool) or not math.isfinite(timeout) or timeout <= 0:
        return _error_result(
            analysis,
            "SIMULATION_FAILED",
            "Le délai maximal de simulation doit être strictement positif.",
            warnings,
        )

    if isinstance(max_points, bool) or not isinstance(max_points, int) or max_points <= 0:
        return _error_result(
            analysis,
            "SIMULATION_FAILED",
            "Le nombre maximal de points de mesure doit être strictement positif.",
            warnings,
        )

    if isinstance(max_raw_bytes, bool) or not isinstance(max_raw_bytes, int) or max_raw_bytes <= 0:
        return _error_result(
            analysis,
            "SIMULATION_FAILED",
            "La taille maximale du fichier de résultats doit être strictement positive.",
            warnings,
        )

    netlist_bytes = len(netlist_result.netlist.encode("utf-8"))
    if netlist_bytes > MAX_NETLIST_BYTES:
        return _error_result(
            analysis,
            "SIMULATION_FAILED",
            f"La netlist SPICE dépasse la taille maximale autorisée "
            f"({netlist_bytes} > {MAX_NETLIST_BYTES} octets).",
            warnings,
        )

    try:
        prepared_netlist = prepare_netlist(netlist_result)
    except UnsafeNetlistError as exc:
        return _error_result(
            analysis,
            "SIMULATION_FAILED",
            exc.user_message,
            warnings,
        )

    if (
        isinstance(analysis, DcAnalysis)
        and resolve_dc_source_name(analysis, netlist_result) is None
    ):
        return _error_result(
            analysis,
            "DC_SOURCE_NOT_FOUND",
            "La source balayée de l'analyse DC est introuvable dans la netlist.",
            warnings,
        )

    if ngspice_path is None:
        try:
            executable = locate_ngspice()
        except NgspiceNotFoundError:
            return _error_result(
                analysis,
                "SIMULATION_FAILED",
                "Le simulateur ngspice est introuvable. "
                "Vérifiez son installation dans backend/vendor/ngspice/.",
                warnings,
            )
    else:
        executable = ngspice_path

    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
    env = _build_ngspice_env(executable)

    with tempfile.TemporaryDirectory(prefix="psice_ngspice_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        circuit_path = tmp_path / _CIRCUIT_FILENAME
        raw_path = tmp_path / _RAWFILE_FILENAME
        circuit_path.write_text(prepared_netlist, encoding="utf-8", newline="\n")

        try:
            completed = subprocess.run(
                [str(executable), "-b", _CIRCUIT_FILENAME, "-r", _RAWFILE_FILENAME],
                cwd=tmp_path,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                env=env,
                creationflags=creationflags,
                shell=False,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return _error_result(
                analysis,
                "SIMULATION_TIMEOUT",
                f"La simulation ngspice a dépassé le délai maximal de {timeout:g} s "
                "et a été interrompue.",
                warnings,
            )
        except OSError as exc:
            return _error_result(
                analysis,
                "SIMULATION_FAILED",
                f"Impossible d'exécuter le simulateur ngspice : {exc}.",
                warnings,
            )

        if completed.returncode != 0:
            diagnostic = _build_failure_diagnostic(
                completed.stdout,
                completed.stderr,
                completed.returncode,
                netlist_result,
            )
            return SimulationResult(
                analysis=analysis.kind,
                errors=[diagnostic],
                warnings=warnings,
            )

        structural_diagnostic = _match_structural_ngspice_diagnostic(
            completed.stdout,
            completed.stderr,
            netlist_result,
        )
        if structural_diagnostic is not None:
            return SimulationResult(
                analysis=analysis.kind,
                errors=[structural_diagnostic],
                warnings=warnings,
            )

        try:
            is_raw_file = raw_path.is_file()
            raw_size = raw_path.stat().st_size if is_raw_file else 0
        except OSError as exc:
            return _error_result(
                analysis,
                "SIMULATION_FAILED",
                f"Impossible d'inspecter le fichier de résultats produit par ngspice : {exc}.",
                warnings,
            )

        if not is_raw_file:
            diagnostic = _match_ngspice_diagnostic(
                completed.stdout,
                completed.stderr,
                netlist_result,
            )
            if diagnostic is not None:
                return SimulationResult(
                    analysis=analysis.kind,
                    errors=[diagnostic],
                    warnings=warnings,
                )
            summary = _extract_error_summary(completed.stderr, completed.stdout)
            message = (
                "La simulation ngspice s'est terminée sans produire de fichier de résultats : "
                f"{summary}"
                if summary
                else "La simulation ngspice s'est terminée sans produire de fichier de résultats."
            )
            return _error_result(
                analysis,
                "SIMULATION_FAILED",
                message,
                warnings,
            )

        if raw_size > max_raw_bytes:
            return _error_result(
                analysis,
                "SIMULATION_FAILED",
                f"Le fichier de résultats ngspice dépasse la taille maximale autorisée "
                f"({raw_size} > {max_raw_bytes} octets).",
                warnings,
            )

        try:
            raw_text = raw_path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            return _error_result(
                analysis,
                "SIMULATION_FAILED",
                f"Impossible de lire les résultats produits par ngspice : {exc}.",
                warnings,
            )

    parsed = parse_ngspice_output(raw_text, netlist_result, analysis, max_points=max_points)
    if parsed.errors:
        diagnostic = _match_ngspice_diagnostic(
            completed.stdout,
            completed.stderr,
            netlist_result,
        )
        if diagnostic is not None:
            return SimulationResult(
                analysis=analysis.kind,
                errors=[diagnostic],
                warnings=warnings,
            )
        summary = _extract_error_summary(completed.stderr, completed.stdout)
        if summary:
            return _error_result(
                analysis,
                "SIMULATION_FAILED",
                f"{parsed.errors[0].message} : {summary}",
                warnings,
            )

    return parsed
