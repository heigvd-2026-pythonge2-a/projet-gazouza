"""ngspice simulation engine: binary locator, subprocess runner, and rawfile parser."""

from app.engines.locator import NGSPICE_PATH_ENV_VAR, NgspiceNotFoundError, locate_ngspice
from app.engines.parser import (
    RawParseError,
    RawPlot,
    RawVariable,
    map_plot_to_simulation_result,
    parse_ngspice_output,
    parse_raw_ascii,
)
from app.engines.runner import DEFAULT_TIMEOUT_SECONDS, prepare_netlist, run_simulation

__all__ = [
    "DEFAULT_TIMEOUT_SECONDS",
    "NGSPICE_PATH_ENV_VAR",
    "NgspiceNotFoundError",
    "RawParseError",
    "RawPlot",
    "RawVariable",
    "locate_ngspice",
    "map_plot_to_simulation_result",
    "parse_ngspice_output",
    "parse_raw_ascii",
    "prepare_netlist",
    "run_simulation",
]
