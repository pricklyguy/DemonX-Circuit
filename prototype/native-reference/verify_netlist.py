#!/usr/bin/env python3
"""Assert selected named connections exist in KiCad's exported XML netlist."""

import sys
import xml.etree.ElementTree as ET
from pathlib import Path


EXPECTED = {
    "+5V_IN": {"J1.1", "U3.3", "U3.5", "C1.1", "K1.2", "D1.1"},
    "+3V3": {"L1.2", "C3.1", "C4.1", "C5.1", "U1.2", "U2.2", "U2.6", "U2.8", "R1.1", "R3.1", "R4.1", "R7.1"},
    "GND": {"J1.2", "U3.1", "C1.2", "C3.2", "C4.2", "C5.2", "C6.2", "U1.1", "U1.40", "U1.41", "U2.1", "U2.5", "U2.7", "R2.2", "R6.2", "Q1.2"},
    "SW": {"U3.2", "L1.1", "C2.1"},
    "VBST": {"U3.6", "C2.2"},
    "VFB": {"U3.4", "R1.2", "R2.1"},
    "I2C_SDA": {"U1.12", "U2.3", "R3.2"},
    "I2C_SCL": {"U1.17", "U2.4", "R4.2"},
    "RELAY_GPIO": {"U1.18", "R5.1"},
    "RELAY_BASE": {"R5.2", "Q1.1", "R6.1"},
    "RELAY_COIL_LOW": {"K1.9", "Q1.3", "D1.2"},
    "EN": {"U1.3", "R7.2", "C6.1"},
}


def main():
    path = Path(sys.argv[1])
    root = ET.parse(path).getroot()
    nets = {}
    for net in root.findall("./nets/net"):
        name = net.attrib.get("name", "")
        nodes = {f"{node.attrib['ref']}.{node.attrib['pin']}" for node in net.findall("node")}
        nets[name] = nodes

    failures = []
    for name, expected in EXPECTED.items():
        actual = nets.get(name, set())
        missing = expected - actual
        if missing:
            failures.append(f"{name}: missing {', '.join(sorted(missing))}; actual {', '.join(sorted(actual)) or '(no net)'}")
        else:
            print(f"NET PASS {name}: {', '.join(sorted(actual))}")
    if failures:
        raise SystemExit("KiCad exported netlist does not match the candidate connection map:\n" + "\n".join(failures))
    print(f"PASS: verified {len(EXPECTED)} named nets from KiCad's native XML netlist")


if __name__ == "__main__":
    main()
