"""Write the SPICE lines: one per component, then the analysis line."""

from app.models import (
    AcAnalysis,
    Analysis,
    Component,
    DcAnalysis,
    OpAnalysis,
    TranAnalysis,
)
from app.netlist.library import PLACEHOLDER, ComponentType
from app.netlist.values import format_value


def fill(template: str, values: dict[str, str]) -> str:
    """Replace each {placeholder} of a template by its value."""
    return PLACEHOLDER.sub(lambda match: values[match[1]], template)


def component_line(
    comp: Component,
    ctype: ComponentType,
    pin_node: dict[tuple[str, str], str],
    *,
    ac_input: bool = False,
) -> str:
    """'R1 in out 1k'. `ac_input`: this source is the input of an .ac analysis -> 'AC 1'."""
    assert ctype.spice is not None and comp.name is not None
    params = {name: value.strip() for name, value in comp.params.items()}
    values = {"name": comp.name, **params}
    values.update({f"pin:{pin.name}": pin_node[(comp.id, pin.name)] for pin in ctype.pins})
    if ctype.waveforms:
        values["waveform"] = fill(ctype.waveforms[params["waveform"]], params)
    line = fill(ctype.spice, values)
    return f"{line} AC 1" if ac_input else line


def analysis_line(analysis: Analysis, names: dict[str, str]) -> str:
    """The analysis directive. `names`: component id -> SPICE name (for the swept source)."""
    if isinstance(analysis, OpAnalysis):
        return ".op"
    if isinstance(analysis, TranAnalysis):
        # .tran tstep tstop [tstart [tmax]]: the 1st argument is the display step, the
        # maximum computation step is the 4th one (decided with Antoine).
        stop = format_value(analysis.stop_time)
        if analysis.max_step is None:
            return f".tran {format_value(analysis.stop_time / 1000)} {stop}"
        step = format_value(analysis.max_step)
        return f".tran {step} {stop} 0 {step}"
    if isinstance(analysis, AcAnalysis):
        start, stop = format_value(analysis.start_frequency), format_value(analysis.stop_frequency)
        return f".ac dec {analysis.points_per_decade} {start} {stop}"
    assert isinstance(analysis, DcAnalysis)
    values = (format_value(v) for v in (analysis.start, analysis.stop, analysis.step))
    return f".dc {names[analysis.source_id]} {' '.join(values)}"
