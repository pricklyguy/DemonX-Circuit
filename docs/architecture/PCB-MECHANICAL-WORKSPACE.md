# Preliminary native PCB mechanical workspace

Checkpoint 6B-1 adds a deliberately small placement workspace to the existing
desktop app. The schematic editor and native schematic approval flow are retained.
The owner project is private local data and is not a repository example.

Open a DemonX project folder, then choose **Mechanical PCB Workspace**. The native
`.kicad_pcb` supplies the outline, pads, footprint position, angle, and copper side.
The viewer supports a closed axis-aligned rectangle made from four `Edge.Cuts`
lines. Other board shapes are refused with a message directing the owner to KiCad.
It computes dimensions in millimetres; it does not redraw or approve a board outline.

Green footprints are front and blue footprints are back, both in a fixed front
projection. The back layer filter is not a mirrored rear view. Courtyards are
conservative axis-aligned boxes after native footprint rotation. Through-hole
footprints are compared across copper sides. Circular mounting courtyards are
included. Missing courtyards are reported as unknown, not passing. Curved or
complex courtyard outlines are not fully interpreted.

Optional `mechanical/constraints.json` supplies labelled rectangular/circular
references, keepout rectangles, provenance text, and missing measurements.
These are visual references, not copper keepouts, authoritative board geometry,
an STL importer, or 3D collision checking. Owner meshes may be retained alongside
the project, but this implementation does not load triangles into the workspace.

Changing X, Y, or angle changes an in-memory placement draft. Save writes a new
native board under `pcb-revisions/000001-<hash>.kicad_pcb`; it never replaces the
imported board. A matching JSON record retains parent/content hashes, time, and
source path. Reopen selects the latest numbered PCB revision. Unknown native
syntax is retained byte-for-byte; footprint placement, absolute pad orientation,
and local text orientation are the only expressions changed. Boards containing
tracks, vias, copper arcs, or zones are refused for placement writes. No routing
or layer flipping is implemented. A stale source hash refuses save.

The revision board is the active authoritative native file for Circuit native
open/check actions. The original `.kicad_pro` and original board remain portable.
External KiCad project-manager opening of the original project still opens the
original board; open the desired revision board explicitly when working outside
Circuit. Revision metadata is not a replacement for the native board.

Unsaved PCB drafts block development reload, project switch, and workspace close.
For projects whose manifest contains
`manufacturing.status: "blocked-mechanical-review"`, the manufacturing button is
disabled and the main-process manufacturing handler returns before checking tools
or creating export folders. This gate does not prevent an owner from exporting
manually in KiCad; it is not manufacturing authorization.

Validation:

```text
npm run test:pcb-mechanical
npm run test:schematic-model
npm run test:native-roundtrip
npm run test:mcp
npm run test:owner-schematic-cli-args
node prototype/pcb-workspace-acceptance.mjs <private-project> <new-evidence-folder>
```

The Electron acceptance script uses an isolated profile and copies the supplied
fixture. It opens through renderer/IPC, tests fabrication refusal, edits/saves and
reopens a revision, tests the back layer filter, and captures the actual renderer.
Its debugging endpoint exists only in that test process. Do not pass an owner
project as an evidence folder or commit its generated evidence.
