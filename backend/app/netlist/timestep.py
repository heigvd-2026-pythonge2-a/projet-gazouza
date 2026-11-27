"""Warning when the step of a `.tran` is too large for the sources of the circuit (#350).

Pure function of the schematic and the analysis: no ngspice here. A warning, not an error: the
simulation runs anyway, but the curve would be wrong (e.g. a 10 kHz sine wave simulated 1 s
with 1000 points: 10 periods between two points).
"""

import math

from app.engines.parser import MAX_RESULT_POINTS
from app.models import Component, ComponentTarget, Diagnostic, Schematic, TranAnalysis
from app.netlist.values import InvalidValueError, parse_value
from app.netlist.writer import tran_max_step

SOURCE_TYPES = ("voltage_source", "current_source")
# ngspice draws a sine wave point by point: at least 20 points per period.
POINTS_PER_PERIOD = 20
# ngspice always puts a point on each edge of a pulse (breakpoints), so short edges are drawn
# right whatever the step. What a large step spoils is the response of the circuit during the
# flat parts: at least 10 points during the high and the low part.
POINTS_PER_PLATEAU = 10
# Without `points` nor `max_step`, the writer asks ngspice for stop_time / 1000.
DEFAULT_POINTS = 1000

_PREFIXES = {-12: "p", -9: "n", -6: "µ", -3: "m", 0: "", 3: "k", 6: "M", 9: "G"}


def french_si(value: float, unit: str) -> str:
    """0.0001, 's' -> '100 µs'; 2500.0, 'Hz' -> '2,5 kHz' (3 significant digits at most)."""
    exponent = 0 if value == 0 else math.floor(math.log10(abs(value)) / 3) * 3
    exponent = max(-12, min(9, exponent))
    mantissa = float(f"{value / 10**exponent:.3g}")
    if abs(mantissa) >= 1000 and exponent < 9:
        exponent += 3
        mantissa /= 1000
    return f"{mantissa:g}".replace(".", ",") + f" {_PREFIXES[exponent]}{unit}"


def thousands(value: float) -> str:
    """20000 -> '20 000', with the narrow no-break space of French."""
    return f"{value:,.0f}".replace(",", " ")


def tran_step(analysis: TranAnalysis) -> float:
    """The largest step ngspice may take (writer.analysis_line)."""
    step = tran_max_step(analysis)
    return step if step is not None else analysis.stop_time / DEFAULT_POINTS


def _number(comp: Component, name: str) -> float | None:
    """A parameter as a float; None when absent or invalid (already reported by checks.py)."""
    try:
        value = parse_value(comp.params.get(name, ""))
    except InvalidValueError:
        return None
    return value if math.isfinite(value) else None


def _limit(comp: Component, stop_time: float) -> tuple[float, str] | None:
    """The largest step that draws this source right, and how the source is described."""
    waveform = comp.params.get("waveform")
    if waveform == "sin":
        frequency, delay = _number(comp, "frequency"), _number(comp, "sin_delay") or 0
        if frequency is None or frequency <= 0 or delay >= stop_time:
            return None
        return 1 / frequency / POINTS_PER_PERIOD, f"sinusoïde de {french_si(frequency, 'Hz')}"
    if waveform == "pulse":
        times = [_number(comp, n) for n in ("delay", "rise", "fall", "width", "period")]
        if any(t is None for t in times):
            return None
        delay, rise, fall, width, period = (t or 0 for t in times)
        if delay >= stop_time:
            return None
        plateaus = [("durée haute", width)]
        if period > 0:
            plateaus.append(("durée basse", period - width - rise - fall))
        positive = [p for p in plateaus if p[1] > 0]
        if not positive:
            return None
        label, plateau = min(positive, key=lambda p: p[1])
        return plateau / POINTS_PER_PLATEAU, f"impulsion, {label} {french_si(plateau, 's')}"
    return None


def tran_step_warnings(schematic: Schematic, analysis: TranAnalysis) -> list[Diagnostic]:
    """TRAN_STEP_TOO_LARGE for each source too fast for the step of the analysis."""
    step = tran_step(analysis)
    warnings: list[Diagnostic] = []
    for comp in schematic.components:
        if comp.type not in SOURCE_TYPES:
            continue
        found = _limit(comp, analysis.stop_time)
        if found is None or step <= found[0] * (1 + 1e-9):  # rounding of stop_time / points
            continue
        limit, what = found
        needed = math.ceil(analysis.stop_time / limit * (1 - 1e-9))
        if needed <= MAX_RESULT_POINTS:
            advice = f"Demande au moins {thousands(needed)} points."
        else:
            advice = (
                f"Il faudrait au moins {thousands(needed)} points, plus que la limite de "
                f"{thousands(MAX_RESULT_POINTS)} : réduis la durée de la simulation."
            )
        warnings.append(
            Diagnostic(
                code="TRAN_STEP_TOO_LARGE",
                message=f"{comp.name or comp.id} ({what}) : un point toutes les "
                f"{french_si(step, 's')}, la courbe sera mal dessinée. {advice}",
                targets=[ComponentTarget(comp=comp.id)],
            )
        )
    return warnings
