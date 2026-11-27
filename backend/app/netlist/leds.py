"""Warnings after a simulation: a LED that would burn out (#293).

Pure function of the schematic and the simulation result: no ngspice here.
"""

from app.models import ComponentTarget, Diagnostic, Schematic, SimulationResult
from app.netlist.connectivity import build_nodes
from app.netlist.library import ComponentType, get_library

# Typical limits of a 5 mm LED, whatever its colour.
MAX_FORWARD_CURRENT = 30e-3  # A
MAX_REVERSE_VOLTAGE = 5.0  # V
# The models break down at BV = 5 V: a reverse voltage at the breakdown already means too much.
REVERSE_MARGIN = 0.05  # V

GROUND = "0"


def _french(value: float, decimals: int) -> str:
    return f"{value:.{decimals}f}".replace(".", ",")


def led_warnings(
    schematic: Schematic,
    result: SimulationResult,
    library: dict[str, ComponentType] | None = None,
) -> list[Diagnostic]:
    """LED_OVERCURRENT / LED_REVERSE_VOLTAGE for each LED, on the worst point of the analysis.

    Nothing for an `.ac` analysis (small signals around the operating point) or a failed one.
    """
    leds = [c for c in schematic.components if c.type == "led"]
    if not leds or result.analysis == "ac" or result.errors:
        return []
    library = get_library() if library is None else library
    nodes = build_nodes(schematic, library)
    voltages = {t.net: t.values for t in result.traces if t.kind == "voltage" and t.net}
    currents = {
        t.component_id: t.values
        for t in result.traces
        if t.kind == "current" and t.component_id is not None
    }

    def voltage(node: str | None) -> list[float] | None:
        if node == GROUND:
            return [0.0]
        return voltages.get(node) if node is not None else None

    warnings: list[Diagnostic] = []
    for led in leds:
        name = led.name or led.id
        target = [ComponentTarget(comp=led.id)]
        current = currents.get(led.id)
        if current and max(current) > MAX_FORWARD_CURRENT:
            milliamps = max(current) * 1000
            warnings.append(
                Diagnostic(
                    code="LED_OVERCURRENT",
                    message=f"La LED {name} reçoit {_french(milliamps, 0)} mA : elle grillerait "
                    "(max ~30 mA). Ajoute une résistance en série.",
                    targets=target,
                )
            )
        anode = voltage(nodes.pin_node.get((led.id, "A")))
        cathode = voltage(nodes.pin_node.get((led.id, "K")))
        if anode is None or cathode is None:
            continue
        points = max(len(anode), len(cathode))
        reverse = max(
            cathode[min(i, len(cathode) - 1)] - anode[min(i, len(anode) - 1)] for i in range(points)
        )
        if reverse > MAX_REVERSE_VOLTAGE - REVERSE_MARGIN:
            warnings.append(
                Diagnostic(
                    code="LED_REVERSE_VOLTAGE",
                    message=f"La LED {name} est soumise à {_french(reverse, 1)} V en inverse : "
                    "elle grillerait (max ~5 V).",
                    targets=target,
                )
            )
    return warnings
