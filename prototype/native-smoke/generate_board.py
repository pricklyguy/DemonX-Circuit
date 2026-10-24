#!/usr/bin/env python3
"""Build the tiny LED board from the KiCad-exported schematic netlist."""

import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pcbnew


ROOT = Path(__file__).resolve().parents[2]
PROJECT_DIR = ROOT / "examples" / "native-smoke" / "DX_LED_Smoke"
PROJECT = PROJECT_DIR / "DX_LED_Smoke"
NETLIST = Path(sys.argv[1]).resolve()
board_path = PROJECT.with_suffix(".kicad_pcb")

footprint_root = Path(os.environ.get("KICAD_FOOTPRINT_DIR", "/usr/share/kicad/footprints"))
if not footprint_root.is_dir():
    raise FileNotFoundError(f"KiCad footprint libraries not found: {footprint_root}")

root = ET.parse(NETLIST).getroot()
component_data = {}
for component in root.findall("./components/comp"):
    footprint = component.findtext("footprint")
    if not footprint or ":" not in footprint:
        raise RuntimeError(f"Missing library footprint for {component.get('ref')}")
    component_data[component.get("ref")] = {
        "footprint": footprint,
        "value": component.findtext("value", default=""),
    }

placements = {
    "J1": (45.0, 50.0, 0),
    "R1": (60.0, 50.0, 0),
    "D1": (75.0, 50.0, 0),
}
board = pcbnew.BOARD()
board.GetDesignSettings().SetCopperLayerCount(2)
footprints = {}

for reference, (x, y, angle) in placements.items():
    component = component_data[reference]
    library_name, footprint_name = component["footprint"].split(":", 1)
    library_path = footprint_root / f"{library_name}.pretty"
    footprint = pcbnew.FootprintLoad(str(library_path), footprint_name)
    if footprint is None:
        raise RuntimeError(f"Cannot load {component['footprint']}")
    footprint.SetReference(reference)
    footprint.SetValue(component["value"])
    footprint.SetPosition(
        pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y))
    )
    footprint.SetOrientationDegrees(angle)
    board.Add(footprint)
    footprints[reference] = footprint

net_items = {}
net_nodes = {}
for net in root.findall("./nets/net"):
    code = int(net.get("code"))
    name = net.get("name", f"N${code}")
    if code == 0:
        continue
    item = pcbnew.NETINFO_ITEM(board, name, code)
    board.Add(item)
    net_items[name] = item
    net_nodes[name] = [(node.get("ref"), node.get("pin")) for node in net.findall("node")]

for name, nodes in net_nodes.items():
    for reference, pin_number in nodes:
        if reference not in footprints:
            continue
        pad = footprints[reference].FindPadByNumber(pin_number)
        if pad is None:
            raise RuntimeError(f"No pad {reference}.{pin_number} for net {name}")
        pad.SetNet(net_items[name])


def point_mm(point):
    return pcbnew.VECTOR2I(pcbnew.FromMM(point[0]), pcbnew.FromMM(point[1]))


def route(net_name, waypoints, start_reference=None):
    nodes = net_nodes[net_name]
    if len(nodes) != 2:
        raise RuntimeError(f"Expected two pins on {net_name}, found {nodes}")
    if start_reference and nodes[0][0] != start_reference:
        nodes = list(reversed(nodes))
    start_ref, start_pin = nodes[0]
    end_ref, end_pin = nodes[1]
    start = footprints[start_ref].FindPadByNumber(start_pin).GetPosition()
    end = footprints[end_ref].FindPadByNumber(end_pin).GetPosition()
    points = [start, *(point_mm(p) for p in waypoints), end]
    for first, second in zip(points, points[1:]):
        segment = pcbnew.PCB_TRACK(board)
        segment.SetStart(first)
        segment.SetEnd(second)
        segment.SetWidth(pcbnew.FromMM(0.5))
        segment.SetLayer(pcbnew.F_Cu)
        segment.SetNet(net_items[net_name])
        board.Add(segment)


for name, nodes in net_nodes.items():
    if len(nodes) != 2:
        raise RuntimeError(f"Expected two pins on {name}, found {nodes}")
    refs = {reference for reference, _ in nodes}
    if refs == {"D1", "J1"}:
        route(name, [(78.0, 50.0), (78.0, 56.0), (43.0, 56.0), (43.0, 52.5)], "D1")
    else:
        route(name, [])

# A 40 x 14 mm outline around the simple thru-hole circuit.
edge = pcbnew.PCB_SHAPE()
edge.SetShape(pcbnew.SHAPE_T_RECT)
edge.SetStart(point_mm((40.0, 44.0)))
edge.SetEnd(point_mm((80.0, 58.0)))
edge.SetLayer(pcbnew.Edge_Cuts)
edge.SetWidth(pcbnew.FromMM(0.05))
board.Add(edge)

pcbnew.SaveBoard(str(board_path), board)
print(f"Created routed native board {board_path}")
print(f"Board nets: {', '.join(sorted(net_items))}")
