"""Subprocess runner for executing SPICE netlists with bundled ngspice."""

import math
import os
import re
import subprocess
import sys
import tempfile
from collections import deque
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path

from app.engines.locator import NgspiceNotFoundError, locate_ngspice
from app.engines.parser import MAX_RESULT_POINTS, parse_ngspice_output, resolve_source_name
from app.models.netlist import (
    ComponentTarget,
    Diagnostic,
    DiagnosticCode,
    NetlistResult,
    NetTarget,
    Target,
)
from app.models.simulation import (
    AcAnalysis,
    Analysis,
    DcAnalysis,
    OpAnalysis,
    SimulationResult,
    TranAnalysis,
)

DEFAULT_TIMEOUT_SECONDS: float = 10.0
MAX_NETLIST_BYTES: int = 1_048_576
MAX_RAWFILE_BYTES: int = 200 * 1024 * 1024

_CIRCUIT_FILENAME = "circuit.cir"
_RAWFILE_FILENAME = "output.raw"
_SAVE_ITEMS_PER_LINE = 10
_AC_SENSED_PREFIXES: tuple[str, ...] = ("r", "c", "d", "i", "s")
_ALWAYS_SENSED_PREFIXES: tuple[str, ...] = ("s",)
_ALLOWED_DOT_DIRECTIVES: frozenset[str] = frozenset(
    {
        ".model",
        ".subckt",
        ".ends",
        ".param",
        ".ic",
        ".nodeset",
        ".op",
        ".tran",
        ".ac",
        ".dc",
        ".end",
        ".save",
    }
)
_ALLOWED_MODEL_TYPES: frozenset[str] = frozenset(
    {"r", "c", "l", "d", "npn", "pnp", "nmos", "pmos", "njf", "pjf", "sw", "csw"}
)
_ALLOWED_ELEMENT_PREFIXES: frozenset[str] = frozenset(
    {"r", "c", "l", "v", "i", "d", "q", "m", "j", "e", "f", "g", "h", "s", "w", "x"}
)
_ANALYSIS_DIRECTIVES: frozenset[str] = frozenset({".op", ".tran", ".ac", ".dc"})
_ANALYSIS_KIND_TO_DIRECTIVE: dict[str, str] = {
    "op": ".op",
    "tran": ".tran",
    "ac": ".ac",
    "dc": ".dc",
}
_MODEL_TYPE_RE = re.compile(r"^[a-z0-9_]+")
_AC_EXCITATION_TOKEN_RE = re.compile(r"\bac\b", re.IGNORECASE)
_NGSPICE_DEFAULT_PARAM_WARNING = "warning, ngspice assumes default parameter(s)"
_SPICE_SUFFIX_MULTIPLIERS: dict[str, float] = {
    "f": 1e-15,
    "p": 1e-12,
    "n": 1e-9,
    "u": 1e-6,
    "m": 1e-3,
    "k": 1e3,
    "meg": 1e6,
    "g": 1e9,
    "t": 1e12,
}
_SPICE_NUMBER_RE = re.compile(
    r"^(?P<number>[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)"
    r"(?P<suffix>meg|[fpnumkgt])?"
    r"(?P<unit>ohm|hz|v|a|s|h|f)?$",
    re.IGNORECASE,
)


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


def _validate_save_identifier(identifier: str, *, en_kind: str, fr_kind: str) -> None:
    """Reject empty SPICE identifiers or those containing whitespace, control chars, or ';()'."""
    if not identifier or any(
        ch.isspace() or ord(ch) < 32 or ord(ch) == 127 or ch in ";()" for ch in identifier
    ):
        raise UnsafeNetlistError(
            f"Unsafe SPICE {en_kind} name for .save: {identifier!r}.",
            user_message=(
                f"Un nom de {fr_kind} SPICE contient des caractères interdits "
                "pour des raisons de sécurité."
            ),
        )


def _validate_save_component_name(spice_name: str) -> None:
    """Reject SPICE component names containing unsafe characters."""
    _validate_save_identifier(spice_name, en_kind="component", fr_kind="composant")


def _non_vl_current_save_token(comp_lower: str) -> str | None:
    """Return the ngspice @comp[...] .save token for non-V/L 2-pin elements, or None."""
    # Only 2-pin elements with a scalar ngspice current parameter get `@comp[...]` tokens;
    # multi-terminal devices (Q*, M*, X*, ...) would produce silent 0.0 vectors for `@comp[i]`,
    # and switches (S*) use 0V sense sources because ngspice reports V/Roff for `@s[i]` in .op.
    if comp_lower.startswith(("r", "c")):
        return f"@{comp_lower}[i]"
    if comp_lower.startswith("d"):
        return f"@{comp_lower}[id]"
    if comp_lower.startswith("i"):
        return f"@{comp_lower}[c]"
    return None


def _collect_save_tokens(
    components: Mapping[str, str],
    existing_tokens: set[str],
    *,
    nets: Mapping[str, list[str]] | None = None,
    is_ac: bool = False,
    current_aliases: Mapping[str, str] | None = None,
) -> list[str]:
    """Build missing .save tokens for node voltages and component branch currents."""
    needed: list[str] = []
    seen = set(existing_tokens)

    def _add(token: str) -> None:
        if token not in seen:
            needed.append(token)
            seen.add(token)

    has_explicit_nets = bool(nets)
    if has_explicit_nets:
        assert nets is not None
        for net_name in nets:
            _validate_save_identifier(net_name, en_kind="net", fr_kind="nœud")
            if net_name != "0":
                _add(f"v({net_name.lower()})")
    else:
        _add("all")

    sense_by_component: dict[str, str] = {}
    if has_explicit_nets and current_aliases:
        for sense_source, target_spice in current_aliases.items():
            _validate_save_component_name(sense_source)
            sense_by_component[target_spice.strip().lower()] = sense_source.strip().lower()

    for spice_name in components:
        _validate_save_component_name(spice_name)
        comp_lower = spice_name.lower()
        if comp_lower.startswith(("v", "l")):
            if has_explicit_nets:
                _add(f"i({comp_lower})")
            continue
        if has_explicit_nets and (sense_source := sense_by_component.get(comp_lower)) is not None:
            _add(f"i({sense_source})")
            continue
        if is_ac:
            # In .ac, ngspice ignores/warns on @comp[i]; non-V/L elements use 0V sense sources
            # (already captured by `all` when `nets` is empty).
            continue
        if (token := _non_vl_current_save_token(comp_lower)) is not None:
            _add(token)

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


def _validate_dot_directive(tokens: list[str], first_token: str, base_token: str) -> None:
    """Validate that a '.' directive is strictly allowlisted and safe if '.model'."""
    if base_token not in _ALLOWED_DOT_DIRECTIVES:
        raise UnsafeNetlistError(
            f"Forbidden SPICE directive or command: {first_token!r}.",
            user_message=(
                f"La directive SPICE « {first_token} » n'est pas autorisée "
                "pour des raisons de sécurité."
            ),
        )
    if base_token != ".model":
        return

    if len(tokens) < 3:
        raise UnsafeNetlistError(
            "Incomplete .model SPICE directive.",
            user_message=(
                "La directive SPICE « .model » doit préciser un type de modèle autorisé "
                "pour des raisons de sécurité."
            ),
        )
    rest = " ".join(tokens[2:]).lower().lstrip(" \t\r\n(")
    match = _MODEL_TYPE_RE.match(rest)
    model_type = match.group(0) if match is not None else ""
    if model_type not in _ALLOWED_MODEL_TYPES:
        detail = model_type or tokens[2]
        raise UnsafeNetlistError(
            f"Forbidden SPICE model type: {detail!r}.",
            user_message=(
                f"Le type de modèle SPICE « {detail} » n'est pas autorisé "
                "pour des raisons de sécurité."
            ),
        )


def _unfold_spice_lines(raw_lines: Iterable[str]) -> tuple[list[str], list[str]]:
    """Unfold SPICE '+' continuations logically, ignoring '*' comment lines.

    Returns both standard space-joined logical lines and compact-joined lines (without
    inserting spaces when '+' has no following whitespace) to catch split tokens.
    """
    spaced_lines: list[str] = []
    compact_lines: list[str] = []

    for raw_line in raw_lines:
        stripped = raw_line.strip().lstrip("\ufeff").strip()
        if not stripped or stripped.startswith("*"):
            continue

        if stripped.startswith("+"):
            after_plus = stripped[1:]
            continuation = after_plus.strip().lstrip("\ufeff").strip()
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
    """Validate that a SPICE netlist conforms to a strict directive and element allowlist.

    Raises:
        UnsafeNetlistError: If null bytes, non-allowlisted ``.`` directives,
            non-allowlisted ``.model`` types, ``shell`` commands, leading ``+`` on line 0,
            or non-allowlisted SPICE element prefixes (such as XSPICE ``A*``) are found.
    """
    if "\x00" in netlist:
        raise UnsafeNetlistError(
            "Null byte detected in SPICE netlist.",
            user_message="La netlist SPICE contient un caractère nul interdit.",
        )

    normalized = netlist.replace("\r\n", "\n").replace("\r", "\n")
    raw_lines = normalized.splitlines()
    if not raw_lines:
        return

    title_line = raw_lines[0].strip().lstrip("\ufeff").strip()
    if title_line and not title_line.startswith("*"):
        if title_line.startswith("+"):
            raise UnsafeNetlistError(
                "Unexpected '+' continuation on SPICE title line.",
                user_message=(
                    "La ligne de titre SPICE ne peut pas commencer par « + » "
                    "pour des raisons de sécurité."
                ),
            )
        title_tokens = title_line.split()
        first_title_token = title_tokens[0]
        base_title_token = first_title_token.lower().split(";", 1)[0]
        if base_title_token.startswith("."):
            _validate_dot_directive(title_tokens, first_title_token, base_title_token)
        elif base_title_token == "shell":
            raise UnsafeNetlistError(
                f"Forbidden SPICE directive or command: {first_title_token!r}.",
                user_message=(
                    f"La directive SPICE « {first_title_token} » n'est pas autorisée "
                    "pour des raisons de sécurité."
                ),
            )

    spaced_lines, compact_lines = _unfold_spice_lines(raw_lines[1:])
    for line in (*spaced_lines, *compact_lines):
        tokens = line.split()
        first_token = tokens[0]
        base_token = first_token.lower().split(";", 1)[0]
        if base_token.startswith("."):
            _validate_dot_directive(tokens, first_token, base_token)
        elif (
            not base_token
            or base_token == "shell"
            or base_token[0] not in _ALLOWED_ELEMENT_PREFIXES
        ):
            raise UnsafeNetlistError(
                f"Forbidden SPICE directive or command: {first_token!r}.",
                user_message=(
                    f"La directive ou le composant SPICE « {first_token} » n'est pas autorisé "
                    "pour des raisons de sécurité."
                ),
            )


def _allocate_unique_name(base: str, used_lower: set[str]) -> str:
    """Return a case-insensitively unique SPICE identifier and register it."""
    candidate = base
    suffix = 1
    while candidate.lower() in used_lower:
        candidate = f"{base}_{suffix}"
        suffix += 1
    used_lower.add(candidate.lower())
    return candidate


@dataclass(slots=True)
class _SpiceBlock:
    """Either raw trivia lines or a logical SPICE statement with its unfolded tokens."""

    lines: list[str]
    tokens: list[str] | None = None


def _is_finite_number(value: object) -> bool:
    return not isinstance(value, bool) and isinstance(value, int | float) and math.isfinite(value)


def _is_positive_finite(value: object) -> bool:
    return _is_finite_number(value) and value > 0


def _is_positive_int(value: object) -> bool:
    return not isinstance(value, bool) and isinstance(value, int) and value >= 1


def _format_spice_number(value: float) -> str:
    """Format a finite float cleanly for SPICE directives without '-0'."""
    normalized = 0.0 if value == 0.0 else float(value)
    return f"{normalized:.12g}"


def _unfold_block_tokens(lines: list[str]) -> list[str]:
    """Unfold physical head and '+' continuation lines into logical SPICE tokens."""
    parts: list[str] = []
    for idx, line in enumerate(lines):
        stripped = line.strip().lstrip("\ufeff").strip()
        if not stripped or stripped.startswith("*"):
            continue
        if idx > 0 and stripped.startswith("+"):
            cont = stripped[1:].strip().lstrip("\ufeff").strip()
            if cont:
                parts.append(cont)
        else:
            parts.append(stripped)
    return " ".join(parts).split()


def _parse_body_blocks(raw_lines: list[str]) -> list[_SpiceBlock]:
    """Group body lines (raw_lines[1:]) into trivia and logical statements up to .end."""
    blocks: list[_SpiceBlock] = []
    current_lines: list[str] | None = None
    pending_trivia: list[str] = []

    def _flush_current() -> None:
        nonlocal current_lines
        if current_lines is not None:
            blocks.append(
                _SpiceBlock(lines=current_lines, tokens=_unfold_block_tokens(current_lines))
            )
            current_lines = None

    for line in raw_lines[1:]:
        stripped = line.strip().lstrip("\ufeff").strip()
        if not stripped or stripped.startswith("*"):
            pending_trivia.append(line)
            continue

        if stripped.startswith("+"):
            if current_lines is not None:
                current_lines.extend(pending_trivia)
                pending_trivia.clear()
                current_lines.append(line)
            else:
                blocks.append(_SpiceBlock(lines=[*pending_trivia, line]))
                pending_trivia.clear()
            continue

        _flush_current()
        if pending_trivia:
            blocks.append(_SpiceBlock(lines=list(pending_trivia)))
            pending_trivia.clear()

        first_base = stripped.split(None, 1)[0].lower().split(";", 1)[0]
        if first_base == ".end":
            return blocks

        current_lines = [line]

    _flush_current()
    if pending_trivia:
        blocks.append(_SpiceBlock(lines=pending_trivia))
    return blocks


def _iter_top_level_statements(blocks: list[_SpiceBlock]) -> Iterator[list[str]]:
    """Yield unfolded token lists for top-level SPICE statements outside .subckt blocks."""
    subckt_depth = 0
    for block in blocks:
        if not block.tokens:
            continue
        base = block.tokens[0].lower().split(";", 1)[0]
        if base == ".subckt":
            subckt_depth += 1
            continue
        if base == ".ends":
            subckt_depth = max(0, subckt_depth - 1)
            continue
        if subckt_depth == 0:
            yield block.tokens


def _collect_top_level_directives(blocks: list[_SpiceBlock]) -> list[tuple[str, list[str]]]:
    """Return top-level analysis directives outside .subckt blocks."""
    directives: list[tuple[str, list[str]]] = []
    for tokens in _iter_top_level_statements(blocks):
        base = tokens[0].lower().split(";", 1)[0]
        if base in _ANALYSIS_DIRECTIVES:
            directives.append((base, tokens))
    return directives


def _validate_analysis_parameters(analysis: Analysis) -> str | None:
    """Validate numeric bounds of an Analysis model before preparing or invoking ngspice."""
    if isinstance(analysis, TranAnalysis):
        if not _is_positive_finite(analysis.stop_time):
            return "La durée de l'analyse transitoire doit être finie et strictement positive."
        if analysis.points is not None and not _is_positive_int(analysis.points):
            return (
                "Le nombre de points de l'analyse transitoire doit être "
                "un entier strictement positif."
            )
        if analysis.max_step is not None and not _is_positive_finite(analysis.max_step):
            return "Le pas maximal de l'analyse transitoire doit être fini et strictement positif."
        return None

    if isinstance(analysis, DcAnalysis):
        if not (
            _is_finite_number(analysis.start)
            and _is_finite_number(analysis.stop)
            and _is_positive_finite(analysis.step)
        ):
            return (
                "Les bornes et le pas de l'analyse DC doivent être finis, "
                "avec un pas strictement positif."
            )
        return None

    if isinstance(analysis, AcAnalysis):
        if not (
            _is_positive_finite(analysis.start_frequency)
            and _is_positive_finite(analysis.stop_frequency)
        ):
            return (
                "Les fréquences de début et de fin de l'analyse AC doivent être "
                "finies et strictement positives."
            )
        if analysis.start_frequency > analysis.stop_frequency:
            return "La fréquence de début de l'analyse AC ne peut pas dépasser la fréquence de fin."
        if not _is_positive_int(analysis.points_per_decade):
            return (
                "Le nombre de points par décade de l'analyse AC doit être "
                "un entier strictement positif."
            )
        return None

    return None


def _validate_top_level_directives(
    blocks: list[_SpiceBlock],
    analysis: Analysis,
    netlist_result: NetlistResult,
) -> str | None:
    """Validate top-level analysis directives against ``analysis`` before running ngspice."""
    directives = _collect_top_level_directives(blocks)
    if not directives:
        return None
    if len(directives) > 1:
        return "La netlist contient plusieurs directives d'analyse."

    dir_name, dir_tokens = directives[0]
    expected_dir = _ANALYSIS_KIND_TO_DIRECTIVE[analysis.kind]
    if dir_name != expected_dir:
        return (
            f"La directive SPICE « {dir_name} » ne correspond pas au type d'analyse "
            f"« {analysis.kind} »."
        )

    if isinstance(analysis, DcAnalysis):
        if len(dir_tokens) < 2:
            return "La directive SPICE « .dc » est incomplète."
        dc_source_name = resolve_source_name(analysis.source_id, netlist_result)
        if dc_source_name is not None and dir_tokens[1].lower() != dc_source_name.lower():
            return (
                f"La directive « .dc » balaie « {dir_tokens[1]} » au lieu de « {dc_source_name} »."
            )
    return None


def _format_analysis_directive(
    analysis: Analysis,
    netlist_result: NetlistResult,
) -> str | None:
    """Build a SPICE analysis directive matching ``analysis`` when omitted from the netlist."""
    if isinstance(analysis, OpAnalysis):
        return ".op"
    if isinstance(analysis, TranAnalysis):
        tstop = _format_spice_number(analysis.stop_time)
        steps = [analysis.max_step] if analysis.max_step is not None else []
        if analysis.points is not None:
            steps.append(analysis.stop_time / analysis.points)
        max_step = min(steps, default=None)
        if max_step is None:
            tstep = _format_spice_number(analysis.stop_time / 1000.0)
            return f".tran {tstep} {tstop}"
        step = _format_spice_number(max_step)
        return f".tran {step} {tstop} 0 {step}"
    if isinstance(analysis, AcAnalysis):
        start = _format_spice_number(analysis.start_frequency)
        stop = _format_spice_number(analysis.stop_frequency)
        return f".ac dec {analysis.points_per_decade} {start} {stop}"
    source_name = resolve_source_name(analysis.source_id, netlist_result)
    if source_name is None:
        return None
    step_val = -analysis.step if analysis.start > analysis.stop else analysis.step
    start = _format_spice_number(analysis.start)
    stop = _format_spice_number(analysis.stop)
    step = _format_spice_number(step_val)
    return f".dc {source_name} {start} {stop} {step}"


def _parse_spice_number(token: str) -> float | None:
    """Parse a SPICE numeric token (with optional SI suffix/unit) into a finite float."""
    match = _SPICE_NUMBER_RE.fullmatch(token.strip())
    if match is None:
        return None
    value = float(match["number"])
    suffix = match["suffix"]
    if suffix is not None:
        value *= _SPICE_SUFFIX_MULTIPLIERS[suffix.lower()]
    if not math.isfinite(value):
        return None
    return 0.0 if value == 0.0 else value


def _normalize_dc_step_line(tokens: list[str]) -> str | None:
    """Flip the .dc step sign when netlist bounds and step polarity disagree."""
    if len(tokens) < 5:
        return None
    netlist_start = _parse_spice_number(tokens[2])
    netlist_stop = _parse_spice_number(tokens[3])
    if netlist_start is None or netlist_stop is None or netlist_start == netlist_stop:
        return None

    step_val, sep, comment_tail = tokens[4].partition(";")
    step_num = _parse_spice_number(step_val)
    if step_num is None or step_num == 0.0:
        return None

    if netlist_start > netlist_stop and step_num > 0.0:
        normalized_step = f"-{step_val.lstrip('+')}"
    elif netlist_start < netlist_stop and step_num < 0.0:
        normalized_step = step_val.lstrip("-")
    else:
        return None

    return " ".join([*tokens[:4], f"{normalized_step}{sep}{comment_tail}", *tokens[5:]])


def _append_ac_excitation_to_block(
    lines: list[str],
    tokens: list[str],
) -> tuple[list[str], list[str]]:
    """Append 'AC 1' to a source statement when its specification lacks an AC token."""
    if len(tokens) < 3:
        return lines, tokens
    spec_before_comment = " ".join(tokens[3:]).split(";", 1)[0]
    if _AC_EXCITATION_TOKEN_RE.search(spec_before_comment):
        return lines, tokens

    updated_lines = list(lines)
    for idx in range(len(updated_lines) - 1, -1, -1):
        stripped = updated_lines[idx].strip().lstrip("\ufeff").strip()
        if not stripped or stripped.startswith("*"):
            continue
        if idx > 0 and stripped.startswith("+") and not stripped[1:].strip():
            continue
        raw = updated_lines[idx]
        if ";" in raw:
            head, sep, tail = raw.partition(";")
            updated_lines[idx] = f"{head.rstrip()} AC 1 {sep}{tail}"
        else:
            updated_lines[idx] = f"{raw.rstrip()} AC 1"
        break
    return updated_lines, _unfold_block_tokens(updated_lines)


def _rewrite_ac_sense_block(
    lines: list[str],
    tokens: list[str],
    sense_node: str,
) -> list[str]:
    """Rewrite a non-V/L element statement to connect its first terminal to ``sense_node``."""
    head_tokens = lines[0].strip().lstrip("\ufeff").strip().split()
    if len(head_tokens) >= 3:
        rewritten_head = f"{head_tokens[0]} {sense_node} {' '.join(head_tokens[2:])}"
        return [rewritten_head, *lines[1:]]

    comments = [line for line in lines[1:] if line.strip().lstrip("\ufeff").strip().startswith("*")]
    rewritten = f"{tokens[0]} {sense_node} {' '.join(tokens[2:])}"
    return [*comments, rewritten]


def _collect_existing_identifiers(
    blocks: list[_SpiceBlock],
    netlist_result: NetlistResult,
) -> tuple[set[str], set[str]]:
    """Collect existing lowercased node and component identifiers to avoid collisions."""
    used_nodes_lower = {net.strip().lower() for net in netlist_result.nets if net.strip()}
    used_components_lower = {
        name.strip().lower() for name in netlist_result.components if name.strip()
    }
    for tokens in _iter_top_level_statements(blocks):
        if tokens[0].startswith("."):
            continue
        used_components_lower.add(tokens[0].lower())
        for tok in tokens[1:]:
            used_nodes_lower.add(tok.lower())
    return used_nodes_lower, used_components_lower


def _validate_netlist_and_components_safety(netlist_result: NetlistResult) -> None:
    """Validate netlist lines, net keys, and component keys against SPICE injection rules."""
    validate_netlist_safety(netlist_result.netlist)
    for net_name in netlist_result.nets:
        _validate_save_identifier(net_name, en_kind="net", fr_kind="nœud")
    for spice_name in netlist_result.components:
        _validate_save_component_name(spice_name)


def _prepare_netlist_for_execution(
    netlist_result: NetlistResult,
    analysis: Analysis | None = None,
    *,
    _raw_lines: list[str] | None = None,
    _blocks: list[_SpiceBlock] | None = None,
) -> tuple[str, dict[str, str], dict[str, str]]:
    """Prepare a netlist and return (prepared_text, current_aliases, node_aliases)."""
    if not netlist_result.netlist.strip():
        raise ValueError("Cannot prepare an empty netlist.")

    _validate_netlist_and_components_safety(netlist_result)

    if _raw_lines is None or _blocks is None:
        normalized = netlist_result.netlist.replace("\r\n", "\n").replace("\r", "\n")
        raw_lines = normalized.splitlines()
        blocks = _parse_body_blocks(raw_lines)
    else:
        raw_lines = _raw_lines
        blocks = _blocks

    is_ac = isinstance(analysis, AcAnalysis)
    sensed_prefixes = _AC_SENSED_PREFIXES if is_ac else _ALWAYS_SENSED_PREFIXES
    needs_sense_lookup = is_ac or any(
        name.strip().lower().startswith(_ALWAYS_SENSED_PREFIXES)
        for name in netlist_result.components
    )
    ac_source_lower: str | None = None
    used_nodes_lower: set[str] = set()
    used_components_lower: set[str] = set()
    if needs_sense_lookup:
        used_nodes_lower, used_components_lower = _collect_existing_identifiers(
            blocks, netlist_result
        )
    if is_ac:
        ac_source_name = resolve_source_name(analysis.input_source_id, netlist_result)
        if ac_source_name is not None:
            ac_source_lower = ac_source_name.strip().lower()

    # Preserve line 0 intact because SPICE treats the first line as the circuit title.
    body_lines: list[str] = [raw_lines[0]]
    existing_save_tokens: set[str] = set()
    subckt_depth = 0
    has_analysis_directive = False
    current_aliases: dict[str, str] = {}
    node_aliases: dict[str, str] = {}
    instrumented_lower: set[str] = set()

    for block in blocks:
        if not block.tokens:
            body_lines.extend(block.lines)
            continue

        block_lines = block.lines
        tokens = block.tokens
        base_token = tokens[0].lower().split(";", 1)[0]

        if base_token == ".subckt":
            subckt_depth += 1
            body_lines.extend(block_lines)
            continue

        if base_token == ".ends":
            subckt_depth = max(0, subckt_depth - 1)
            body_lines.extend(block_lines)
            continue

        if subckt_depth > 0:
            body_lines.extend(block_lines)
            continue

        if base_token == ".save":
            existing_save_tokens.update(tok.lower() for tok in tokens[1:])
            body_lines.extend(block_lines)
            continue

        if base_token in _ANALYSIS_DIRECTIVES:
            has_analysis_directive = True
            if base_token == ".dc" and (analysis is None or isinstance(analysis, DcAnalysis)):
                rewritten_dc = _normalize_dc_step_line(tokens)
                if rewritten_dc is not None:
                    body_lines.append(rewritten_dc)
                    continue
            body_lines.extend(block_lines)
            continue

        if base_token.startswith("."):
            body_lines.extend(block_lines)
            continue

        if ac_source_lower is not None and base_token == ac_source_lower:
            block_lines, tokens = _append_ac_excitation_to_block(block_lines, tokens)

        if len(tokens) >= 3:
            resolved = _find_matching_component(tokens[0], netlist_result.components)
            if resolved is not None:
                spice_name, _ = resolved
                comp_lower = spice_name.strip().lower()
                if comp_lower.startswith(sensed_prefixes) and (
                    comp_lower not in instrumented_lower
                ):
                    instrumented_lower.add(comp_lower)
                    safe_suffix = re.sub(r"[^a-z0-9_]", "_", comp_lower)
                    sense_node = _allocate_unique_name(
                        f"__psice_sense_{safe_suffix}", used_nodes_lower
                    )
                    sense_source = _allocate_unique_name(
                        f"V__psice_sense_{safe_suffix}", used_components_lower
                    )
                    current_aliases[sense_source.lower()] = spice_name
                    if tokens[1] != "0":
                        node_aliases[sense_node.lower()] = tokens[1]
                    body_lines.append(f"{sense_source} {tokens[1]} {sense_node} DC 0")
                    body_lines.extend(_rewrite_ac_sense_block(block_lines, tokens, sense_node))
                    continue

        body_lines.extend(block_lines)

    while len(body_lines) > 1 and not body_lines[-1].strip():
        body_lines.pop()

    if (
        analysis is not None
        and not has_analysis_directive
        and isinstance(analysis, OpAnalysis | TranAnalysis | DcAnalysis | AcAnalysis)
    ):
        directive = _format_analysis_directive(analysis, netlist_result)
        if directive is not None:
            body_lines.append(directive)

    save_tokens = _collect_save_tokens(
        netlist_result.components,
        existing_save_tokens,
        nets=netlist_result.nets,
        is_ac=is_ac,
        current_aliases=current_aliases,
    )
    body_lines.extend(_format_save_lines(save_tokens))
    body_lines.append(".end")

    prepared = "\n".join(body_lines) + "\n"
    validate_netlist_safety(prepared)
    return prepared, current_aliases, node_aliases


def prepare_netlist(
    netlist_result: NetlistResult,
    analysis: Analysis | None = None,
) -> str:
    """Prepare a netlist string for ngspice batch execution.

    Validates safety, preserves the SPICE title line and existing analysis directives,
    inserts 0V sense voltage sources for 2-terminal non-V/L elements in AC analysis,
    injects any missing ``.save`` tokens for node voltages and component branch currents
    before ``.end``, and terminates cleanly with ``.end``.
    """
    prepared, _, _ = _prepare_netlist_for_execution(netlist_result, analysis=analysis)
    return prepared


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
    blocks = _parse_body_blocks(lines)
    edges: list[tuple[str, str, str, str]] = []
    for tokens in _iter_top_level_statements(blocks):
        if (
            tokens[0].startswith(".")
            or len(tokens) < 3
            or not tokens[0].lower().startswith(("v", "l"))
        ):
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


def _is_ngspice_boilerplate_line(stripped: str) -> bool:
    """Return True for generic ngspice abort phrases and resource/banner boilerplate."""
    lowered = stripped.lower()
    generic_phrases = (
        "simulation interrupted due to error",
        "run simulation(s) aborted",
        "circuit not parsed",
        "no resource usage information",
        "or no active circuit available",
    )
    boilerplate_prefixes = (
        "current ngspice program size =",
        "maximum ngspice program size =",
        "total dram available =",
        "dram currently available =",
        "total analysis time",
        "total elapsed time",
        "shared ngspice pages =",
        "text (code) pages =",
        "stack =",
        "library pages =",
        "no. of data rows",
        "no. of data columns",
        "using sparse",
        "doing analysis at temp",
        "ascii raw file",
        "circuit:",
        "note: no compatibility mode selected",
    )
    return any(phrase in lowered for phrase in generic_phrases) or any(
        lowered.startswith(prefix) for prefix in boilerplate_prefixes
    )


def _extract_error_summary(stderr: str, stdout: str) -> str | None:
    """Extract the most informative raw error detail from ngspice stderr/stdout."""
    error_markers = (
        "error",
        "fatal",
        "unknown",
        "could not find",
        "unable to find",
        "invalid",
        _NGSPICE_DEFAULT_PARAM_WARNING,
    )
    candidates: list[str] = []
    for stream in (stderr, stdout):
        lines = stream.splitlines()
        for idx, line in enumerate(lines):
            stripped = line.strip()
            if not stripped or _is_ngspice_boilerplate_line(stripped):
                continue
            lowered = stripped.lower()
            if any(marker in lowered for marker in error_markers):
                if lowered.startswith("error on line") and stripped.endswith(":"):
                    details = [stripped]
                    for follow in lines[idx + 1 : idx + 3]:
                        follow_stripped = follow.strip()
                        if not follow_stripped or _is_ngspice_boilerplate_line(follow_stripped):
                            break
                        details.append(follow_stripped)
                    candidates.append(" ".join(details))
                else:
                    candidates.append(stripped)

    if candidates:
        return candidates[0][:300]

    for stream in (stderr, stdout):
        lines = [
            stripped
            for line in stream.splitlines()
            if (stripped := line.strip()) and not _is_ngspice_boilerplate_line(stripped)
        ]
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
    *,
    node_aliases: dict[str, str] | None = None,
) -> Diagnostic | None:
    """Detect floating-node / singular-matrix diagnostics from ngspice output."""
    if not any(
        phrase in lowered for phrase in ("singular matrix", "no dc path to ground", "floating node")
    ):
        return None

    node_match = _CHECK_NODE_RE.search(combined)
    raw_node = node_match.group(1).rstrip(".,;:") if node_match is not None else ""
    display_node = (
        node_aliases.get(raw_node.lower(), raw_node) if (raw_node and node_aliases) else raw_node
    )
    resolved_net = _find_matching_net(display_node, netlist_result.nets) if display_node else None
    if resolved_net is not None:
        return Diagnostic(
            code="SINGULAR_MATRIX",
            message=(
                f"Matrice singulière : le nœud « {resolved_net} » est flottant "
                "ou sans chemin DC vers la masse."
            ),
            targets=[NetTarget(net=resolved_net)],
        )
    if display_node:
        return Diagnostic(
            code="SINGULAR_MATRIX",
            message=(
                f"Matrice singulière : le nœud « {display_node} » est flottant "
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
            _NGSPICE_DEFAULT_PARAM_WARNING,
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
    *,
    node_aliases: dict[str, str] | None = None,
) -> Diagnostic | None:
    """Detect structural or default-parameter ngspice failures even on exit code 0."""
    combined = "\n".join(part for part in (stderr, stdout) if part)
    lowered = combined.lower()
    loop_diag = _match_voltage_loop(combined, lowered, netlist_result)
    if loop_diag is not None:
        return loop_diag
    singular_diag = _match_singular_matrix(
        combined, lowered, netlist_result, node_aliases=node_aliases
    )
    if singular_diag is not None:
        return singular_diag
    if _NGSPICE_DEFAULT_PARAM_WARNING in lowered:
        return _match_syntax_or_model_error(lowered, stdout, stderr)
    return None


def _match_ngspice_diagnostic(
    stdout: str,
    stderr: str,
    netlist_result: NetlistResult,
    *,
    node_aliases: dict[str, str] | None = None,
) -> Diagnostic | None:
    """Translate known ngspice stderr/stdout errors into a French Diagnostic."""
    structural = _match_structural_ngspice_diagnostic(
        stdout,
        stderr,
        netlist_result,
        node_aliases=node_aliases,
    )
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
    *,
    node_aliases: dict[str, str] | None = None,
) -> Diagnostic:
    """Return a known ngspice Diagnostic or a generic French failure message."""
    matched = _match_ngspice_diagnostic(
        stdout,
        stderr,
        netlist_result,
        node_aliases=node_aliases,
    )
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

    if not isinstance(analysis, OpAnalysis | TranAnalysis | DcAnalysis | AcAnalysis):
        return _error_result(
            analysis,
            "SIMULATION_FAILED",
            f"Le type d'analyse « {analysis.kind} » n'est pas encore pris en charge.",
            warnings,
        )

    if not _is_positive_finite(timeout):
        return _error_result(
            analysis,
            "SIMULATION_FAILED",
            "Le délai maximal de simulation doit être strictement positif.",
            warnings,
        )

    if not _is_positive_int(max_points):
        return _error_result(
            analysis,
            "SIMULATION_FAILED",
            "Le nombre maximal de points de mesure doit être strictement positif.",
            warnings,
        )

    if not _is_positive_int(max_raw_bytes):
        return _error_result(
            analysis,
            "SIMULATION_FAILED",
            "La taille maximale du fichier de résultats doit être strictement positive.",
            warnings,
        )

    analysis_error = _validate_analysis_parameters(analysis)
    if analysis_error is not None:
        return _error_result(
            analysis,
            "SIMULATION_FAILED",
            analysis_error,
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
        _validate_netlist_and_components_safety(netlist_result)
    except UnsafeNetlistError as exc:
        return _error_result(
            analysis,
            "SIMULATION_FAILED",
            exc.user_message,
            warnings,
        )

    if (
        isinstance(analysis, AcAnalysis)
        and resolve_source_name(analysis.input_source_id, netlist_result) is None
    ):
        return _error_result(
            analysis,
            "AC_SOURCE_NOT_FOUND",
            "La source d'entrée de l'analyse AC est introuvable dans la netlist.",
            warnings,
        )

    if (
        isinstance(analysis, DcAnalysis)
        and resolve_source_name(analysis.source_id, netlist_result) is None
    ):
        return _error_result(
            analysis,
            "DC_SOURCE_NOT_FOUND",
            "La source balayée de l'analyse DC est introuvable dans la netlist.",
            warnings,
        )

    normalized = netlist_result.netlist.replace("\r\n", "\n").replace("\r", "\n")
    raw_lines = normalized.splitlines()
    blocks = _parse_body_blocks(raw_lines)
    directive_error = _validate_top_level_directives(blocks, analysis, netlist_result)
    if directive_error is not None:
        return _error_result(
            analysis,
            "SIMULATION_FAILED",
            directive_error,
            warnings,
        )

    try:
        prepared_netlist, current_aliases, node_aliases = _prepare_netlist_for_execution(
            netlist_result,
            analysis=analysis,
            _raw_lines=raw_lines,
            _blocks=blocks,
        )
    except UnsafeNetlistError as exc:
        return _error_result(
            analysis,
            "SIMULATION_FAILED",
            exc.user_message,
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
                [str(executable), "-n", "-b", _CIRCUIT_FILENAME, "-r", _RAWFILE_FILENAME],
                cwd=tmp_path,
                stdin=subprocess.DEVNULL,
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
                node_aliases=node_aliases or None,
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
            node_aliases=node_aliases or None,
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
                node_aliases=node_aliases or None,
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

    parsed = parse_ngspice_output(
        raw_text,
        netlist_result,
        analysis,
        max_points=max_points,
        current_aliases=current_aliases or None,
    )
    if parsed.errors:
        diagnostic = _match_ngspice_diagnostic(
            completed.stdout,
            completed.stderr,
            netlist_result,
            node_aliases=node_aliases or None,
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
