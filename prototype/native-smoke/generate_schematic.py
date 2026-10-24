#!/usr/bin/env python3
"""Create a tiny editable KiCad project fixture for the isolated CLI smoke run."""

import json
from pathlib import Path

import kicad_sch_api as ksa


ROOT = Path(__file__).resolve().parents[2]
PROJECT_DIR = ROOT / "examples" / "native-smoke" / "DX_LED_Smoke"
PROJECT_DIR.mkdir(parents=True, exist_ok=True)
PROJECT = PROJECT_DIR / "DX_LED_Smoke"
for suffix in (".kicad_pro", ".kicad_sch", ".kicad_pcb"):
    if PROJECT.with_suffix(suffix).exists():
        raise FileExistsError(f"Refusing to replace existing native project file: {PROJECT.with_suffix(suffix)}")

schematic = ksa.create_schematic("DX_LED_Smoke")
schematic.components.add(
    lib_id="Connector_Generic:Conn_01x02",
    reference="J1",
    value="5V INPUT",
    position=(50.8, 50.8),
    footprint="Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical",
)
schematic.components.add(
    lib_id="Device:R",
    reference="R1",
    value="330",
    position=(63.5, 50.8),
    footprint="Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal",
)
schematic.components.add(
    lib_id="Device:LED",
    reference="D1",
    value="RED LED",
    position=(76.2, 50.8),
    footprint="LED_THT:LED_D5.0mm",
)

# 5V_IN -> R1 -> LED -> GND. All symbol pins are deliberately passive so ERC
# checks the wiring without requiring a power-input source symbol for this demo.
schematic.add_wire_between_pins("J1", "1", "R1", "1")
schematic.add_wire_between_pins("R1", "2", "D1", "1")
schematic.add_wire_between_pins("D1", "2", "J1", "2")

for pin_number, name in (("1", "5V_IN"), ("2", "GND")):
    position = schematic.get_component_pin_position("J1", pin_number)
    if position is None:
        raise RuntimeError(f"Could not resolve J1 pin {pin_number} position")
    schematic.add_label(name, position=(position.x, position.y))

issues = schematic.validate()
if issues:
    raise RuntimeError("Schematic generator validation: " + "; ".join(issue.message for issue in issues))

schematic.save(str(PROJECT.with_suffix(".kicad_sch")))

# KiCad 10.0.7 seeds its documented default project template with this native
# project metadata (kicad/project_template.cpp, EnsureDefaultProjectTemplate).
# Keep it version-specific and verify the result through the native CLI workflow.
project_file = PROJECT.with_suffix(".kicad_pro")
if project_file.exists():
    raise FileExistsError(f"Refusing to replace existing native project file: {project_file}")
project_file.write_text('{\n "meta": {\n  "version": 1\n }\n}\n', encoding="utf-8")
print(f"Created native project files under {PROJECT_DIR}")
