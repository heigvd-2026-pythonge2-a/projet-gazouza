"""Pure SPICE3 ASCII rawfile parser and SimulationResult trace mapper."""

import math
from collections.abc import Mapping
from dataclasses import dataclass, field

from app.models.netlist import Diagnostic, DiagnosticCode, NetlistResult
from app.models.simulation import (
    AcAnalysis,
    Analysis,
    Axis,
    DcAnalysis,
    OpAnalysis,
    SimulationResult,
    Trace,
    TranAnalysis,
)


class RawParseError(ValueError):
    """Raised when SPICE3 ASCII rawfile text is empty, unsupported, or malformed."""

    def __init__(self, message: str, *, user_message: str | None = None) -> None:
        super().__init__(message)
        self.user_message = user_message or message


MAX_RESULT_POINTS: int = 200_000


def _validate_max_points(max_points: int) -> None:
    if isinstance(max_points, bool) or not isinstance(max_points, int) or max_points <= 0:
        raise RawParseError(
            f"max_points must be a positive integer, got {max_points!r}.",
            user_message=(
                "La limite maximale de points de simulation doit être "
                "un entier strictement positif."
            ),
        )


@dataclass(frozen=True, slots=True)
class RawVariable:
    """Variable descriptor declared in a SPICE3 ASCII rawfile header."""

    index: int
    name: str
    var_type: str


@dataclass(frozen=True, slots=True)
class RawPlot:
    """Parsed data from a single SPICE3 ASCII rawfile plot."""

    title: str
    date: str
    plotname: str
    flags: tuple[str, ...]
    variables: tuple[RawVariable, ...]
    num_points: int
    columns: dict[str, list[float]]
    imag_columns: dict[str, list[float]] = field(default_factory=dict)


def _is_ascii_uint(token: str) -> bool:
    return token.isascii() and token.isdigit()


def _parse_non_negative_int(raw_value: str, field_name: str) -> int:
    text = raw_value.strip()
    if not _is_ascii_uint(text):
        raise RawParseError(
            f"Invalid integer for '{field_name}': {raw_value!r}.",
            user_message=f"En-tête ngspice invalide pour « {field_name} » : {raw_value!r}.",
        )
    return int(text)


def _parse_float(token: str) -> float:
    try:
        value = float(token)
    except ValueError as exc:
        raise RawParseError(
            f"Invalid numeric value in rawfile: {token!r}.",
            user_message=f"Valeur numérique invalide dans la sortie ngspice : {token!r}.",
        ) from exc
    if not math.isfinite(value):
        raise RawParseError(
            f"Non-finite numeric value in rawfile: {token!r}.",
            user_message=f"Valeur non finie produite par ngspice : {token!r}.",
        )
    return 0.0 if value == 0.0 else value


def _parse_complex_token(token: str) -> tuple[float, float]:
    """Parse a SPICE3 ASCII complex token of the form 'real,imag'."""
    parts = token.split(",")
    if (
        len(parts) != 2
        or not parts[0]
        or not parts[1]
        or parts[0] != parts[0].strip()
        or parts[1] != parts[1].strip()
    ):
        raise RawParseError(
            f"Invalid complex numeric value in rawfile: {token!r}.",
            user_message=f"Valeur complexe invalide dans la sortie ngspice : {token!r}.",
        )
    return _parse_float(parts[0]), _parse_float(parts[1])


def _append_variable_line(variables: list[RawVariable], stripped_line: str) -> None:
    """Append a variable declaration or apply wrapped continuation metadata."""
    parts = stripped_line.split()
    if _is_ascii_uint(parts[0]):
        index = int(parts[0])
        if index != len(variables):
            raise RawParseError(
                f"Expected variable index {len(variables)}, got {index}.",
                user_message="La table des variables de ngspice est incohérente.",
            )
        if len(parts) < 2:
            raise RawParseError(
                f"Missing variable name on variable line: {stripped_line!r}.",
                user_message="Une variable ngspice est incomplète.",
            )
        var_type = parts[2] if len(parts) >= 3 else ""
        variables.append(RawVariable(index=index, name=parts[1], var_type=var_type))
        return

    if not variables:
        raise RawParseError(
            f"Malformed variable declaration line: {stripped_line!r}.",
            user_message="La section « Variables: » de ngspice est mal formée.",
        )

    # Tolerate wrapped variable metadata lines by filling a missing var_type if present.
    last = variables[-1]
    if not last.var_type:
        variables[-1] = RawVariable(index=last.index, name=last.name, var_type=parts[0])


def _parse_header_and_variables(
    lines: list[str],
    max_points: int = MAX_RESULT_POINTS,
) -> tuple[dict[str, str], tuple[str, ...], int, int, tuple[RawVariable, ...], int]:
    """Parse header metadata and variable declarations, returning the index of Value lines."""
    metadata: dict[str, str] = {"title": "", "date": "", "plotname": ""}
    flags: tuple[str, ...] = ()
    num_vars: int | None = None
    num_points: int | None = None
    variables: list[RawVariable] = []
    in_variables = False

    for line_idx, raw_line in enumerate(lines):
        stripped = raw_line.strip()
        if not stripped:
            continue

        lowered = stripped.lower()
        if lowered == "binary:":
            raise RawParseError(
                "Binary rawfile format is not supported; expected ASCII rawfile.",
                user_message=(
                    "Le format binaire ngspice n'est pas pris en charge (ASCII attendu)."
                ),
            )

        if lowered == "values:":
            if not in_variables:
                raise RawParseError(
                    "Missing 'Variables:' section before 'Values:'.",
                    user_message="La section « Variables: » est absente de la sortie ngspice.",
                )
            if len(variables) != num_vars:
                raise RawParseError(
                    f"Expected {num_vars} variables in 'Variables:', found {len(variables)}.",
                    user_message="Le nombre de variables ngspice ne correspond pas à l'en-tête.",
                )
            return metadata, flags, num_vars, num_points, tuple(variables), line_idx + 1

        if in_variables:
            _append_variable_line(variables, stripped)
            continue

        if ":" not in raw_line:
            raise RawParseError(
                f"Malformed rawfile header line: {raw_line!r}.",
                user_message="L'en-tête de la sortie ngspice est mal formé.",
            )

        key, _, value = raw_line.partition(":")
        norm_key = key.strip().lower()
        norm_val = value.strip()

        if norm_key in metadata:
            metadata[norm_key] = norm_val
        elif norm_key == "flags":
            flags = tuple(norm_val.lower().split())
        elif norm_key == "no. variables":
            num_vars = _parse_non_negative_int(norm_val, "No. Variables")
            if num_vars <= 0:
                raise RawParseError(
                    "Header 'No. Variables' must be greater than zero.",
                    user_message="La sortie ngspice ne déclare aucune variable.",
                )
        elif norm_key == "no. points":
            num_points = _parse_non_negative_int(norm_val, "No. Points")
            if num_points > max_points:
                raise RawParseError(
                    f"Rawfile declares {num_points} points, exceeding maximum {max_points}.",
                    user_message=(
                        f"La simulation a produit trop de points de mesure "
                        f"({num_points} > {max_points})."
                    ),
                )
        elif norm_key == "variables":
            if num_vars is None or num_points is None:
                raise RawParseError(
                    "Header must define 'No. Variables' and 'No. Points' before 'Variables:'.",
                    user_message="L'en-tête ngspice est incomplet avant « Variables: ».",
                )
            in_variables = True

    raise RawParseError(
        "Missing 'Values:' section in SPICE3 ASCII rawfile.",
        user_message="La section « Values: » est absente de la sortie ngspice.",
    )


def parse_raw_ascii(raw_text: str, max_points: int = MAX_RESULT_POINTS) -> RawPlot:
    """Parse a SPICE3 ASCII rawfile string into a structured RawPlot.

    Supports both ``Flags: real`` scalar values and ``Flags: complex`` (``real,imag``)
    values.

    Raises:
        RawParseError: If the rawfile is empty, binary, exceeds ``max_points``, or is
            malformed.
    """
    _validate_max_points(max_points)

    if not raw_text or not raw_text.strip():
        raise RawParseError(
            "Ngspice raw output is empty.",
            user_message="La simulation ngspice n'a produit aucune donnée.",
        )

    lines = raw_text.splitlines()
    metadata, flags, num_vars, num_points, variables, values_start = _parse_header_and_variables(
        lines,
        max_points=max_points,
    )

    if metadata["plotname"].lower() == "constants":
        raise RawParseError(
            "Rawfile contains only a 'constants' plot without simulation data.",
            user_message="La simulation ngspice n'a produit aucun résultat exploitable.",
        )

    tokens: list[str] = []
    for line in lines[values_start:]:
        tokens.extend(line.split())

    expected_tokens = num_points * (1 + num_vars)
    if len(tokens) != expected_tokens:
        raise RawParseError(
            f"Expected {expected_tokens} tokens in 'Values:' for {num_points} points and "
            f"{num_vars} variables, got {len(tokens)}.",
            user_message="Les données numériques produites par ngspice sont incomplètes.",
        )

    is_complex = "complex" in flags
    series: list[list[float]] = [[] for _ in range(num_vars)]
    imag_series: list[list[float]] = [[] for _ in range(num_vars)] if is_complex else []
    stride = 1 + num_vars
    for point_idx in range(num_points):
        base = point_idx * stride
        point_token = tokens[base]
        if not _is_ascii_uint(point_token) or int(point_token) != point_idx:
            raise RawParseError(
                f"Expected point index {point_idx} in 'Values:', got {point_token!r}.",
                user_message="Les points de mesure ngspice sont corrompus ou désordonnés.",
            )
        for var_idx in range(num_vars):
            val_token = tokens[base + 1 + var_idx]
            if is_complex:
                real_val, imag_val = _parse_complex_token(val_token)
                series[var_idx].append(real_val)
                imag_series[var_idx].append(imag_val)
            else:
                series[var_idx].append(_parse_float(val_token))

    columns: dict[str, list[float]] = {}
    imag_columns: dict[str, list[float]] = {}
    for var_idx, var in enumerate(variables):
        if var.name not in columns:
            columns[var.name] = series[var_idx]
            if is_complex:
                imag_columns[var.name] = imag_series[var_idx]

    return RawPlot(
        title=metadata["title"],
        date=metadata["date"],
        plotname=metadata["plotname"],
        flags=flags,
        variables=variables,
        num_points=num_points,
        columns=columns,
        imag_columns=imag_columns,
    )


def _extract_voltage_net(var_name: str) -> str | None:
    """Extract lowercase node name from a SPICE voltage vector such as 'v(out)'."""
    lowered = var_name.strip().lower()
    if lowered.startswith("v(") and lowered.endswith(")"):
        net = lowered[2:-1].strip()
        return net or None
    return None


def _extract_at_current_component(token: str) -> str | None:
    """Extract lowercase component name from an ngspice '@comp[param]' current token."""
    if not token.startswith("@"):
        return None
    if token.endswith("[i]"):
        comp = token[1:-3].strip()
        return comp if comp.startswith(("r", "c", "v", "l")) else None
    if token.endswith("[id]"):
        comp = token[1:-4].strip()
        return comp if comp.startswith("d") else None
    if token.endswith("[c]"):
        comp = token[1:-3].strip()
        return comp if comp.startswith("i") else None
    return None


def _extract_current_match(var_name: str) -> tuple[str, int] | None:
    """Extract (lowercase_component_name, priority) from a SPICE current vector.

    Lower priority numbers take precedence if ngspice emits multiple representations
    for the same component (e.g. both 'i(v1)' and 'i(@v1[i])').
    """
    lowered = var_name.strip().lower()
    if lowered.startswith("i(") and lowered.endswith(")"):
        inner = lowered[2:-1].strip()
        if not inner:
            return None
        if inner.startswith("@"):
            comp = _extract_at_current_component(inner)
            return (comp, 3) if comp else None
        return (inner, 1)

    if lowered.endswith("#branch"):
        comp = lowered.removesuffix("#branch").strip()
        return (comp, 2) if comp else None

    comp = _extract_at_current_component(lowered)
    if comp is not None:
        return (comp, 4)

    return None


def _build_traces(
    plot: RawPlot,
    netlist_result: NetlistResult,
    *,
    include_imag: bool = False,
    current_aliases: Mapping[str, str] | None = None,
) -> list[Trace]:
    """Map rawfile columns to contract Trace objects in deterministic order."""
    alias_to_spice_lower: dict[str, str] = {}
    if current_aliases:
        for sense_name, spice_name in current_aliases.items():
            sense_key = sense_name.strip().lower()
            target_key = spice_name.strip().lower()
            if sense_key and target_key:
                alias_to_spice_lower[sense_key] = target_key

    voltage_by_lower: dict[str, tuple[list[float], list[float] | None]] = {}
    current_by_lower: dict[str, tuple[int, list[float], list[float] | None]] = {}

    for var in plot.variables:
        col = plot.columns[var.name]
        imag_col = plot.imag_columns.get(var.name) if include_imag else None
        net_lower = _extract_voltage_net(var.name)
        if net_lower is not None:
            voltage_by_lower.setdefault(net_lower, (col, imag_col))
            continue

        current_match = _extract_current_match(var.name)
        if current_match is not None:
            comp_lower, priority = current_match
            resolved_lower = alias_to_spice_lower.get(comp_lower, comp_lower)
            existing = current_by_lower.get(resolved_lower)
            if existing is None or priority < existing[0]:
                current_by_lower[resolved_lower] = (priority, col, imag_col)

    traces: list[Trace] = []

    for net in netlist_result.nets:
        if net == "0":
            continue
        exact_key = f"v({net})"
        if exact_key in plot.columns:
            real_values: list[float] | None = plot.columns[exact_key]
            imag_values: list[float] | None = (
                plot.imag_columns.get(exact_key) if include_imag else None
            )
        else:
            pair = voltage_by_lower.get(net.lower())
            real_values, imag_values = pair if pair is not None else (None, None)

        if real_values is not None:
            traces.append(
                Trace(
                    name=exact_key,
                    kind="voltage",
                    unit="V",
                    net=net,
                    component_id=None,
                    values=list(real_values),
                    imag=list(imag_values) if include_imag and imag_values is not None else None,
                )
            )

    for spice_name, component_id in netlist_result.components.items():
        matched = current_by_lower.get(spice_name.lower())
        if matched is not None:
            _, real_values, imag_values = matched
            traces.append(
                Trace(
                    name=f"i({spice_name})",
                    kind="current",
                    unit="A",
                    net=None,
                    component_id=component_id,
                    values=list(real_values),
                    imag=list(imag_values) if include_imag and imag_values is not None else None,
                )
            )

    return traces


def _error_result(
    analysis: Analysis,
    message: str,
    warnings: list[Diagnostic],
    *,
    code: DiagnosticCode = "SIMULATION_FAILED",
) -> SimulationResult:
    return SimulationResult(
        analysis=analysis.kind,
        errors=[Diagnostic(code=code, message=message, targets=[])],
        warnings=list(warnings),
    )


def resolve_dc_source_name(
    analysis: DcAnalysis,
    netlist_result: NetlistResult,
) -> str | None:
    """Resolve the swept SPICE source name matching ``analysis.source_id``."""
    for spice_name, component_id in netlist_result.components.items():
        if component_id == analysis.source_id:
            return spice_name
    return None


def _extract_dc_sweep_values(
    plot: RawPlot,
    columns_by_lower: dict[str, list[float]],
    spice_name: str,
) -> list[float] | None:
    """Extract the DC sweep axis vector from ngspice rawfile variables."""
    preferred_keys = (
        ("i(i-sweep)", "i-sweep", "sweep", "v(v-sweep)", "v-sweep")
        if spice_name.strip().upper().startswith("I")
        else ("v(v-sweep)", "v-sweep", "sweep", "i(i-sweep)", "i-sweep")
    )
    for key in preferred_keys:
        if key in columns_by_lower:
            return columns_by_lower[key]
    for var in plot.variables:
        if var.var_type.strip().lower() == "sweep":
            return plot.columns[var.name]
    return None


def map_plot_to_simulation_result(
    plot: RawPlot,
    netlist_result: NetlistResult,
    analysis: Analysis,
    current_aliases: Mapping[str, str] | None = None,
) -> SimulationResult:
    """Convert a parsed RawPlot into a SimulationResult matching the API contract."""
    warnings = list(netlist_result.warnings)

    if not isinstance(analysis, OpAnalysis | TranAnalysis | DcAnalysis | AcAnalysis):
        return _error_result(
            analysis,
            f"Le type d'analyse « {analysis.kind} » n'est pas encore pris en charge.",
            warnings,
        )

    if plot.num_points == 0:
        return _error_result(analysis, "La simulation ngspice n'a produit aucun point.", warnings)

    is_complex = "complex" in plot.flags
    if not isinstance(analysis, AcAnalysis) and is_complex:
        return _error_result(
            analysis,
            "Les valeurs complexes ne sont pas prises en charge pour cette analyse.",
            warnings,
        )

    columns_by_lower = {var.name.lower(): plot.columns[var.name] for var in plot.variables}
    plotname_lower = plot.plotname.lower()

    axis: Axis | None = None
    if isinstance(analysis, OpAnalysis):
        if plot.num_points != 1:
            return _error_result(
                analysis,
                f"L'analyse .op attendait 1 point de mesure, mais ngspice en a retourné "
                f"{plot.num_points}.",
                warnings,
            )
        if (
            "time" in columns_by_lower
            or "frequency" in columns_by_lower
            or any(
                marker in plotname_lower for marker in ("transient", "ac analysis", "dc transfer")
            )
        ):
            return _error_result(
                analysis,
                "La sortie ngspice ne correspond pas à une analyse .op.",
                warnings,
            )
    elif isinstance(analysis, TranAnalysis):
        if any(
            marker in plotname_lower for marker in ("operating point", "ac analysis", "dc transfer")
        ):
            return _error_result(
                analysis,
                "La sortie ngspice ne correspond pas à une analyse .tran.",
                warnings,
            )
        time_values = columns_by_lower.get("time")
        if time_values is None:
            return _error_result(
                analysis,
                "L'axe temporel ('time') est absent des résultats ngspice.",
                warnings,
            )
        axis = Axis(name="time", unit="s", values=list(time_values))
    elif isinstance(analysis, DcAnalysis):
        if (
            "time" in columns_by_lower
            or "frequency" in columns_by_lower
            or any(
                marker in plotname_lower
                for marker in ("operating point", "transient", "ac analysis")
            )
        ):
            return _error_result(
                analysis,
                "La sortie ngspice ne correspond pas à une analyse .dc.",
                warnings,
            )
        spice_name = resolve_dc_source_name(analysis, netlist_result)
        if spice_name is None:
            return _error_result(
                analysis,
                "La source balayée de l'analyse DC est introuvable dans la netlist.",
                warnings,
                code="DC_SOURCE_NOT_FOUND",
            )
        sweep_values = _extract_dc_sweep_values(plot, columns_by_lower, spice_name)
        if sweep_values is None:
            return _error_result(
                analysis,
                "L'axe de balayage DC est absent des résultats ngspice.",
                warnings,
            )
        axis_unit = "A" if spice_name.strip().upper().startswith("I") else "V"
        axis = Axis(name=spice_name, unit=axis_unit, values=list(sweep_values))
    else:
        if not is_complex:
            return _error_result(
                analysis,
                "La sortie ngspice d'une analyse .ac doit contenir des valeurs complexes.",
                warnings,
            )
        if any(
            marker in plotname_lower for marker in ("operating point", "transient", "dc transfer")
        ):
            return _error_result(
                analysis,
                "La sortie ngspice ne correspond pas à une analyse .ac.",
                warnings,
            )
        freq_values = columns_by_lower.get("frequency")
        if freq_values is None:
            return _error_result(
                analysis,
                "L'axe fréquentiel ('frequency') est absent des résultats ngspice.",
                warnings,
            )
        axis = Axis(name="frequency", unit="Hz", values=list(freq_values))

    is_ac = isinstance(analysis, AcAnalysis)
    traces = _build_traces(
        plot,
        netlist_result,
        include_imag=is_ac,
        current_aliases=current_aliases,
    )
    if is_ac:
        for trace in traces:
            if (
                trace.imag is None
                or len(trace.values) != plot.num_points
                or len(trace.imag) != len(trace.values)
            ):
                return _error_result(
                    analysis,
                    (
                        "Les composantes réelles et imaginaires sont incohérentes pour "
                        f"« {trace.name} »."
                    ),
                    warnings,
                )

    has_expected_targets = any(net != "0" for net in netlist_result.nets) or bool(
        netlist_result.components
    )
    if has_expected_targets and not traces:
        return _error_result(
            analysis,
            "Aucune grandeur électrique attendue n'a été trouvée dans la sortie ngspice.",
            warnings,
        )

    return SimulationResult(
        analysis=analysis.kind,
        axis=axis,
        traces=traces,
        errors=[],
        warnings=warnings,
    )


def parse_ngspice_output(
    raw_text: str,
    netlist_result: NetlistResult,
    analysis: Analysis,
    max_points: int = MAX_RESULT_POINTS,
    current_aliases: Mapping[str, str] | None = None,
) -> SimulationResult:
    """Parse raw SPICE3 ASCII output and map variables to a SimulationResult.

    This function is pure and never performs disk I/O or subprocess calls. Malformed
    rawfile output is returned as a Diagnostic error inside SimulationResult rather
    than raising an exception.
    """
    if netlist_result.errors:
        return SimulationResult(
            analysis=analysis.kind,
            errors=list(netlist_result.errors),
            warnings=list(netlist_result.warnings),
        )

    if not isinstance(analysis, OpAnalysis | TranAnalysis | DcAnalysis | AcAnalysis):
        return _error_result(
            analysis,
            f"Le type d'analyse « {analysis.kind} » n'est pas encore pris en charge.",
            list(netlist_result.warnings),
        )

    try:
        plot = parse_raw_ascii(raw_text, max_points=max_points)
    except RawParseError as exc:
        return _error_result(analysis, exc.user_message, list(netlist_result.warnings))

    return map_plot_to_simulation_result(
        plot,
        netlist_result,
        analysis,
        current_aliases=current_aliases,
    )
