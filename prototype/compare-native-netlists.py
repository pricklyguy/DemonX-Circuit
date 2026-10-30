#!/usr/bin/env python3
"""Compare electrical pin-to-net assignments from KiCad native XML exports."""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def net_map(path):
    root = ET.parse(path).getroot()
    components = {node.get('ref'): node.findtext('value', '') for node in root.findall('./components/comp')}
    result = {}
    for net in root.findall('./nets/net'):
        pins = tuple(sorted((node.get('ref'), node.get('pin')) for node in net.findall('node')))
        for ref, pin in pins:
            result[(ref, pin)] = pins
    return components, result


if len(sys.argv) != 3:
    raise SystemExit('Usage: compare-native-netlists.py EXPECTED.net ACTUAL.net')
expected_components, expected_nets = net_map(Path(sys.argv[1]))
actual_components, actual_nets = net_map(Path(sys.argv[2]))
if expected_nets != actual_nets:
    changed = sorted(pin for pin in set(expected_nets) | set(actual_nets) if expected_nets.get(pin) != actual_nets.get(pin))
    raise SystemExit('FAIL: native connectivity changed: ' + ', '.join(f'{ref}.{pin}' for ref, pin in changed))
if set(expected_components) != set(actual_components):
    raise SystemExit('FAIL: component references changed between native netlists.')
if expected_components.get('R1') == actual_components.get('R1'):
    raise SystemExit('FAIL: expected the staged native edit to change the R1 value.')
print(f'PASS: KiCad native netlists contain identical pin-to-net assignments for {len(expected_nets)} pins; staged component edit changed R1 {expected_components["R1"]!r} -> {actual_components["R1"]!r}.')
