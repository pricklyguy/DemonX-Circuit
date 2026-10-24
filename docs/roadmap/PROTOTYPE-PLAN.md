# Prove the Circuit workflow in small steps

This checkpoint supports a direction but does **not** yet demonstrate the required EDA workflow. Research dated 2026-10-23 recommends a DemonX-owned UI/manifest over KiCad 10.0.7 CLI with native files preserved, and LibrePCB as the alternative fixture to compare. Keep work on a dedicated feature branch; do not change or merge existing DemonX applications.

## Initial checkpoint: evidence and gaps

| Capability | Evidence at checkpoint | Status |
|---|---|---|
| Project create/open | `examples/esp32-sensor/project.json` is a small DemonX manifest; native files list is empty and status says `not-created` | Manifest fixture only; no KiCad project opens |
| Existing/custom component library | One JSON component record exists under `examples/libraries/DemonX_Local`; MCP source returns it | No engine library load, edit round-trip, archive/backup/restore or community search |
| MCP inspection | `node prototype/smoke.mjs` passes initialization, tool discovery/schema annotations, read-only project/component/YAML/resource calls, and invalid-argument errors against the declared 2025-11-25 subset | Working subset smoke only; no named-client or current 2026-07-28 conformance |
| ESPHome generation | Node syntax checks pass; standalone generator created `examples/esp32-sensor/esphome.yaml` from ESP32-S3-WROOM-1-N8 logical map GPIO8/9/10, placeholder secrets and overwrite protection | YAML was not parsed or checked by ESPHome; logical map is not a native verified netlist |
| ERC / DRC | `kicad-cli` absent; no native schematic/board exists | Not run; no native design |
| Gerber / Excellon / STEP | `kicad-cli` absent; no native PCB exists | Not run; no manufacturing or 3D artifact |
| Gerber-to-DXF | Existing converter source inspected; parser and coordinate gaps documented in suite handoff | Not run; do not claim CNC-ready geometry |
| ESPHome validation | `esphome` CLI and YAML parser absent | `esphome config` / compile not run |

The MCP subset smoke, Node syntax checks and YAML file generation are the actual recorded tests. Machine/tooling availability is a blocker for EDA and ESPHome validation: KiCad CLI and ESPHome CLI are absent. A bundled Python 3.12.14 runtime is available, but ESPHome and a YAML parser are not installed. Acquire/pin toolchains or use documented setup CI before claiming those paths work. Other risks: KiCad/GPL redistribution review, library asset licenses, proprietary EasyEDA asset provenance, current MCP protocol/client differences, coordinate transforms, STEP alignment in Forge, board pin validation, and user secrets.

## Proposed phases

**Milestone 1 — native fixture feasibility (next).** Provision pinned KiCad 10.0.7 and ESPHome 2026.10.0 on Windows and Linux. Finish a native ESP32-S3-WROOM-1-N8 + BME280 + protected low-voltage relay design with exact, licensed symbols/footprints. Run actual ERC/DRC; export Gerber X2, Excellon and STEP; inspect reports and coordinate origins; round-trip a user-owned native library component; save/reopen; run `esphome config` and compile where toolchain permits. Do not route or connect mains. This is blocked in the present environment by missing EDA/firmware tools and native project files.

**Milestone 2 — adapter and project package.** Add manifest schema/versioning, path-safe packaging, engine detection, CLI capability gates, report parsing, project backup/staging/diff/rollback. Compare the same fixture in LibrePCB for checks, output and library coverage. Select whether KiCad remains the default based on evidence.

**Milestone 3 — read-only MCP and AI review.** Replace handwritten protocol stub with pinned MCP SDK implementation aligned to a stated protocol revision. Test named compatible clients. Add scoped project, net, component, geometry and library inspection; return source/version/confidence and mark engineering recommendations as suggestions.

**Milestone 4 — approved changes and manufacturing.** Add staged edits, validation, explicit approval and audit trail. Add export manifest with unit/origin/layer mapping and keep original Gerbers/drills. Evaluate converter only with curated fixtures and downstream CNC/CAM geometry checks. Do not emit toolpaths until coordinate accuracy is proven.

**Milestone 5 — Forge and firmware handoffs.** Validate STEP and board envelope orientation in Forge. Generate board-specific ESPHome templates and test pinned CLI configuration/compile. Add user-guided HA discovery. Consider optional HA companion/config flow only after YAML workflow is useful.

## Exact next milestone

**Complete Milestone 1: a reproducible native KiCad + ESPHome fixture run.** Deliver a checked-in native project, license/provenance ledger for each component, successful or diagnostically explained ERC/DRC, Gerber X2/Excellon and STEP exports, and captured `esphome config`/compile result (or clearly documented toolchain blocker). Then validate YAML from the fixture and test both supported OS paths before calling the prototype portable. At current checkpoint, the exact next action is to run the complete native workflow after obtaining the pinned Windows/Linux toolchains; current evidence does not justify starting the GUI.

## Owner decisions before expansion

The owner approved continuing with KiCad CLI as the provisional foundation and selected the ESP32-S3-WROOM-1-N8 fixture target. Still unresolved before expansion: whether users must install KiCad or Circuit may later bundle it after legal review; whether community sharing allows only assets with explicit redistribution rights; and which MCP client versions are release targets. Deployment to an ESPHome device and writes to external applications remain out of scope until later approval.
