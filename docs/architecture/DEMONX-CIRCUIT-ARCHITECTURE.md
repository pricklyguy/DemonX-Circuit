# Build Circuit around portable native projects

DemonX Circuit should own the approachable workflow, component ownership, AI review and shared project manifest while delegating validated EDA operations to isolated engine adapters. The first adapter targets KiCad 10.0.x through `kicad-cli`; native KiCad files remain directly editable and the application opens the native editor for canvas work. This keeps a replaceable engine boundary and avoids making the initial release wait for a new schematic/PCB canvas.

## Product boundary

The UI guides a user through New Project, Add Component, Connect Components, Check Circuit, Design PCB, Ask AI, Prepare Manufacturing Files, Create Enclosure and Generate Firmware. The native EDA editor remains available for full-fidelity schematic and layout work. Circuit provides onboarding, diagnostics, provenance and controlled handoffs rather than hiding the engine's mature editor.

The architecture separates five concerns:

1. **Project package:** a portable manifest references native files, libraries, outputs, enclosure assets and firmware, with stable project/revision IDs and compatibility metadata.
2. **Owned component library:** user-authored parts, imported source copies, provenance and license records; project dependency snapshots preserve used parts even if the library changes.
3. **Engine adapter:** detects an explicitly configured engine/version, launches commands with argv (never shell-concatenated user input), captures reports and maps native files to normalized read models.
4. **Workflow service:** stages edits and exports, validates before promotion, records diffs/hashes, requires approval for writes and retains rollback snapshots.
5. **AI/MCP boundary:** read-only inspection is independent from write scopes; suggestions cite sources and certainty, and are never labeled verified electrical facts.

## Shared project manifest

Use JSON Schema versioning for a thin manifest; do not copy engine internals into a purported universal format. Example shape:

```json
{
  "format": "demonx-project",
  "formatVersion": "0.1.0",
  "projectId": "stable-uuid",
  "revision": "0.1.0",
  "native": { "engine": "kicad", "engineVersion": "10.0.7", "files": ["design/board.kicad_pro", "design/board.kicad_sch", "design/board.kicad_pcb"] },
  "libraries": [{ "id": "local:part-id", "source": "libraries/local/part-id", "license": "user-supplied", "sha256": "..." }],
  "manufacturing": { "outputs": [], "units": "mm", "origin": "auxiliary", "boardSide": "top" },
  "mechanical": { "step": null, "enclosure": null },
  "firmware": { "target": "esphome", "files": [], "boardProfile": null }
}
```

Keep native files accessible in a zip or ordinary project directory; references must be relative, paths traversal-safe, and dependencies copyable/exportable. The manifest identifies revisions and tool versions but does not replace ERC/DRC or encode a universal schematic. Preserve unknown fields for forward compatibility; readers reject unsupported major schema versions with a clear migration path.

## Validation and mutation model

Read native data through the engine CLI where supported, with normalized project/component/pin/net/geometry views. For mutation, write into a staging copy, show a human-readable diff, run the relevant validation, then promote atomically after approval and retain a rollback snapshot. Never edit the live project before validation. The current project fixture is not a native EDA design; this lifecycle is proposed and not yet demonstrated.

KiCad's official CLI provides the first supported automation surface for ERC, DRC, Gerber, drill and STEP. Keep version-specific behavior behind adapter capability discovery. Treat Pcbnew Python use as optional and build-bound; do not expose it as a stable public API. Separate engine installation from product packaging until GPL and bundled dependency obligations are reviewed. ([CLI 10.0](https://docs.kicad.org/10.0/en/cli/cli.html), [license notes](https://github.com/KiCad/kicad-source-mirror/blob/master/LICENSE.README))

## Initial checkpoint and evidence

**Working evidence:** `node prototype/smoke.mjs` passes against the declared MCP 2025-11-25 request subset for initialization, tool discovery/schema annotations, project inspection, custom component JSON export, ESPHome YAML response, resource read, and invalid argument errors. Node syntax checks pass. The standalone generator creates YAML from the explicit logical ESP32-S3-WROOM-1-N8 fixture mapping (GPIO8 SDA, GPIO9 SCL, GPIO10 relay driver) and refuses overwrite without backup, comparison and typed approval. The mapping is a firmware example only: the manifest is not a native EDA schematic or routed PCB. These tests establish only metadata/protocol and file-generation behavior, not circuit behavior. KiCad CLI and ESPHome are not installed in this environment; no ERC, DRC, fabrication export, STEP export, YAML parse or ESPHome CLI/schema validation ran.

**Failing or absent:** there is no native `.kicad_*` project, no EDA library load/edit/export round trip, no real CLI check, no manufacturing output, no Forge geometry handoff, and no ESPHome CLI/schema validation. The source-only JSON component is returned as export content but is not proven importable by an EDA engine. MCP is hand-written JSON-RPC for a tested 2025-11-25 subset and has no named-client conformance evidence; it does not implement the current 2026-07-28 revision. This stub is a feasibility probe and must be replaced with a pinned official SDK before product integration.

Major risks are EDA format/version drift, per-asset library license, safe writes and rollback, converter coordinate accuracy, component STEP model alignment, generic ESP32 pin assumptions, user secrets, MCP client differences, and false confidence from syntactic validation. No manufacturing or flash action should be inferred from the fixture.

## Conclusion

The next architecture proof is a native KiCad fixture plus adapter smoke workflow, not a custom canvas. It must prove component-library reuse, CLI validation and export on real files before engine investment expands. LibrePCB remains the comparison engine if its output and library model can satisfy the same fixture contract.
