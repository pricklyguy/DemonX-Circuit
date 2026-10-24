# Feasibility prototype

## Electron desktop preview (0.5.0)

The preview is an Electron + TypeScript KiCad project workflow. Install Node.js 24.x, then run `npm ci` and `npm start` from the repository root. The Electron runtime is downloaded into this repository's `node_modules`; KiCad 10.0.7 and ESPHome remain separate user-installed tools. The app does not run an automatic installer or change PATH/registry. `npm run build` compiles the sandboxed renderer and typed preload API. The Windows CI workflow creates a portable development-preview ZIP and runs packaged click acceptance; see [Windows distribution evidence](../docs/security/WINDOWS-DISTRIBUTION.md).

The KiCad reference-board experiment invokes FreeRouting 2.5.0 as a disposable CI-only autorouter. It downloads the upstream JAR from the tagged release and checks its published SHA-256 before routing over the documented Specctra DSN/SES format. It is GPL-3.0, is not part of the Electron app or its preview package, and no net class is excluded from routing. The output must still pass KiCad DRC and is not manufacturing-approved.

Open `examples/esp32-sensor` to inspect the manifest, component library and firmware inputs. Its generated KiCad 10.0.7 schematic and PCB, verification reports and manufacturing outputs are retained in the native smoke workflow artifact rather than checked into the repository. New Project creates a real `.kicad_pro`, `.kicad_sch` and `.kicad_pcb`, plus project-local library tables and reports/manufacturing folders; KiCad CLI verifies the native starter before the app records its manifest. Open Schematic/Open PCB launch the installed KiCad editors. Check Circuit executes actual ERC/DRC, and Prepare Manufacturing exports Gerber X2, Excellon and STEP. KiCad 10.0.7 must be installed separately.

The ESPHome action previews a YAML configuration derived from the verified native netlist and explicit GPIO map, then validates it with the detected ESPHome CLI when available. Save uses a user-selected path, compares an existing file and backs it up before an approved replacement. It never deploys firmware. AI/MCP, DemonX Forge and CNC actions remain visibly unavailable; no mock responses are returned.

The hosted Windows CI runner extracts and launches the portable ZIP, clicks the project/settings/theme/native/firmware controls, checks persistence, and captures dark/light screenshots. This hosted-runner acceptance passed on 2026-10-24. The owner's Windows computer remains **NOT TESTED**; KiCad and ESPHome are still separately installed dependencies.

This small Node.js prototype exercises portable project metadata, an owner-controlled component record, a read-only MCP stdio surface, and ESPHome YAML generation from an explicit logical ESP32-S3-WROOM-1-N8 pin map. It is not a native schematic or PCB and does not establish hardware correctness.

Run `node prototype/generate-esphome.mjs` from any directory to create `examples/esp32-sensor/esphome.yaml`. The explicit example map is GPIO8 SDA, GPIO9 SCL, GPIO10 relay driver; it is not validated against a native schematic. Existing files are refused by default. With `--force`, the generator creates a non-overwriting `.bak` copy, displays old and proposed YAML, and requires typing `REPLACE` before writing. The sample secrets file contains placeholders only; real secrets belong outside version control.

Run `node prototype/mcp-server.mjs` as an MCP stdio server. It implements a narrow 2025-11-25 initialize/tools/resources request subset: initialize, tools/list, tools/call, resources/list, and resources/read. `node prototype/smoke.mjs` exercises initialization, advertised schema annotations, read-only tool/resource calls and invalid-argument errors. This is not latest-revision or Codex/Claude client conformance. Its tools only return data; they cannot edit project files or deploy firmware.

The JSON manifest is not itself a KiCad schematic or PCB and does not provide electrical verification. The ESP32-S3/WROOM-1-N8 fixture now has a native KiCad schematic generator, named-net assertions, a routed native PCB, pre- and post-reopen KiCad 10.0.7 ERC/DRC, Gerber X2/Excellon/STEP exports, and a user-owned KiCad component export/delete/reimport/reuse proof in CI. The candidate circuit includes a 5 V DC input, TPS563201 regulated 3.3 V rail, bare BME280 I2C sensor, and Omron G5V-1 DC5 relay with a low-side MMBT2222ALT1G driver and MMSD4148T1G suppression diode. The Coilcraft XGL4020-222MEC inductor and project-authored footprint are added as prototype candidates. Placement, routing and a 0.15 mm DRC capability profile are feasibility evidence only; regulator-loop quality, current/thermal margins, component-model accuracy, RF, mechanical fit and hardware behavior still need engineering review. Relay contacts are low-voltage DC only; no mains routing is in scope. **NOT APPROVED FOR MANUFACTURE.**

## Reproducible feasibility commands

- Runtime: Node.js 24.x (`node --version`); no npm packages are required.
- KiCad: install the pinned 10.0.7 stable release from the [official downloads](https://www.kicad.org/download/), then run `kicad-cli version`.
- ESPHome: use Python 3.12+ and an isolated virtual environment, then `python -m pip install esphome==2026.10.0`; verify `esphome version`.
- Run `node --check prototype/generate-esphome.mjs`, `node --check prototype/mcp-server.mjs`, `node --check prototype/smoke.mjs`, and `node prototype/smoke.mjs`.
- Regenerate into a new path with `node prototype/generate-esphome.mjs C:\\temp\\dx-sensor.yaml`; validate only after providing a local secrets file with `esphome config C:\\temp\\dx-sensor.yaml`.
- The native project and reports are generated by the pinned KiCad 10.0.7 CI workflow and attached as a run artifact; they are not checked into the source tree. The managed local shell has no KiCad CLI or ESPHome CLI, so reproduce native checks only on a machine with those independently installed tools. Do not manufacture or flash from this fixture.

Windows and Linux runs should use the same pinned native CLI versions and compare recorded output hashes/reports. At this checkpoint, only Windows Node.js smoke testing was available; Linux portability is not yet tested.
