"""ngspice simulation engine: binary locator, subprocess runner, and rawfile parser."""

from app.engines.locator import NGSPICE_PATH_ENV_VAR, NgspiceNotFoundError, locate_ngspice
from app.engines.parser import (
    MAX_RESULT_POINTS,
    RawParseError,
    RawPlot,
    RawVariable,
    map_plot_to_simulation_result,
    parse_ngspice_output,
    parse_raw_ascii,
)
from app.engines.runner import (
    DEFAULT_TIMEOUT_SECONDS,
    MAX_NETLIST_BYTES,
    MAX_RAWFILE_BYTES,
    UnsafeNetlistError,
    prepare_netlist,
    run_simulation,
    validate_netlist_safety,
)

__all__ = [
    "DEFAULT_TIMEOUT_SECONDS",
    "MAX_NETLIST_BYTES",
    "MAX_RAWFILE_BYTES",
    "MAX_RESULT_POINTS",
    "NGSPICE_PATH_ENV_VAR",
    "NgspiceNotFoundError",
    "RawParseError",
    "RawPlot",
    "RawVariable",
    "UnsafeNetlistError",
    "locate_ngspice",
    "map_plot_to_simulation_result",
    "parse_ngspice_output",
    "parse_raw_ascii",
    "prepare_netlist",
    "run_simulation",
    "validate_netlist_safety",
]
