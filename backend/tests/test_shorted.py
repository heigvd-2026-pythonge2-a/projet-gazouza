"""SHORTED_COMPONENT (#262): a component whose pins are all on one node has no effect."""

import pytest

from app.models import ComponentTarget, NetTarget, OpAnalysis
from app.netlist.generate import generate_netlist
from tests.test_netlist import GROUND, LOOP, RESISTOR, SOURCE, comp, schematic, wire

OP = OpAnalysis()
R2 = comp("c3", "resistor", "R2", resistance="2k")


def shorted(components: list[dict], wires: list[dict]) -> list:
    result = generate_netlist(schematic(components, wires), OP)
    assert result.errors == []
    return [w for w in result.warnings if w.code == "SHORTED_COMPONENT"]


def test_wire_across_a_resistor() -> None:
    # V1 -> R1 -> R2 -> ground, with a wire between the two pins of R2.
    wires = [wire("w1", "c1.+", "c2.1"), wire("w2", "c2.2", "c3.1"), wire("w3", "c3.2", "g.1"),
             wire("w4", "c1.-", "g.1"), wire("w5", "c3.1", "c3.2")]  # fmt: skip
    warnings = shorted([SOURCE, RESISTOR, R2, GROUND], wires)
    assert len(warnings) == 1
    assert warnings[0].targets == [ComponentTarget(comp="c3"), NetTarget(net="0")]
    assert warnings[0].message.startswith("R2 est court-circuité")
    assert "à la masse" in warnings[0].message


def test_two_labels_of_the_same_name() -> None:
    labels = [comp("l1", "label", net="mid"), comp("l2", "label", net="mid")]
    wires = [wire("w1", "c1.+", "c2.1"), wire("w2", "c2.2", "c3.1"), wire("w3", "c3.2", "g.1"),
             wire("w4", "c1.-", "g.1"), wire("w5", "c2.2", "l1.1"),
             wire("w6", "c2.1", "l2.1")]  # fmt: skip
    warnings = shorted([SOURCE, RESISTOR, R2, GROUND, *labels], wires)
    assert [w.targets[0] for w in warnings] == [ComponentTarget(comp="c2")]
    assert "au même nœud (mid)" in warnings[0].message


def test_two_grounds() -> None:
    ground2 = comp("g2", "ground")
    wires = [*LOOP, wire("w4", "c3.1", "g.1"), wire("w5", "c3.2", "g2.1")]
    warnings = shorted([SOURCE, RESISTOR, R2, GROUND, ground2], wires)
    assert [w.targets[0] for w in warnings] == [ComponentTarget(comp="c3")]


def test_normal_circuit_has_no_warning() -> None:
    assert shorted([SOURCE, RESISTOR, GROUND], LOOP) == []


def test_shorted_current_source_is_warned() -> None:
    source = comp("c4", "current_source", "I1", waveform="dc", dc="1m")
    wires = [*LOOP, wire("w4", "c4.+", "c2.1"), wire("w5", "c4.-", "c2.1")]
    warnings = shorted([SOURCE, RESISTOR, GROUND, source], wires)
    assert [w.targets[0] for w in warnings] == [ComponentTarget(comp="c4")]


def test_shorted_voltage_source_is_left_to_ngspice() -> None:
    # ngspice answers VOLTAGE_SOURCE_LOOP: no second message for V1 (R1 is shorted too).
    wires = [*LOOP, wire("w4", "c1.+", "c1.-")]
    warnings = shorted([SOURCE, RESISTOR, GROUND], wires)
    assert [w.targets[0] for w in warnings] == [ComponentTarget(comp="c2")]


@pytest.mark.parametrize("pins", [("B", "C"), ("B", "E")])
def test_partly_shorted_transistor_is_not_warned(pins: tuple[str, str]) -> None:
    # A transistor wired as a diode is on purpose.
    npn = comp("q1", "npn", "Q1", model="Q_NPN_GP")
    a, b = pins
    other = ({"B", "C", "E"} - set(pins)).pop()
    wires = [*LOOP, wire("w4", f"q1.{a}", "c2.1"), wire("w5", f"q1.{b}", "c2.1"),
             wire("w6", f"q1.{other}", "g.1")]  # fmt: skip
    assert shorted([SOURCE, RESISTOR, GROUND, npn], wires) == []


def test_unconnected_pin_gives_only_the_error() -> None:
    result = generate_netlist(schematic([SOURCE, RESISTOR, GROUND, R2],
                                        [*LOOP, wire("w4", "c3.1", "g.1")]), OP)  # fmt: skip
    assert [e.code for e in result.errors] == ["PIN_NOT_CONNECTED"]
    assert all(w.code != "SHORTED_COMPONENT" for w in result.warnings)
