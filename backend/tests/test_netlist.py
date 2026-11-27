"""Netlist generation: golden tests on shared/fixtures, then one test per rule."""

from pathlib import Path

import pytest
from pydantic import TypeAdapter

from app.models import (
    AcAnalysis,
    Analysis,
    DcAnalysis,
    NetlistResult,
    OpAnalysis,
    Point,
    Schematic,
    Text,
    TranAnalysis,
)
from app.netlist.connectivity import UnionFind
from app.netlist.generate import generate_netlist

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "shared" / "fixtures"
CIRCUITS = sorted(p.name for p in FIXTURES_DIR.iterdir() if p.is_dir())
OP = OpAnalysis()


# --- Golden tests: the reference circuits give exactly the expected netlist ---------------


@pytest.mark.parametrize("circuit", CIRCUITS)
def test_fixture_gives_the_expected_netlist(circuit: str) -> None:
    folder = FIXTURES_DIR / circuit
    schematic = Schematic.model_validate_json((folder / "schematic.json").read_text("utf-8"))
    analysis = TypeAdapter(Analysis).validate_json((folder / "analysis.json").read_text("utf-8"))
    expected = NetlistResult.model_validate_json((folder / "netlist.json").read_text("utf-8"))

    assert generate_netlist(schematic, analysis) == expected


# --- Small circuits written by hand -------------------------------------------------------


def comp(comp_id: str, comp_type: str, name: str | None = None, **params: str) -> dict:
    return {"id": comp_id, "type": comp_type, "name": name, "position": {"x": 0, "y": 0},
            "params": params}  # fmt: skip


def end(where: str | tuple[int, int]) -> dict:
    """'c1.+' -> pin '+' of c1 ; 'j1' -> junction ; (x, y) -> free end."""
    if isinstance(where, tuple):
        return {"x": where[0], "y": where[1]}
    if "." in where:
        comp_id, pin = where.split(".", 1)
        return {"comp": comp_id, "pin": pin}
    return {"junction": where}


def wire(wire_id: str, a: str | tuple[int, int], b: str | tuple[int, int]) -> dict:
    return {"id": wire_id, "from": end(a), "to": end(b)}


def schematic(components: list[dict], wires: list[dict], junctions: list[str] = ()) -> Schematic:
    return Schematic.model_validate(
        {
            "components": components,
            "wires": wires,
            "junctions": [{"id": j, "position": {"x": 0, "y": 0}} for j in junctions],
        }
    )


SOURCE = comp("c1", "voltage_source", "V1", waveform="dc", dc="5")
RESISTOR = comp("c2", "resistor", "R1", resistance="1k")
GROUND = comp("g", "ground")
LOOP = [wire("w1", "c1.+", "c2.1"), wire("w2", "c2.2", "g.1"), wire("w3", "c1.-", "g.1")]


def codes(diagnostics: list) -> list[str]:
    return [d.code for d in diagnostics]


def test_simple_loop() -> None:
    result = generate_netlist(schematic([SOURCE, RESISTOR, GROUND], LOOP), OP)

    assert result.netlist == "* Psice\nV1 n1 0 DC 5\nR1 n1 0 1k\n.op\n.end\n"
    assert result.nets == {"n1": ["w1"], "0": ["w2", "w3"]}
    assert result.components == {"V1": "c1", "R1": "c2"}
    assert result.errors == result.warnings == []


def test_union_find() -> None:
    groups = UnionFind()
    groups.union("a", "b")
    groups.union("c", "d")
    groups.union("b", "c")
    assert groups.find("a") == groups.find("d")
    assert groups.find("e") != groups.find("a")


def test_labels_with_the_same_name_are_one_node() -> None:
    # No wire between R1 and R2: the two "mid" labels join them (and the case is ignored).
    r2 = comp("c3", "resistor", "R2", resistance="2k")
    labels = [comp("l1", "label", net="mid"), comp("l2", "label", net="MID")]
    wires = [
        wire("w1", "c1.+", "c2.1"),
        wire("w2", "c2.2", "l1.1"),
        wire("w3", "l2.1", "c3.1"),
        wire("w4", "c3.2", "g.1"),
        wire("w5", "c1.-", "g.1"),
    ]
    result = generate_netlist(schematic([SOURCE, RESISTOR, r2, GROUND, *labels], wires), OP)

    assert "R1 n1 mid 1k\nR2 mid 0 2k\n" in result.netlist
    assert result.nets["mid"] == ["w2", "w3"]


def test_label_direction_only_changes_the_drawing() -> None:
    # Absent (a file saved before the parameter existed) or set: the same netlist, no error.
    wires = [*LOOP, wire("w4", "c1.+", "l1.1")]
    netlists = set()
    for direction in [None, "none", "input", "output", "bidir"]:
        params = {"net": "out"} if direction is None else {"net": "out", "direction": direction}
        result = generate_netlist(
            schematic([SOURCE, RESISTOR, GROUND, comp("l1", "label", **params)], wires), OP
        )
        assert result.errors == []
        netlists.add(result.netlist)
    assert len(netlists) == 1


def test_bad_label_direction() -> None:
    label = comp("l1", "label", net="out", direction="up")
    errors = check([SOURCE, RESISTOR, GROUND, label], [*LOOP, wire("w4", "c1.+", "l1.1")])
    assert codes(errors) == ["BAD_VALUE"]


def test_junction_joins_three_wires() -> None:
    r2 = comp("c3", "resistor", "R2", resistance="1k")
    wires = [
        wire("w1", "c1.+", "j1"),
        wire("w2", "j1", "c2.1"),
        wire("w3", "j1", "c3.1"),
        wire("w4", "c2.2", "g.1"),
        wire("w5", "c3.2", "g.1"),
        wire("w6", "c1.-", "g.1"),
    ]
    result = generate_netlist(schematic([SOURCE, RESISTOR, r2, GROUND], wires, ["j1"]), OP)

    assert "R1 n1 0 1k\nR2 n1 0 1k\n" in result.netlist
    assert result.nets["n1"] == ["w1", "w2", "w3"]


def test_dangling_wire_is_a_warning() -> None:
    wires = [*LOOP, wire("w4", "c2.1", (5, 5)), wire("w5", (1, 1), (2, 2))]
    result = generate_netlist(schematic([SOURCE, RESISTOR, GROUND], wires), OP)

    assert result.netlist  # still simulated
    assert codes(result.warnings) == ["WIRE_DANGLING", "WIRE_DANGLING"]
    assert result.nets["n1"] == ["w1", "w4"]  # attached by one end: part of the node
    assert "w5" not in str(result.nets)  # attached to nothing: part of no node


def test_junction_with_one_wire_is_a_warning() -> None:
    wires = [*LOOP, wire("w4", "c2.1", "j1")]
    result = generate_netlist(schematic([SOURCE, RESISTOR, GROUND], wires, ["j1"]), OP)

    assert codes(result.warnings) == ["JUNCTION_DANGLING"]


def test_milli_suffix_is_a_warning() -> None:
    resistor = comp("c2", "resistor", "R1", resistance="1M")
    result = generate_netlist(schematic([SOURCE, resistor, GROUND], LOOP), OP)

    assert result.netlist
    assert codes(result.warnings) == ["MILLI_SUFFIX"]
    assert "« 1Meg »" in result.warnings[0].message


# --- Sources and analyses -----------------------------------------------------------------


def test_source_only_needs_the_params_of_its_waveform() -> None:
    source = comp("c1", "voltage_source", "V1", waveform="sin", offset="0", amplitude="1",
                  frequency="50", sin_delay="0", damping="0", phase="0")  # fmt: skip
    result = generate_netlist(schematic([source, RESISTOR, GROUND], LOOP), OP)

    assert "V1 n1 0 SIN(0 1 50 0 0 0)\n" in result.netlist


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"delay": "1m"}, "SIN(0 1 50 1m 0 0)"),  # saved before #165: the old delay is kept
        ({"delay": "1m", "sin_delay": "2m"}, "SIN(0 1 50 2m 0 0)"),  # "delay" is the pulse's
    ],
)
def test_sine_delay_of_an_old_file(params: dict[str, str], expected: str) -> None:
    source = comp("c1", "voltage_source", "V1", waveform="sin", offset="0", amplitude="1",
                  frequency="50", damping="0", phase="0", **params)  # fmt: skip
    result = generate_netlist(schematic([source, RESISTOR, GROUND], LOOP), OP)
    assert result.errors == []
    assert f"V1 n1 0 {expected}\n" in result.netlist


def test_current_source() -> None:
    source = comp("c1", "current_source", "I1", waveform="dc", dc="1m")
    result = generate_netlist(schematic([source, RESISTOR, GROUND], LOOP), OP)

    assert "I1 n1 0 DC 1m\n" in result.netlist


@pytest.mark.parametrize(
    ("analysis", "line"),
    [
        (OpAnalysis(), ".op"),
        (TranAnalysis(stop_time=0.01), ".tran 10u 10m"),
        (TranAnalysis(stop_time=0.005, max_step=1e-5), ".tran 10u 5m 0 10u"),
        (AcAnalysis(input_source_id="c1", start_frequency=1, stop_frequency=1e6),
         ".ac dec 20 1 1Meg"),
        (DcAnalysis(source_id="c1", start=-1, stop=1, step=0.1), ".dc V1 -1 1 100m"),
    ],
)  # fmt: skip
def test_analysis_line(analysis: Analysis, line: str) -> None:
    result = generate_netlist(schematic([SOURCE, RESISTOR, GROUND], LOOP), analysis)
    assert result.netlist.endswith(f"\n{line}\n.end\n")


def test_ac_input_source_gets_ac_1() -> None:
    analysis = AcAnalysis(input_source_id="c1", start_frequency=10, stop_frequency=1e5)
    result = generate_netlist(schematic([SOURCE, RESISTOR, GROUND], LOOP), analysis)
    assert "V1 n1 0 DC 5 AC 1\n" in result.netlist


# --- Errors: one test per code, each with its targets --------------------------------------


def check(components: list[dict], wires: list[dict], analysis: Analysis = OP, junctions=()):
    result = generate_netlist(schematic(components, wires, junctions), analysis)
    assert result.netlist == ""
    return result.errors


def test_no_ground() -> None:
    wires = [wire("w1", "c1.+", "c2.1"), wire("w2", "c2.2", "c1.-")]
    errors = check([SOURCE, RESISTOR], wires)
    assert codes(errors) == ["NO_GROUND"]
    assert errors[0].targets == []


def test_pin_not_connected() -> None:
    errors = check([SOURCE, RESISTOR, GROUND], LOOP[:2])
    assert codes(errors) == ["PIN_NOT_CONNECTED"]
    assert errors[0].targets[0].model_dump() == {"comp": "c1", "pin": "-"}
    assert errors[0].message == "La broche - de V1 n'est reliée à rien."


def test_lonely_ground() -> None:
    errors = check([SOURCE, RESISTOR, GROUND, comp("g2", "ground")], LOOP)
    assert errors[0].message == "La masse n'est reliée à rien."


@pytest.mark.parametrize(
    ("resistor", "code"),
    [
        (comp("c2", "resistor", None, resistance="1k"), "MISSING_NAME"),
        (comp("c2", "resistor", "C1", resistance="1k"), "BAD_PREFIX"),
        (comp("c2", "resistor", "R 1", resistance="1k"), "BAD_PREFIX"),
        (comp("c2", "resistor", "R1", resistance="1kk"), "BAD_VALUE"),
        (comp("c2", "resistor", "R1", resistance=" "), "MISSING_PARAM"),
        (comp("c2", "resistor", "R1"), "MISSING_PARAM"),
    ],
)
def test_component_errors(resistor: dict, code: str) -> None:
    errors = check([SOURCE, resistor, GROUND], LOOP)
    assert codes(errors) == [code]
    assert errors[0].targets[0].model_dump() == {"comp": "c2"}


def test_bad_waveform_choice() -> None:
    source = comp("c1", "voltage_source", "V1", waveform="square", dc="5")
    assert codes(check([source, RESISTOR, GROUND], LOOP)) == ["BAD_VALUE"]


def test_duplicate_name_ignores_case() -> None:
    r2 = comp("c3", "resistor", "r1", resistance="1k")
    errors = check([SOURCE, RESISTOR, r2, GROUND], [*LOOP, wire("w4", "c3.1", "c2.1"),
                                                     wire("w5", "c3.2", "g.1")])  # fmt: skip
    assert codes(errors) == ["DUPLICATE_NAME"]
    assert [t.comp for t in errors[0].targets] == ["c2", "c3"]


def test_duplicate_id() -> None:
    errors = check([SOURCE, RESISTOR, GROUND], [*LOOP, wire("w1", "c2.1", "c1.+")])
    assert codes(errors) == ["DUPLICATE_ID"]


def test_unknown_type() -> None:
    errors = check([SOURCE, RESISTOR, GROUND, comp("t", "triode", "X1")], LOOP)
    assert codes(errors) == ["UNKNOWN_TYPE"]


@pytest.mark.parametrize("target", ["zz.1", "c2.3", "j9"])
def test_unknown_endpoint(target: str) -> None:
    errors = check([SOURCE, RESISTOR, GROUND], [*LOOP, wire("w4", "c2.1", target)])
    assert codes(errors) == ["UNKNOWN_ENDPOINT"]
    assert errors[0].targets[0].model_dump() == {"wire": "w4"}


def test_label_conflict() -> None:
    labels = [comp("l1", "label", net="in"), comp("l2", "label", net="out")]
    wires = [*LOOP, wire("w4", "c1.+", "l1.1"), wire("w5", "c2.1", "l2.1")]
    errors = check([SOURCE, RESISTOR, GROUND, *labels], wires)
    assert codes(errors) == ["LABEL_CONFLICT"]
    assert errors[0].message == "Le nœud porte plusieurs noms : in et out."


def test_label_on_ground() -> None:
    errors = check([SOURCE, RESISTOR, GROUND, comp("l1", "label", net="out")],
                   [*LOOP, wire("w4", "g.1", "l1.1")])  # fmt: skip
    assert codes(errors) == ["LABEL_ON_GROUND"]


@pytest.mark.parametrize("net", ["2out", "n1", "N12", "a-b", ""])
def test_bad_label_name(net: str) -> None:
    errors = check([SOURCE, RESISTOR, GROUND, comp("l1", "label", net=net)],
                   [*LOOP, wire("w4", "c1.+", "l1.1")])  # fmt: skip
    assert codes(errors) == ["MISSING_PARAM" if not net else "BAD_LABEL_NAME"]


@pytest.mark.parametrize(
    ("analysis", "code"),
    [
        (AcAnalysis(input_source_id="zz", start_frequency=1, stop_frequency=10),
         "AC_SOURCE_NOT_FOUND"),
        (AcAnalysis(input_source_id="c2", start_frequency=1, stop_frequency=10),
         "AC_SOURCE_NOT_FOUND"),
        (DcAnalysis(source_id="zz", start=0, stop=1, step=0.1), "DC_SOURCE_NOT_FOUND"),
    ],
)  # fmt: skip
def test_analysis_source_not_found(analysis: Analysis, code: str) -> None:
    assert codes(check([SOURCE, RESISTOR, GROUND], LOOP, analysis)) == [code]


def test_all_errors_are_reported_at_once() -> None:
    resistor = comp("c2", "resistor", "C1", resistance="abc")
    errors = check([SOURCE, resistor], LOOP[:1])
    assert sorted(codes(errors)) == ["BAD_PREFIX", "BAD_VALUE", "NO_GROUND",
                                     "PIN_NOT_CONNECTED", "PIN_NOT_CONNECTED"]  # fmt: skip


# --- Security: nothing from the schematic may add its own SPICE lines (review of PR #131) ---

INJECTION = '\n.model p d_process(process_file="calc.exe")\nA1 [a] [b] p'
SAFE_NETLIST = "V1 n1 0 DC 5\nR1 n1 0 1k\n.op\n.end\n"


@pytest.mark.parametrize("separator", ["\n", "\r", "\r\n", "\u2028", "\x85", "\x0b", "\x00"])
def test_title_stays_on_one_line(separator: str) -> None:
    title = "x" + INJECTION.replace("\n", separator)
    circuit = schematic([SOURCE, RESISTOR, GROUND], LOOP)
    circuit.title = title
    result = generate_netlist(circuit, OP)

    header, rest = result.netlist.split("\n", 1)
    assert header.startswith("* x ")
    assert rest == SAFE_NETLIST


@pytest.mark.parametrize("title", [None, "", "  ", "\n\r"])
def test_empty_title_gives_the_default_header(title: str | None) -> None:
    circuit = schematic([SOURCE, RESISTOR, GROUND], LOOP)
    circuit.title = title
    assert generate_netlist(circuit, OP).netlist.startswith("* Psice\n")


@pytest.mark.parametrize("key", ["name", "pin:1", "pin:2", "unknown", "waveform"])
def test_extra_params_never_reach_the_netlist(key: str) -> None:
    # Only the checked parameters of the library are written: an extra key is ignored,
    # and it cannot replace the name or the nodes.
    resistor = comp("c2", "resistor", "R1", resistance="1k")
    resistor["params"][key] = "R9 in 0 1k" + INJECTION
    result = generate_netlist(schematic([SOURCE, resistor, GROUND], LOOP), OP)

    assert result.netlist == "* Psice\n" + SAFE_NETLIST


def test_free_texts_and_text_offsets_never_reach_the_netlist() -> None:
    # Texts are decorative (#123): whatever they contain, the netlist is the same as without.
    resistor = comp("c2", "resistor", "R1", resistance="1k")
    resistor["name_offset"] = {"x": 1.5, "y": -0.5}
    resistor["value_offset"] = {"x": 1.5, "y": 0.5}
    circuit = schematic([SOURCE, resistor, GROUND], LOOP)
    circuit.texts = [
        Text(id="t1", position=Point(x=0, y=0), content="R9 in 0 1k" + INJECTION),
        Text(id="c2", position=Point(x=4, y=4), content="même id qu'un composant"),
    ]
    result = generate_netlist(circuit, OP)

    assert result.netlist == "* Psice\n" + SAFE_NETLIST
    # Not an element of the circuit: no diagnostic (not even a duplicate id), no mapping.
    assert result.errors == result.warnings == []
    assert "t1" not in result.components.values()


def test_unused_waveform_params_never_reach_the_netlist() -> None:
    source = comp("c1", "voltage_source", "V1", waveform="dc", dc="5", v1="0" + INJECTION)
    result = generate_netlist(schematic([source, RESISTOR, GROUND], LOOP), OP)
    assert result.netlist == "* Psice\n" + SAFE_NETLIST


def test_waveform_with_spaces_is_checked_like_the_others() -> None:
    # " dc " selects the dc waveform: its "dc" parameter is required and checked
    # (before the fix: 500 KeyError without it, unchecked injection with it).
    missing = comp("c1", "voltage_source", "V1", waveform=" dc ")
    assert codes(check([missing, RESISTOR, GROUND], LOOP)) == ["MISSING_PARAM"]

    injected = comp("c1", "voltage_source", "V1", waveform=" dc ", dc="5" + INJECTION)
    assert codes(check([injected, RESISTOR, GROUND], LOOP)) == ["BAD_VALUE"]


@pytest.mark.parametrize("value", ["1e999", "1e300T", "5\n.control"])
def test_unusable_values_are_bad_values(value: str) -> None:
    resistor = comp("c2", "resistor", "R1", resistance=value)
    assert codes(check([SOURCE, resistor, GROUND], LOOP)) == ["BAD_VALUE"]


@pytest.mark.parametrize(
    "analysis",
    [
        TranAnalysis(stop_time=float("inf")),
        TranAnalysis.model_construct(stop_time=1e-3, max_step=float("nan")),  # skips gt=0
        AcAnalysis(input_source_id="c1", start_frequency=1, stop_frequency=float("inf")),
        DcAnalysis(source_id="c1", start=float("-inf"), stop=1, step=0.1),
    ],
)
def test_infinite_analysis_values_are_bad_values(analysis: Analysis) -> None:
    assert codes(check([SOURCE, RESISTOR, GROUND], LOOP, analysis)) == ["BAD_VALUE"]


def test_milli_suffix_suggestion_keeps_the_unit() -> None:
    resistor = comp("c2", "resistor", "R1", resistance="1Mohm")
    result = generate_netlist(schematic([SOURCE, resistor, GROUND], LOOP), OP)
    assert "« 1Megohm »" in result.warnings[0].message


def test_duplicate_id_targets_every_kind_of_element() -> None:
    wires = [*LOOP, wire("j1", "c2.1", "j1"), wire("c2", "j1", "c2.1")]
    errors = check([SOURCE, RESISTOR, GROUND], wires, junctions=["j1"])
    assert codes(errors) == ["DUPLICATE_ID", "DUPLICATE_ID"]
    assert [t.model_dump() for t in errors[0].targets] == [{"comp": "c2"}, {"wire": "c2"}]
    assert [t.model_dump() for t in errors[1].targets] == [{"junction": "j1"}, {"wire": "j1"}]
