#!/usr/bin/env python3
"""Create an editable KiCad 10 ESP32-S3/BME280/relay reference schematic.

This is a feasibility fixture. Native KiCad CLI ERC is authoritative; it is
not a substitute for circuit simulation, layout review, or hardware testing.
"""

import json
from pathlib import Path

import kicad_sch_api as ksa


ROOT = Path(__file__).resolve().parents[2]
PROJECT_DIR = ROOT / "examples" / "esp32-sensor" / "native"
PROJECT_DIR.mkdir(parents=True, exist_ok=True)
PROJECT = PROJECT_DIR / "DX_ESP32_Sensor"
FOOTPRINT_TABLE = PROJECT_DIR / "fp-lib-table"
GRID_MM = 1.27


def grid_position(position):
    """Snap schematic placements to KiCad's 50 mil grid."""
    return tuple(round(value / GRID_MM) * GRID_MM for value in position)


def wire_label(schematic, reference, pin_number, name):
    pin_position = schematic.get_component_pin_position(reference, pin_number)
    if pin_position is None:
        raise RuntimeError(f"KiCad symbol pin lookup failed for {reference}.{pin_number} ({name})")
    component = schematic.components.get(reference)
    center = component.position
    dx = pin_position.x - center.x
    dy = pin_position.y - center.y
    # Route each label stub away from the symbol body. A fixed +X stub caused
    # real KiCad netlist shorts where it crossed opposite-side pins.
    if abs(dx) >= abs(dy):
        label_position = (pin_position.x + (2.54 if dx >= 0 else -2.54), pin_position.y)
    else:
        label_position = (pin_position.x, pin_position.y + (2.54 if dy >= 0 else -2.54))
    schematic.add_wire_to_pin(label_position, reference, pin_number)
    schematic.add_label(name, position=label_position)

for suffix in (".kicad_pro", ".kicad_sch", ".kicad_pcb"):
    target = PROJECT.with_suffix(suffix)
    if target.exists():
        raise FileExistsError(f"Refusing to replace existing native project file: {target}")
if FOOTPRINT_TABLE.exists():
    raise FileExistsError(f"Refusing to replace existing project footprint table: {FOOTPRINT_TABLE}")

# Connection groups are defined by verified datasheet pin numbers. Labels keep
# the generated sheet readable while leaving native wire editing to KiCad.
components = [
    ("RF_Module:ESP32-S3-WROOM-1", "U1", "ESP32-S3-WROOM-1-N8", (72, 88), "RF_Module:ESP32-S3-WROOM-1"),
    ("Sensor:BME280", "U2", "BME280 0x76", (135, 62), "Package_LGA:Bosch_LGA-8_2.5x2.5mm_P0.65mm_ClockwisePinNumbering"),
    ("Regulator_Switching:TPS563201", "U3", "TPS563201 3V3", (52, 55), "Package_TO_SOT_SMD:SOT-23-6"),
    ("Device:L_Small", "L1", "Coilcraft XGL4020-222MEC 2.2uH", (72, 55), "DemonX_Project:Coilcraft_XGL4020_222MEC"),
    ("Device:C", "C1", "10uF input", (32, 45), "Capacitor_SMD:C_0805_2012Metric"),
    ("Device:C", "C2", "100nF bootstrap", (62, 44), "Capacitor_SMD:C_0603_1608Metric"),
    ("Device:C", "C3", "22uF output", (91, 45), "Capacitor_SMD:C_0805_2012Metric"),
    ("Device:C", "C4", "22uF output", (101, 45), "Capacitor_SMD:C_0805_2012Metric"),
    ("Device:C", "C5", "100nF BME280", (144, 45), "Capacitor_SMD:C_0603_1608Metric"),
    ("Device:C", "C6", "1uF EN delay", (61, 119), "Capacitor_SMD:C_0603_1608Metric"),
    ("Device:R", "R1", "33.2k VFB high", (78, 68), "Resistor_SMD:R_0603_1608Metric"),
    ("Device:R", "R2", "10k VFB low", (91, 68), "Resistor_SMD:R_0603_1608Metric"),
    ("Device:R", "R3", "4.7k SDA pullup", (127, 79), "Resistor_SMD:R_0603_1608Metric"),
    ("Device:R", "R4", "4.7k SCL pullup", (140, 79), "Resistor_SMD:R_0603_1608Metric"),
    ("Device:R", "R5", "330R base", (113, 101), "Resistor_SMD:R_0603_1608Metric"),
    ("Device:R", "R6", "100k base pulldown", (124, 101), "Resistor_SMD:R_0603_1608Metric"),
    ("Device:R", "R7", "10k EN pullup", (74, 119), "Resistor_SMD:R_0603_1608Metric"),
    ("Device:R", "R8", "0R BME280 address strap (0x76)", (159, 119), "Resistor_SMD:R_0603_1608Metric"),
    ("Transistor_BJT:Q_NPN_BEC", "Q1", "MMBT2222ALT1G", (140, 101), "Package_TO_SOT_SMD:SOT-23"),
    ("Device:D", "D1", "MMSD4148T1G", (156, 101), "Diode_SMD:D_SOD-123"),
    ("Relay:G5V-1", "K1", "G5V-1-DC5 (low-voltage DC only)", (177, 94), "Relay_THT:Relay_SPDT_Omron_G5V-1"),
    ("Connector_Generic:Conn_01x02", "J1", "5V DC INPUT", (28, 85), "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical"),
    ("Connector_Generic:Conn_01x03", "J2", "RELAY CONTACTS - LOW-VOLTAGE DC", (209, 92), "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical"),
]

# Pin numbers verified against the Espressif, Bosch, TI, onsemi, and Omron
# source drawings listed in docs/research/ESP32-REFERENCE-FIXTURE-COMPONENTS.md.
# Omron G5V-1 bottom view: coil 2/9, common 5/6, NC 1, NO 10. External
# contacts are explicitly low-voltage DC only; no mains circuit is in scope.
net_pins = {
    "+5V_IN": [("J1", "1"), ("U3", "3"), ("U3", "5"), ("C1", "1"), ("K1", "2"), ("D1", "1")],
    "+3V3": [("L1", "2"), ("C3", "1"), ("C4", "1"), ("C5", "1"), ("U1", "2"), ("U2", "2"), ("U2", "6"), ("U2", "8"), ("R1", "1"), ("R3", "1"), ("R4", "1"), ("R7", "1")],
    "GND": [("J1", "2"), ("U3", "1"), ("C1", "2"), ("C3", "2"), ("C4", "2"), ("C5", "2"), ("C6", "2"), ("U1", "1"), ("U1", "40"), ("U1", "41"), ("U2", "1"), ("U2", "7"), ("R2", "2"), ("R6", "2"), ("R8", "2"), ("Q1", "2")],
    "BME280_ADDR_76": [("U2", "5"), ("R8", "1")],
    "SW": [("U3", "2"), ("L1", "1"), ("C2", "1")],
    "VBST": [("U3", "6"), ("C2", "2")],
    "VFB": [("U3", "4"), ("R1", "2"), ("R2", "1")],
    "I2C_SDA": [("U1", "12"), ("U2", "3"), ("R3", "2")],
    "I2C_SCL": [("U1", "17"), ("U2", "4"), ("R4", "2")],
    "RELAY_GPIO": [("U1", "18"), ("R5", "1")],
    "RELAY_BASE": [("R5", "2"), ("Q1", "1"), ("R6", "1")],
    "RELAY_COIL_LOW": [("K1", "9"), ("Q1", "3"), ("D1", "2")],
    "RELAY_COM": [("K1", "5"), ("K1", "6"), ("J2", "1")],
    "RELAY_NO": [("K1", "10"), ("J2", "2")],
    "RELAY_NC": [("K1", "1"), ("J2", "3")],
    "EN": [("U1", "3"), ("R7", "2"), ("C6", "1")],
}

schematic = ksa.create_schematic("DX_ESP32_Sensor")
for lib_id, reference, value, position, footprint in components:
    schematic.components.add(
        lib_id=lib_id,
        reference=reference,
        value=value,
        position=grid_position(position),
        footprint=footprint,
    )

connected = {pin for pins in net_pins.values() for pin in pins}
for net_name, pins in net_pins.items():
    for reference, pin_number in pins:
        wire_label(schematic, reference, pin_number, net_name)

# This prototype sheet uses net labels at each pin. The BME280's SDO address
# pin is grounded through an explicit 0-ohm jumper: electrically direct at DC,
# while retaining distinct ERC nets for this library's bidirectional pin type.
for reference, position, net_name in (
    ("PF1", (15, 128), "+5V_IN"),
    ("PF2", (25, 135), "GND"),
    ("PF3", (210, 20), "+3V3"),
):
    flag = schematic.components.add(
        lib_id="power:PWR_FLAG",
        reference=reference,
        value="PWR_FLAG",
        position=grid_position(position),
    )
    wire_label(schematic, reference, "1", net_name)

# Explicit no-connect markers make unused ESP32 module pins intentional. A
# missing coordinate or a symbol pin lookup failure stops project generation.
all_pins = {
    "U1": [str(number) for number in range(1, 42)],
    "U2": [str(number) for number in range(1, 9)],
    "U3": [str(number) for number in range(1, 7)],
    "K1": ["1", "2", "5", "6", "9", "10"],
    "Q1": ["1", "2", "3"],
    "D1": ["1", "2"],
}
for reference, pin_numbers in all_pins.items():
    for pin_number in pin_numbers:
        if (reference, pin_number) in connected:
            continue
        position = schematic.get_component_pin_position(reference, pin_number)
        if position is None:
            raise RuntimeError(f"KiCad no-connect pin lookup failed for {reference}.{pin_number}")
        schematic.no_connects.add(position=(position.x, position.y))

issues = schematic.validate()
if issues:
    raise RuntimeError("Schematic generator validation: " + "; ".join(issue.message for issue in issues))

schematic.save(str(PROJECT.with_suffix(".kicad_sch")))
project_settings = {
    "board": {
        "design_settings": {
            "rules": {
                # Feasibility profile for two-layer, 1 oz prototype boards.
                # Public capability reference permits 0.10 mm traces and
                # 0.15 mm drilled holes; use 0.15 mm floors here.
                "min_track_width": 0.15,
                "min_through_hole_diameter": 0.15,
            }
        }
    },
    "meta": {"filename": "DX_ESP32_Sensor.kicad_pro", "version": 1},
}
PROJECT.with_suffix(".kicad_pro").write_text(
    json.dumps(project_settings, indent=2) + "\n",
    encoding="utf-8",
)
print("Created KiCad project DRC minima: track=0.15 mm; through-hole=0.15 mm; no rules disabled.")
FOOTPRINT_TABLE.write_text(
    '(fp_lib_table\n'
    '  (version 7)\n'
    '  (lib (name "DemonX_Project") (type "KiCad") '
    '(uri "${KIPRJMOD}/../libraries/DemonX_Project.pretty") '
    '(options "") (descr "DemonX project-owned component footprints"))\n'
    ')\n',
    encoding="utf-8",
)

pin_map = {
    "project": "DX_ESP32_Sensor",
    "engine": "KiCad 10.0.7",
    "source": "native-schematic-labels",
    "connections": {name: [f"{reference}.{pin}" for reference, pin in pins] for name, pins in net_pins.items()},
    "status": "candidate reference fixture; KiCad CLI ERC/DRC and manual net review required",
    "relayContacts": "bottom-view mapping: 2/9 coil, 5/6 common, 1 NC, 10 NO; external header is low-voltage DC only",
}
(PROJECT_DIR / "pin-map.json").write_text(json.dumps(pin_map, indent=2) + "\n", encoding="utf-8")
print(f"Created KiCad schematic: {PROJECT.with_suffix('.kicad_sch')}")
print(f"Placed {len(components)} components; labeled {sum(map(len, net_pins.values()))} pin connections.")
print("Omron G5V-1 coil and low-voltage DC contact terminals are included in the candidate net map.")
