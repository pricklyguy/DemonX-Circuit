#!/usr/bin/env python3
"""Create a placed two-layer candidate board from KiCad's verified netlist.

This script does not declare the design manufacturing-ready. Tracks are added
only by the separate, pinned FreeRouting DSN/SES smoke step and are checked by
KiCad DRC without rule suppression.
"""
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pcbnew


ROOT = Path(__file__).resolve().parents[2]
PROJECT_DIR = ROOT / "examples/esp32-sensor/native"
PROJECT = PROJECT_DIR / "DX_ESP32_Sensor"
NETLIST = Path(sys.argv[1]).resolve()
FOOTPRINT_ROOT = Path(os.environ.get("KICAD_FOOTPRINT_DIR", "/usr/share/kicad/footprints"))
BOARD_FILE = PROJECT.with_suffix(".kicad_pcb")
DSN_FILE = ROOT / "reports/native-reference/layout/DX_ESP32_Sensor.dsn"

if BOARD_FILE.exists() or DSN_FILE.exists():
    raise FileExistsError("Refusing to overwrite an existing reference PCB or DSN export")

# Board coordinates in mm are prototype placements for router/DRC evaluation.
# U1 antenna-end keepout travels with KiCad's upstream RF_Module footprint.
PLACEMENTS = {
    "J1": (11.0, 72.0, 90),
    "U3": (23.0, 51.0, 0), "C1": (12.0, 50.0, 0), "L1": (34.0, 51.0, 0),
    "C2": (26.0, 42.0, 90), "C3": (43.0, 52.0, 0), "C4": (48.0, 52.0, 0),
    "R1": (43.0, 42.0, 90), "R2": (49.0, 42.0, 90),
    "R7": (25.0, 34.0, 90), "C6": (31.0, 34.0, 90),
    "U1": (69.0, 31.0, 0),
    "U2": (58.0, 70.0, 0), "C5": (52.0, 76.0, 0),
    "R3": (65.0, 76.0, 90), "R4": (70.0, 76.0, 90), "R8": (77.0, 76.0, 90),
    "R5": (84.0, 54.0, 0), "R6": (89.0, 54.0, 0),
    "Q1": (91.0, 63.0, 0), "D1": (99.0, 63.0, 0),
    "K1": (100.0, 77.0, 0), "J2": (117.0, 74.0, 90),
}

root = ET.parse(NETLIST).getroot()
component_data = {}
for comp in root.findall("./components/comp"):
    reference = comp.get("ref")
    footprint = comp.findtext("footprint")
    if not footprint or ":" not in footprint:
        raise RuntimeError(f"Missing KiCad footprint assignment for {reference}")
    component_data[reference] = {"footprint": footprint, "value": comp.findtext("value", default="")}
missing = sorted(set(component_data) - set(PLACEMENTS))
unknown = sorted(set(PLACEMENTS) - set(component_data))
if missing or unknown:
    raise RuntimeError(f"Placement map mismatch; missing={missing}, unknown={unknown}")

board = pcbnew.BOARD()
board.GetDesignSettings().SetCopperLayerCount(2)
footprints = {}
for reference, (x, y, angle) in PLACEMENTS.items():
    library, name = component_data[reference]["footprint"].split(":", 1)
    if library == "DemonX_Project":
        library_path = ROOT / "examples/esp32-sensor/libraries/DemonX_Project.pretty"
    else:
        library_path = FOOTPRINT_ROOT / f"{library}.pretty"
    footprint = pcbnew.FootprintLoad(str(library_path), name)
    if footprint is None:
        raise RuntimeError(f"Unable to load {component_data[reference]['footprint']}")
    footprint.SetReference(reference)
    footprint.SetValue(component_data[reference]["value"])
    footprint.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y)))
    footprint.SetOrientationDegrees(angle)
    board.Add(footprint)
    footprints[reference] = footprint

net_items, net_nodes = {}, {}
for net in root.findall("./nets/net"):
    code, name = int(net.get("code")), net.get("name", "")
    if code == 0:
        continue
    item = pcbnew.NETINFO_ITEM(board, name, code)
    board.Add(item)
    net_items[name] = item
    net_nodes[name] = [(node.get("ref"), node.get("pin")) for node in net.findall("node")]
for net_name, nodes in net_nodes.items():
    for reference, number in nodes:
        pad = footprints[reference].FindPadByNumber(number)
        if pad is None:
            raise RuntimeError(f"KiCad footprint {reference} has no pad {number} for net {net_name}")
        pad.SetNet(net_items[net_name])

def mm(x, y):
    return pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y))

# Rounded board geometry is deliberately avoided in this first candidate;
# manufacturing geometry is a four-segment, 128 x 90 mm rectangular outline.
outline = [(5.0, 5.0), (133.0, 5.0), (133.0, 95.0), (5.0, 95.0)]
for start, end in zip(outline, outline[1:] + outline[:1]):
    edge = pcbnew.PCB_SHAPE()
    edge.SetShape(pcbnew.SHAPE_T_SEGMENT)
    edge.SetStart(mm(*start))
    edge.SetEnd(mm(*end))
    edge.SetLayer(pcbnew.Edge_Cuts)
    edge.SetWidth(pcbnew.FromMM(0.05))
    board.Add(edge)

pcbnew.SaveBoard(str(BOARD_FILE), board)
DSN_FILE.parent.mkdir(parents=True, exist_ok=True)
if not pcbnew.ExportSpecctraDSN(board, str(DSN_FILE)):
    raise RuntimeError("KiCad pcbnew.ExportSpecctraDSN failed")
print(f"Created native candidate board: {BOARD_FILE}")
print(f"Placed footprints: {len(footprints)}; nets: {len(net_items)}")
print(f"Board outline: x=5..133 mm, y=5..95 mm; 2 copper layers")
print("ESP32-S3-WROOM-1 KiCad footprint includes antenna keepout polygons; verify their placement before accepting DRC.")
print("Candidate layout only — NOT APPROVED FOR MANUFACTURE.")
print(f"Exported Specctra DSN: {DSN_FILE}")
