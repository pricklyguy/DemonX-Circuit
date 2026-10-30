#!/usr/bin/env python3
"""Controlled, non-overwriting KiCad schematic value-edit feasibility test."""
import argparse
import os
from pathlib import Path
import sys

# KiCad's Windows-bundled Python may ignore PYTHONPATH. Keep dependency
# provisioning project-local and explicit rather than installing globally.
dependency_dir = os.environ.get('DEMONX_KICAD_SCH_API_PATH')
if dependency_dir:
    sys.path.insert(0, str(Path(dependency_dir).resolve(strict=True)))

import kicad_sch_api as ksa


parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('destination', type=Path)
parser.add_argument('--reference', default='R1')
parser.add_argument('--value', default='470')
args = parser.parse_args()
source = args.source.resolve(strict=True)
destination = args.destination.resolve()
if destination.exists():
    raise FileExistsError(f'Refusing to replace existing schematic: {destination}')
schematic = ksa.Schematic.load(str(source))
components = {component.reference: component for component in schematic.components}
expected = {'J1': 'Connector_Generic:Conn_01x02', 'R1': 'Device:R', 'D1': 'Device:LED'}
actual = {ref: component.lib_id for ref, component in components.items()}
if actual != expected:
    raise RuntimeError(f'Refusing this fixture-only edit for an unsupported schematic. Components found: {actual}')
component = components.get(args.reference)
if component is None:
    raise RuntimeError(f'Component {args.reference} is not present.')
old_value = component.value
component.value = args.value
schematic.save(str(destination), preserve_format=True)
print(f'PASS: wrote a new KiCad schematic copy; changed {args.reference} value {old_value!r} -> {args.value!r}; retained {len(schematic.components)} components and {len(schematic._wires)} wires.')
