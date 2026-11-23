"""LTspice .asc import (#110): one part per step of the plan (20a to 20d), then golden tests."""

from pathlib import Path

import pytest
from pydantic import TypeAdapter

from app.engines import NgspiceNotFoundError, locate_ngspice, run_simulation
from app.importers.asc import AscFormatError, import_asc
from app.importers.asc_reader import decode, read_asc
from app.importers.asc_symbols import parse_orientation, place, symbol_key
from app.models import (
    AcAnalysis,
    Analysis,
    DcAnalysis,
    JunctionEnd,
    OpAnalysis,
    PinEnd,
    Schematic,
    TranAnalysis,
)
from app.netlist.generate import generate_netlist

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "shared" / "fixtures"
ASC_CIRCUITS = sorted(p.parent.name for p in FIXTURES_DIR.glob("*/circuit.asc"))

HEADER = "Version 4\nSHEET 1 880 680\n"


def asc(*lines: str) -> str:
    return HEADER + "\n".join(lines) + "\n"


# --- 20a. Reading the file ---------------------------------------------------------------------


def test_read_lines() -> None:
    parsed = read_asc(
        asc(
            "WIRE 0 16 80 16",
            "FLAG 0 96 0",
            "SYMBOL res 64 32 R270",
            "WINDOW 0 32 56 VTop 2",
            "SYMATTR InstName R1",
            "SYMATTR Value 1k",
            "TEXT 0 152 Left 2 !.tran 5m",
            "TEXT 0 200 Left 2 ;a comment",
        )
    )
    assert (parsed.wires[0].x1, parsed.wires[0].x2) == (0, 80)
    assert parsed.flags[0].name == "0"
    symbol = parsed.symbols[0]
    assert (symbol.name, symbol.x, symbol.y, symbol.orientation) == ("res", 64, 32, "R270")
    assert symbol.attributes == {"InstName": "R1", "Value": "1k"}
    assert parsed.directives == [".tran 5m"]  # the comment is not a directive


def test_several_directives_in_one_text() -> None:
    assert read_asc(asc("TEXT 0 0 Left 2 !.op\\n.tran 1m")).directives == [".op", ".tran 1m"]


@pytest.mark.parametrize(
    "data",
    [
        HEADER.encode("utf-16"),  # LTspice XVII: UTF-16 with BOM
        HEADER.encode("utf-16-le"),  # without BOM
        HEADER.encode("utf-8"),
        HEADER.encode("latin-1"),
    ],
)
def test_decode_the_encodings_of_ltspice(data: bytes) -> None:
    assert decode(data).startswith("Version 4")


def test_decode_latin1_values() -> None:
    assert "1µ" in decode((HEADER + "SYMATTR Value 1µ\n").encode("latin-1"))


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("hello", "Version"),
        (asc("WIRE 0 0 16"), "fil incomplet"),
        (asc("WIRE a b c d"), "coordonnées invalides"),
        (asc("FLAG 0 0"), "étiquette incomplète"),
        (asc("SYMBOL res 0 0"), "symbole incomplet"),
    ],
)
def test_unreadable_files(text: str, message: str) -> None:
    with pytest.raises(AscFormatError, match=message):
        read_asc(text)


def test_file_too_large() -> None:
    with pytest.raises(AscFormatError, match="volumineux"):
        decode(b" " * 2_000_000)


# --- 20b. Symbols and pin positions ------------------------------------------------------------


@pytest.mark.parametrize(
    ("orientation", "expected"),
    [
        ("R0", (16, 96)),
        ("R90", (-96, 16)),  # 90 degrees clockwise, y axis down
        ("R180", (-16, -96)),
        ("R270", (96, -16)),
        ("M0", (-16, 96)),  # mirror x -> -x
        ("M90", (-96, -16)),  # mirror first, then rotate
    ],
)
def test_place_a_pin(orientation: str, expected: tuple[int, int]) -> None:
    rotation, mirror = parse_orientation(orientation)
    assert place(16, 96, rotation, mirror) == expected


@pytest.mark.parametrize("orientation", ["R45", "X0", ""])
def test_unknown_orientation(orientation: str) -> None:
    with pytest.raises(ValueError):
        parse_orientation(orientation)


def test_symbol_key_ignores_the_folder_and_the_case() -> None:
    assert symbol_key("Misc\\RES") == symbol_key("res") == "res"


# --- 20c. Connections --------------------------------------------------------------------------


def ends(wire) -> set:
    return {
        (e.comp, e.pin) if isinstance(e, PinEnd) else e.junction
        for e in (wire.from_, wire.to)
        if isinstance(e, PinEnd | JunctionEnd)
    }


def test_two_pins_give_one_wire() -> None:
    result = import_asc(asc("WIRE 0 16 80 16", "SYMBOL voltage 0 0 R0", "SYMATTR InstName V1",
                            "SYMBOL res 64 32 R270", "SYMATTR InstName R1"))  # fmt: skip
    assert [ends(w) for w in result.schematic.wires] == [{("c1", "+"), ("c2", "1")}]


def test_three_pins_meet_at_a_junction() -> None:
    result = import_asc(FIXTURES_DIR.joinpath("loaded_divider_dc", "circuit.asc").read_bytes())
    junctions = result.schematic.junctions
    assert len(junctions) == 1
    around = [ends(w) for w in result.schematic.wires if junctions[0].id in ends(w)]
    assert sorted(next(e for e in pair if e != "j1") for pair in around) == [
        ("c2", "2"),
        ("c3", "1"),
        ("c4", "1"),
    ]


def test_pin_in_the_middle_of_a_wire_is_connected() -> None:
    # The wire goes from x=0 to x=160; R1's pin 1 (at x=80) touches its middle: a "T".
    result = import_asc(asc("WIRE 0 16 160 16", "SYMBOL voltage 0 0 R0", "SYMATTR InstName V1",
                            "SYMBOL res 64 0 R0", "SYMATTR InstName R1",
                            "FLAG 160 16 out"))  # fmt: skip
    assert len(result.schematic.junctions) == 1
    assert len(result.schematic.wires) == 3


def test_pins_at_the_same_place_are_connected() -> None:
    # No wire at all: the flag sits on the pin.
    result = import_asc(asc("SYMBOL voltage 0 0 R0", "SYMATTR InstName V1", "FLAG 0 96 0"))
    assert [ends(w) for w in result.schematic.wires] == [{("c1", "-"), ("c2", "1")}]


def test_lonely_pin_gives_no_wire() -> None:
    result = import_asc(asc("SYMBOL res 0 0 R0", "SYMATTR InstName R1"))
    assert result.schematic.wires == []  # the netlist will say PIN_NOT_CONNECTED


def test_flags() -> None:
    result = import_asc(asc("FLAG 0 0 0", "FLAG 0 16 GND", "FLAG 0 32 out", "FLAG 0 48 V out",
                            "FLAG 0 64 2x", "FLAG 0 80 n3"))  # fmt: skip
    components = result.schematic.components
    assert [c.type for c in components] == ["ground", "ground", "label", "label", "label", "label"]
    assert [c.params["net"] for c in components[2:]] == ["out", "V_out", "N_2x", "N_n3"]
    assert len(result.warnings) == 3  # the 3 renamed nodes


# --- 20d. Values, sources and directives -------------------------------------------------------


def source(value: str, value2: str = "", symbol: str = "voltage") -> dict[str, str]:
    lines = [f"SYMBOL {symbol} 0 0 R0", "SYMATTR InstName V1", f"SYMATTR Value {value}"]
    if value2:
        lines.append(f"SYMATTR Value2 {value2}")
    return import_asc(asc(*lines)).schematic.components[0].params


def test_dc_source() -> None:
    assert source("5")["dc"] == "5"
    assert source("DC 3.3")["dc"] == "3.3"
    assert source("DC 3.3")["waveform"] == "dc"


def test_pulse_source() -> None:
    params = source("PULSE(0 5 1m 1n 1n 5m 10m 3)")
    assert params["waveform"] == "pulse"
    assert [params[k] for k in ("v1", "v2", "delay", "rise", "fall", "width", "period")] == [
        "0", "5", "1m", "1n", "1n", "5m", "10m",
    ]  # fmt: skip


def test_sin_source_with_missing_arguments_keeps_the_defaults() -> None:
    params = source("SIN(0 1 50)")
    assert (params["waveform"], params["amplitude"], params["frequency"]) == ("sin", "1", "50")
    assert params["phase"] == "0"  # default of the library


def test_current_source_uses_i1_i2() -> None:
    params = source("PULSE(0 1m 0 1n 1n 1m 2m)", symbol="current")
    assert (params["i1"], params["i2"]) == ("0", "1m")


def test_unsupported_waveform_is_an_error() -> None:
    result = import_asc(asc("SYMBOL voltage 0 0 R0", "SYMATTR InstName V1",
                            "SYMATTR Value PWL(0 0 1m 5)"))  # fmt: skip
    assert "PWL" in result.errors[0]


def test_micro_sign_becomes_u() -> None:
    result = import_asc(asc("SYMBOL cap 0 0 R0", "SYMATTR InstName C1", "SYMATTR Value 4.7µ"))
    assert result.schematic.components[0].params["capacitance"] == "4.7u"


def test_missing_value_uses_the_default() -> None:
    result = import_asc(asc("SYMBOL res 0 0 R0", "SYMATTR InstName R1"))
    assert result.schematic.components[0].params["resistance"] == "1k"
    assert "valeur par défaut" in result.warnings[0]


def test_unsupported_symbol_is_an_error() -> None:
    result = import_asc(asc("SYMBOL OpAmps\\LT1001 0 0 R0", "SYMATTR InstName U1"))
    assert result.schematic.components == []
    assert "LT1001" in result.errors[0] and "U1" in result.errors[0]


def test_unknown_orientation_is_an_error() -> None:
    result = import_asc(asc("SYMBOL res 0 0 R45", "SYMATTR InstName R1"))
    assert "R45" in result.errors[0]


@pytest.mark.parametrize(
    ("directive", "expected"),
    [
        (".op", OpAnalysis()),
        (".tran 5m", TranAnalysis(stop_time=0.005)),  # short LTspice form
        (".tran 1u 5m", TranAnalysis(stop_time=0.005)),
        (".tran 0 5m 0 10u", TranAnalysis(stop_time=0.005, max_step=1e-5)),
        (".tran 0 5m 0 10u startup", TranAnalysis(stop_time=0.005, max_step=1e-5)),
        (".dc V1 0 10 1", DcAnalysis(source_id="c1", start=0, stop=10, step=1)),
    ],
)
def test_analysis_directives(directive: str, expected: Analysis) -> None:
    text = asc("SYMBOL voltage 0 0 R0", "SYMATTR InstName V1", "SYMATTR Value 1",
               f"TEXT 0 0 Left 2 !{directive}")  # fmt: skip
    assert import_asc(text).analysis == expected


def test_ac_uses_the_source_marked_ac() -> None:
    text = asc("SYMBOL voltage 0 0 R0", "SYMATTR InstName V1", "SYMATTR Value 5",
               "SYMBOL voltage 0 0 R0", "SYMATTR InstName V2", "SYMATTR Value 0",
               "SYMATTR Value2 AC 1", "TEXT 0 0 Left 2 !.ac dec 10 1 1k")  # fmt: skip
    assert import_asc(text).analysis == AcAnalysis(
        input_source_id="c2", start_frequency=1, stop_frequency=1000, points_per_decade=10
    )


@pytest.mark.parametrize(
    ("directive", "warning"),
    [
        (".ac oct 10 1 1k", "dec"),  # only per decade
        (".ac dec 10 1 1k", "AC"),  # no source has an AC amplitude
        (".ac dec ten 1 1k", "pas pu être lue"),
        (".tran abc", "pas pu être lue"),
        (".dc V9 0 1 0.1", "pas pu être lue"),  # unknown source
        (".param R=1k", "ignorée"),
        (".include models.lib", "ignorée"),  # never copied: the netlist only uses Psice data
    ],
)
def test_directive_warnings(directive: str, warning: str) -> None:
    text = asc("SYMBOL voltage 0 0 R0", "SYMATTR InstName V1", "SYMATTR Value 1",
               f"TEXT 0 0 Left 2 !{directive}")  # fmt: skip
    result = import_asc(text)
    assert result.analysis is None
    assert warning in result.warnings[-1]


def test_only_the_first_analysis_is_kept() -> None:
    result = import_asc(asc("TEXT 0 0 Left 2 !.op", "TEXT 0 0 Left 2 !.tran 1m"))
    assert result.analysis == OpAnalysis()
    assert "première" in result.warnings[0]


def test_diode_models_are_replaced_by_psice_models() -> None:
    lines = [
        "SYMBOL diode 0 0 R0", "SYMATTR InstName D1", "SYMATTR Value 1N4148",
        "SYMBOL diode 0 0 R0", "SYMATTR InstName D2", "SYMATTR Value 1N4007",
        "SYMBOL zener 0 0 R0", "SYMATTR InstName D3", "SYMATTR Value BZX84C3V3",
        "SYMBOL led 0 0 R0", "SYMATTR InstName D4", "SYMATTR Value LXHL-GREEN",
    ]  # fmt: skip
    result = import_asc(asc(*lines))
    models = [c.params["model"] for c in result.schematic.components]
    assert models == ["D_SIGNAL", "D_RECT", "D_Z3V3", "D_LED_GREEN"]
    assert len(result.warnings) == 4


# --- Golden tests: an .asc of each reference circuit gives exactly its netlist ----------------


def read(circuit: str, name: str) -> str:
    return (FIXTURES_DIR / circuit / name).read_text("utf-8")


def test_there_are_asc_examples() -> None:
    assert len(ASC_CIRCUITS) >= 3  # acceptance criterion of #110


@pytest.mark.parametrize("circuit", ASC_CIRCUITS)
def test_asc_gives_the_reference_netlist(circuit: str) -> None:
    reference = Schematic.model_validate_json(read(circuit, "schematic.json"))
    result = import_asc((FIXTURES_DIR / circuit / "circuit.asc").read_bytes(), reference.title)

    assert result.errors == []
    assert result.analysis == TypeAdapter(Analysis).validate_json(read(circuit, "analysis.json"))
    netlist = generate_netlist(result.schematic, result.analysis)
    assert netlist.errors == []
    assert netlist.netlist == read(circuit, "netlist.cir")


def has_ngspice() -> bool:
    try:
        locate_ngspice()
    except NgspiceNotFoundError:
        return False
    return True


@pytest.mark.ngspice
@pytest.mark.skipif(not has_ngspice(), reason="ngspice is not available")
@pytest.mark.parametrize("circuit", ["divider_op", "rc_tran"])
def test_imported_asc_simulates(circuit: str) -> None:
    # Acceptance criterion of #110: the imported circuits simulate.
    result = import_asc((FIXTURES_DIR / circuit / "circuit.asc").read_bytes())
    assert result.analysis is not None
    simulation = run_simulation(
        generate_netlist(result.schematic, result.analysis), result.analysis
    )
    assert simulation.errors == []
    assert simulation.traces
