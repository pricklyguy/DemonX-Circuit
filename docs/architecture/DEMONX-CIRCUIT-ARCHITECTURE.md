# Build Circuit around portable native projects

DemonX Circuit should own the approachable workflow, component ownership, AI review and shared project manifest while delegating validated EDA operations to isolated engine adapters. The first adapter targets KiCad 10.0.x through `kicad-cli`; native KiCad files remain directly editable and the application opens the native editor for canvas work. This keeps a replaceable engine boundary and avoids making the initial release wait for a new schematic/PCB canvas.

## Product boundary

The UI guides a user through New Project, Add Component, Connect Components, Check Circuit, Design PCB, Ask AI, Prepare Manufacturing Files, Create Enclosure and Generate Firmware. The native EDA editor remains available for full-fidelity schematic and layout work. Circuit provides onboarding, diagnostics, provenance and controlled handoffs rather than hiding the engine's mature editor.

## First desktop application recommendation

Start with an **Electron 45 project/workflow shell**, TypeScript UI, and local main-process adapters that launch a separately installed KiCad 10.0.7 and ESPHome CLI with fixed argument arrays. Electron aligns with the existing Node prototype and has a current stable Windows/Linux-capable distribution; it avoids committing Circuit to bundling KiCad. Keep the editor canvases native in the first usable app: the initial screen should create/open projects, show component-library dependencies, open the project in KiCad, run checks, show reports, generate an ESPHome preview/diff, and prepare manufacturing/Forge handoff folders. Add AI only as a review panel with source-backed suggestions and explicit approval gates.

Use `contextIsolation: true`, `nodeIntegration: false`, renderer sandboxing, a restrictive content security policy, allowlisted IPC, and main-process command adapters that validate project paths and never pass user strings through a shell. Electron's security documentation specifically recommends context isolation and sandboxing and warns that privileged operations must be mediated via IPC. Electron 45 is the current stable release observed on 2026-10-24; do not pin it for product release until a Windows/Linux shell spike and dependency/license review are complete. A lightweight Tauri shell remains an alternative if measured Electron footprint becomes unacceptable, but it brings a Rust runtime/toolchain without an existing project advantage.

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

Read native data through the engine CLI where supported, with normalized project/component/pin/net/geometry views. For mutation, write into a staging copy, show a human-readable diff, run the relevant validation, then promote atomically after approval and retain a rollback snapshot. Never edit the live project before validation. The fixture now demonstrates native schematic/netlist generation, routing, KiCad ERC/DRC, reopening, exports and a separate user-library round-trip in CI. The desktop shell still does not implement staged AI edits or a general mutation workflow.

KiCad's official CLI provides the first supported automation surface for ERC, DRC, Gerber, drill and STEP. Keep version-specific behavior behind adapter capability discovery. Treat Pcbnew Python use as optional and build-bound; do not expose it as a stable public API. Separate engine installation from product packaging until GPL and bundled dependency obligations are reviewed. ([CLI 10.0](https://docs.kicad.org/10.0/en/cli/cli.html), [license notes](https://github.com/KiCad/kicad-source-mirror/blob/master/LICENSE.README))

## Initial checkpoint and evidence

**Checkpoint 2 evidence (2026-10-24):** The isolated official KiCad 10.0.7 image ran the tiny LED/resistor native project. The native CLI reported `** ERC messages: 0 Errors 0 Warnings **`, `** Found 0 DRC violations **`, `** Found 0 unconnected pads **`, then saved/reopened the schematic and board and repeated both checks with exit codes `0/0`. It emitted Gerber X2 copper/mask/paste/silkscreen/outline files, an Excellon drill file, and a non-empty board-only STEP file. Full log and files are in [GitHub Actions run 40053908270](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40053908270) and artifact 12544064934. This proves the minimal native workflow only; the STEP is board-only, not a component assembly model.

The official ESPHome 2026.10.0 container (digest pinned in the workflow) validated generated YAML from the candidate ESP32-S3 fixture map. Output: `INFO Configuration is valid!`, `i2c_sda: GPIO8`, `i2c_scl: GPIO9`, `relay_gpio: GPIO10`. The first attempt failed because a test secret used ESPHome's forbidden all-zero encryption key; the workflow now generates a random key in ephemeral CI storage and removes the secret file before artifact upload. See [passing run 40054368439](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40054368439). This proves config-schema compatibility, not a native connectivity map, firmware compile, electrical behavior or deployability.

The Windows Node 24.19.0 `node prototype/smoke.mjs` run passes a read-only hand-written MCP subset for project JSON inspection, user JSON component export, YAML preview, resources and invalid arguments. It does not read the native KiCad project, use the official MCP SDK, or prove interoperability with Codex/OpenAI or Claude/Anthropic clients. A KiCad 10.0.7 CI fixture now generates an editable 23-component ESP32-S3/BME280/relay schematic, verifies 16 named native-net groups, and passes initial and reopened ERC with 0 errors and 0 warnings ([run 40057214585](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40057214585)). GPIO8/9/10 are cross-checked against U1 pins 12/17/18 before the official ESPHome 2026.10.0 CLI validates generated YAML. The reference PCB, its DRC and manufacturing outputs, assembly STEP, hardware behavior and native personal-library round-trip remain untested. The fixture's regulator and relay part choices are source-supported candidates; see [component selection notes](../research/ESP32-REFERENCE-FIXTURE-COMPONENTS.md).

**Checkpoint 3 boundaries:** the routed ESP32 PCB, DRC, Gerber X2/Excellon/assembly STEP export and native component round-trip passed on hosted KiCad 10.0.7 CI, but this is only a feasibility fixture and is **NOT APPROVED FOR MANUFACTURE**. The desktop shell was launched and captured on hosted Windows CI and a portable ZIP was assembled; owner-machine interaction, Linux packaging and managed-host Electron launch remain untested/blocked. Forge, Gerber-to-DXF/CNC coordinate accuracy, current-protocol MCP SDK and Codex/Claude interoperability, firmware compilation, and staged AI modification/approval remain untested or unimplemented. No system-wide tools were installed and no machine configuration was changed.

Major risks remain EDA file/API version drift, license/provenance of each component asset, safe writes and rollback, converter coordinate accuracy, component STEP alignment, power/thermal/antenna behavior, firmware assumptions, MCP client differences, and false confidence from ERC/DRC or YAML schema acceptance. These automated checks do not substitute for electrical, layout and hardware review.

## Conclusion

The minimal engine smoke and the hosted Checkpoint 3 native fixture flow have passed. The Electron + TypeScript workflow shell launches on hosted Windows CI, and the portable preview package is ready for owner-machine acceptance; the managed desktop runtime remains blocked by an environment-specific startup failure. The KiCad 10.0.7 engine remains provisional, with LibrePCB documented as an alternative. The routed candidate board's power layout, electrical margins, antenna/RF performance and model orientation need an engineering review before any manufacturing decision.
# Checkpoint 3 desktop preview

The first desktop preview is a 0.3.0 Electron 45 + TypeScript workflow shell; this is a provisional UX implementation, not a final framework decision. It retains KiCad 10.0.7 as a separately installed editor/engine. `desktop/main.cjs` owns narrow, allowlisted file dialogs and `execFile` calls; `desktop/preload.ts` exposes typed methods over context-isolated IPC; the renderer has `nodeIntegration: false`, Chromium sandbox, local-only CSP, no navigation, and no raw shell or filesystem API. Native editor buttons require the matching project file. ERC/DRC and exports invoke KiCad CLI and preserve output paths. The AI, Forge and CNC status is explicitly unavailable.

The preview compiles locally with pinned TypeScript 5.9.3 on Windows/Node 24.19.0. The local Electron process did not produce a window in this environment; see the Checkpoint 3 report. Native project generation, custom library round-trip and a working desktop screenshot remain gated on real tool results. `npm run start` is the development launch; `npm run capture` attempts an actual Electron `capturePage` screenshot. The optional Windows preview ZIP is assembled by GitHub Actions, not an installer. KiCad 10.0.7 and ESPHome CLI must be installed separately by the user.
