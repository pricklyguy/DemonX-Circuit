# Schematic editor foundation comparison

**Checkpoint:** 5A / research snapshot, 2026-10-25
**Decision:** prototype a constrained DemonX semantic editor using Konva for rendering and input, while retaining KiCad 10.0.7 as the verification/manufacturing authority. This is a feasibility choice, not a claim that arbitrary native schematic round-trip is solved.

## Candidate comparison

| Candidate | License and maintenance | Editing fit | KiCad interoperability | Decision |
|---|---|---|---|---|
| [tscircuit](https://github.com/tscircuit/tscircuit) + [schematic viewer](https://github.com/tscircuit/schematic-viewer) | MIT; active TypeScript ecosystem | Declarative circuit model, parts, wires, viewer and rendering; useful reference for reusable electronic semantics and generated layouts | Own circuit model and output pipeline; not a KiCad schematic editor/import-export layer | Keep as a model/rendering research candidate. Do not substitute its circuit language for native project editing until mapping/fidelity is demonstrated. |
| [tscircuit layout editor](https://github.com/tscircuit/schematic-layout-editor) | MIT; active reference implementation | Interactive layout work for tscircuit's match-adapt layout algorithm; reference for two-pin placement/rotation and junction UX | Editor output is tscircuit JSON, not KiCad `.kicad_sch` | Study interactions; insufficient as the product canvas foundation. |
| [Konva](https://github.com/konvajs/konva) | MIT; active releases, version 10.9.0 selected | TypeScript scene graph, hit testing, drag, transforms, events and canvas layers. Application must implement schematic objects, semantic snapping, routes, undo and serialization. | No EDA model or native KiCad parser | Selected for the first constrained interaction spike because the desired object model and safety limits stay in DemonX code. |
| [maxGraph](https://github.com/maxGraph/maxGraph) | Apache-2.0; release 0.25.0 observed 2026-10-06 | Mature typed graph editor with cells, ports, edges, selection, commands, zoom and undo/redo | General diagram graph does not model EDA pin electrical types or KiCad native files | Viable alternative if future editor complexity outgrows the smaller Konva layer. It still requires an electrical model and KiCad adapter. |
| [kicad-sch-api](https://github.com/circuit-synth/kicad-sch-api) | MIT; community-maintained, not KiCad-official; local tested package 0.5.6 | Programmatic schematic load/edit/save with format-preservation option | Demonstrated only against a generated J1/R1/D1 fixture; library package/dependency surface is broader than desirable for desktop runtime | Used only in an isolated Python feasibility script. Gate on exact supported construct validation; do not embed as a general adapter. |
| KiCad 10 CLI / IPC | KiCad official, GPL-3.0-or-later; pinned engine 10.0.7 | CLI supports ERC and schematic/netlist export; IPC API covers PCB editor in KiCad 10, with schematic editing not available through that API | Native source of truth and verification engine. No documented KiCad 10 schematic IPC mutation API | Keep native files intact and use official CLI/editor. Controlled export adapter remains limited to fixture-only values. |

Upstream: [Konva releases](https://github.com/konvajs/konva/releases), [maxGraph releases](https://github.com/maxGraph/maxGraph/releases), [KiCad API documentation](https://dev-docs.kicad.org/en/apis-and-binding/ipc-api/for-kicad-developers/), and [KiCad 10 CLI documentation](https://docs.kicad.org/10.0/en/cli/cli.pdf).

## Why the interaction spike uses Konva

The product needs electrical semantics that must be explicit and testable, not inferred from canvas line intersections. A small custom semantic model plus a mature scene graph allows stable IDs for components, pins, wires and junctions, with deterministic graph-based net derivation. This avoids tying future AI edits to pixel positions and avoids presenting an arbitrary general graph as an electrical model. Konva is not an EDA editor: the current spike has a tiny allowlisted component set and a 50 mil grid, and it refuses unsupported component pin definitions.

The model stores wires as explicit node endpoint IDs. Clicking empty canvas while wiring creates a new junction and continues the active wire; subsequent wires must name that junction to join the same net. Crossings alone do not merge nets. Component movement retains pin IDs; rotated pin positions are derived from local pin coordinates and a quarter-turn rotation. Undo/redo is editor-local and serializes model snapshots.

## Native KiCad adapter feasibility and limits

An official schematic IPC edit API is not available in KiCad 10.0.7. The constrained Python spike uses the community `kicad-sch-api` package. On the simple LED/resistor fixture it changed R1 from 330 to 470 in a new output file, preserved three components and three wires, passed actual KiCad 10.0.7 ERC with zero errors and warnings, and preserved all six pin-to-net associations in native CLI XML netlists. The original fixture was not overwritten.

Checkpoint 5 extends that fixture-only path into the desktop application. The adapter parses and retains the native KiCad S-expression tree, imports the three embedded-library symbols and their component/pin UUIDs, labels and direct two-point wires, then patches values, grid placements, rotations and electrical endpoints in a separate staged file. Unknown root-level constructs, unsupported symbols and pin definitions, multi-point wires, ambiguous endpoints, non-grid placements, label create/delete, and junction edits fail closed. Native source and sidecar revisions remain separate until a candidate passes KiCad netlist comparisons and ERC and the user approves commit. Commit retains a non-overwriting source backup; rollback verifies both hashes before restoring.

This remains a constrained adapter, not arbitrary `.kicad_sch` editing. The desktop-preview workflow runs the packaged Windows tests with KiCad 10.0.7 and must prove the real native candidate path before this feature is considered accepted. Native reports include source revision hashes; Check Circuit refuses to label native ERC as verification while the DemonX model is unsynchronized. MCP inspection remains read-only and reports native revision/synchronization state. Full fidelity for multi-sheet projects, buses, global/hierarchical labels, power symbols, no-connect markers, graphics, simulation metadata, symbol libraries outside the allowlist, and unknown future KiCad syntax is intentionally unsupported and must not be silently dropped.

## Prototype support matrix

| Capability | Status | Evidence / boundary |
|---|---|---|
| Grid, zoom, pan, select and drag | Implemented in spike; packaged acceptance pending | Konva stage and mouse input. No owner usability study yet. |
| Component search and add | Implemented | Three fixed library entries: connector, resistor and LED. |
| Rotation, delete and undo/redo | Implemented in UI; model tests cover rotation/connectivity | Deleting a component removes incident wires and labels. |
| Pin snapping and wires | Implemented with semantic pin IDs | Wires attach to actual pins; empty-canvas click inserts explicit junction. |
| Save/reopen | Implemented for DemonX sidecar | Append-only JSON revision under project folder; KiCad files remain unchanged. |
| Native KiCad read/write | Limited experiment only | Fixture-only R1 value edit through community parser; not wired to desktop UI. |
| Native netlist compare and ERC | PASS for one fixture | KiCad CLI 10.0.7, six pin-to-net assignments preserved, ERC 0 errors / 0 warnings. |
| Hierarchical/bus/graphics/special native objects | NOT SUPPORTED by DemonX model | Native projects with these constructs must remain native; no auto-import. |
| MCP inspection | SDK stdio smoke passes | Read-only tools access the explicitly authorized project folder. |
| Codex/Claude client compatibility | NOT TESTED | Protocol negotiated with the official SDK client only. |

## Go/no-go

Go for an owner-testable DemonX sidecar editor preview. No-go for claiming success at the checkpoint definition (“edit, save, reopen and verify in KiCad”) until native export/import and GUI reopen are implemented and tested end to end. If the user requires native editing as an acceptance gate, the current UI remains a bounded prototype and checkpoint acceptance is incomplete.
