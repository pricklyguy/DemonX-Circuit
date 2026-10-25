# Schematic editor model and KiCad boundary

## Current editor boundary

The Electron renderer edits an explicit DemonX JSON sidecar at `schematic-circuit/revisions/NNNNNN-*.json`. The format is `demonx-schematic`, version 1, on a 1.27 mm grid. A revision is created with exclusive file creation; previous revisions remain available. `project.json` names the sidecar; main-process IPC checks the opened project root and validates model size, IDs, library allowlist and graph endpoints before saving. The preload surface is limited to load/save model operations.

Component and wire identity is stable across moves: pins are `pin:<component-id>:<number>`, and wires store both endpoint IDs. Junctions have IDs, labels attach to a node ID, and net derivation uses union-find over explicit wires. Visual crossings are not connections. A pin moved by 90-degree rotation is computed from its stored local coordinates. Adding a library part gives it an explicit reference and known pin definitions; it does not silently embed or modify KiCad libraries.

The current canvas supports only `Connector_Generic:Conn_01x02`, `Device:R`, and `Device:LED`, with simple preview glyphs. It is not a complete symbol renderer and does not ingest KiCad library symbols. Its editor report and netlist are model-level information, not native KiCad verification.

## Native adapter experiment

`prototype/native-editor-roundtrip.py` is a fixture-specific, non-overwriting parser test. It accepts only exactly J1 / `Connector_Generic:Conn_01x02`, R1 / `Device:R`, and D1 / `Device:LED`; it changes one value and writes a separate `.kicad_sch` output. `prototype/compare-native-netlists.py` compares the native CLI pin-to-net assignments. This tested path is intentionally not exposed in the desktop UI.

Evidence files are in `reports/checkpoint-5/native-roundtrip/`. Exact command, engine version and output are recorded in `reports/checkpoint-5/CHECKPOINT-5-RESULTS.md`.

## Fidelity policy

There is no general KiCad 10.0.7 schematic IPC editing endpoint. Until an adapter provides complete lossless parse/serialize support for the accepted native object set, the UI must not import a native schematic and later export a partial replacement. Future adapter policy:

1. Parse into a versioned lossless syntax/object representation retaining unknown fields and original native document content.
2. Keep native object UUIDs, instance paths, references, pin identifiers, library definitions, labels, no-connects, buses, graphics and sheet hierarchy.
3. Refuse edits to unsupported object types and preserve the original file.
4. Write only to a new candidate file. Open it with the KiCad GUI and CLI; compare native netlists before approval.
5. Require an explicit diff/approval before any replacement, with backup and rollback.

Hierarchical sheets, buses, specialized symbols, embedded library definitions, graphics, simulator data and unsupported metadata are currently outside the sidecar format. They must be treated as unsupported rather than dropped.
