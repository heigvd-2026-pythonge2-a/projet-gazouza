"""Damaged inputs never crash the backend: always a French Diagnostic, never an HTTP 500.

Random mutations of real files with a fixed seed, so a failure is reproducible. Each test
prints nothing and takes a few seconds; raise ROUNDS locally to search harder.
"""

import copy
import json
import random
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.importers.asc import AscFormatError, import_asc
from app.main import app
from app.models import TranAnalysis
from app.netlist.generate import generate_netlist
from app.netlist.library import get_library

ROUNDS = 400
FIXTURES = Path(__file__).parents[2] / "shared" / "fixtures"
LTSPICE = Path(__file__).parent / "ltspice"

JUNK = [
    "", " ", "-", "0", "-5", "1k", "1M", "1meg", "10u", "abc", "é", "\x00", "{x}", "R0", "n1",
    "gnd", "1e999", "1e-400", "nan", "inf", "-inf", "1e308", "999999999999999999999999",
    "x" * 2000,
]  # fmt: skip

ANALYSES = [
    {"kind": "op"},
    {"kind": "tran", "stop_time": 1e-3},
    {"kind": "tran", "stop_time": 1, "points": 7},
    {"kind": "tran", "stop_time": 1e-300, "points": 1},
    {"kind": "tran", "stop_time": 1e300},
    {"kind": "tran", "stop_time": 1, "max_step": 1e-300},
    {"kind": "ac", "input_source_id": "c1", "start_frequency": 1, "stop_frequency": 1e6},
    {"kind": "ac", "input_source_id": "nope", "start_frequency": 1e6, "stop_frequency": 1},
    {"kind": "dc", "source_id": "c1", "start": 0, "stop": 5, "step": 0.1},
    {"kind": "dc", "source_id": "c1", "start": 0, "stop": 1e300, "step": 1e-300},
]


def read_text(path: Path) -> str:
    data = path.read_bytes()
    utf16 = data[:2] in (b"\xff\xfe", b"\xfe\xff") or data[1:2] == b"\x00"
    return data.decode("utf-16" if utf16 else "latin-1")


def damage_asc(text: str, rng: random.Random) -> str:
    lines = text.splitlines()
    for _ in range(rng.randint(1, 4)):
        i = rng.randrange(len(lines))
        tokens = lines[i].split(" ")
        roll = rng.random()
        if roll < 0.5 and len(tokens) > 1:
            tokens[rng.randrange(len(tokens))] = rng.choice(JUNK)
        elif roll < 0.7:
            tokens = tokens[: rng.randrange(len(tokens) + 1)]
        elif roll < 0.85:
            lines.insert(i, rng.choice(lines))
            continue
        else:
            tokens.append(rng.choice(JUNK))
        lines[i] = " ".join(tokens)
    return "\n".join(lines)


def damage_schematic(schematic: dict, rng: random.Random, types: list[str]) -> None:
    components = schematic["components"]
    for step in range(rng.randint(1, 4)):
        if not components:
            return
        comp = rng.choice(components)
        roll = rng.random()
        if roll < 0.3 and comp["params"]:
            comp["params"][rng.choice(list(comp["params"]))] = rng.choice(JUNK)
        elif roll < 0.4:
            comp["type"] = rng.choice(types)
        elif roll < 0.5:
            comp["name"] = rng.choice([*JUNK, None])
        elif roll < 0.6 and schematic["wires"]:
            schematic["wires"].pop(rng.randrange(len(schematic["wires"])))
        elif roll < 0.7:
            twin = copy.deepcopy(comp)
            twin["id"] = rng.choice([comp["id"], f"z{step}"])
            components.append(twin)
        elif roll < 0.8:
            components.remove(comp)
        elif roll < 0.9:
            comp["params"]["waveform"] = rng.choice(["sin", "pulse", "dc", "x"])
        else:
            name = rng.choice(["model", "state", "direction", "net"])
            comp["params"][name] = rng.choice(JUNK)


def test_damaged_asc_files_never_crash() -> None:
    texts = [read_text(p) for p in sorted([*LTSPICE.glob("*.asc"), *FIXTURES.glob("*/*.asc")])]
    assert texts
    rng = random.Random(1)
    for _ in range(ROUNDS):
        text = damage_asc(rng.choice(texts), rng)
        try:
            imported = import_asc(text)
        except AscFormatError:
            continue  # an unreadable file: IMPORT_UNREADABLE for the student
        analysis = imported.analysis or TranAnalysis(stop_time=1e-3)
        generate_netlist(imported.schematic, analysis)


def test_damaged_schematics_never_give_http_500() -> None:
    client = TestClient(app)
    types = list(get_library())
    cases = [
        (
            json.loads((d / "schematic.json").read_text("utf-8")),
            json.loads((d / "analysis.json").read_text("utf-8")),
        )
        for d in sorted(FIXTURES.iterdir())
        if (d / "schematic.json").exists()
    ]
    assert cases
    rng = random.Random(2)
    for _ in range(ROUNDS):
        schematic, analysis = copy.deepcopy(rng.choice(cases))
        if rng.random() < 0.5:
            analysis = rng.choice(ANALYSES)
        damage_schematic(schematic, rng, types)
        request = {"schematic": schematic, "analysis": analysis}
        response = client.post("/api/netlist", json=request)
        assert response.status_code in (200, 422), json.dumps(request)[:2000]


@pytest.mark.parametrize("seed", [3])
def test_damaged_asc_text_through_the_api(seed: int) -> None:
    client = TestClient(app)
    texts = [read_text(p) for p in sorted(FIXTURES.glob("*/*.asc"))]
    rng = random.Random(seed)
    for _ in range(ROUNDS // 4):
        text = damage_asc(rng.choice(texts), rng)
        response = client.post("/api/import/asc", json={"text": text})
        assert response.status_code == 200, text[:2000]
