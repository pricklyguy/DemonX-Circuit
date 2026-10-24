# DemonX Circuit — Checkpoint 3 results (in progress)

Date: 2026-10-24  
Branch: `codex/demonx-circuit-foundation`  
Scope: approved Checkpoint 3. No merge to `main`, no other DemonX repositories changed.

## Status

| Requirement | Result | Evidence / boundary |
|---|---|---|
| Electron 45.0.0 project-local runtime | **PASS** | `node_modules/electron/dist/electron.exe --version` → `v45.0.0`; runtime exists in repository-local `node_modules`. No system installer/PATH/registry change. |
| TypeScript build | **PASS** | Windows Node.js `v24.19.0`, npm `11.17.0`; `npm run build` → TypeScript compilation exits 0. |
| Existing prototype regression | **PASS** | `node prototype/smoke.mjs` → `MCP subset smoke passed: initialization, tool discovery, schema annotations, read-only calls, resource read, and invalid-input handling.` |
| ESPHome preview generator | **PASS, manifest only** | `node prototype/generate-esphome.mjs --stdout --project examples/esp32-sensor/project.json` produced YAML with explicit GPIO8 SDA, GPIO9 SCL, GPIO10 relay. This does not prove native schematic connectivity or ESPHome schema compatibility. |
| Electron window launch on this Windows host | **FAIL / environment blocker** | `npm run capture` exited 1. Direct Electron with GPU exited `-1073741819` (`0xC0000005`). With `--disable-gpu`, Electron loaded the main module but did not reach its `ready` event or create a window; a minimal Electron app reproduced the same startup stall. |
| Actual app screenshot | **NOT TESTED** | No Electron window was available to capture. The Windows CI workflow attempts a real `webContents.capturePage()` screenshot and records failure separately; its result is pending. |
| Portable Windows preview ZIP | **NOT TESTED** | A Windows hosted-runner packaging workflow is added. Artifact availability/launch must be checked from its actual run before calling this usable. |
| KiCad / ESPHome installed on host | **NOT TESTED locally** | `kicad-cli`, KiCad desktop, ESPHome, Docker/Podman and `python` are not available in the current shell. The prior pinned CI remains the source of native tool evidence. |
| Reference PCB placement and routing | **NOT TESTED** | The ESP32 schematic has passed its previously reported ERC/netlist checks, but no full fixture PCB exists yet. No fixture DRC, manufacturing export, assembly STEP, or reopen/recheck result is claimed. |
| Original KiCad-native user component | **IN PROGRESS; KiCad export reached, round-trip incomplete** | KiCad 10.0.7 successfully converted the original user-authored legacy `.lib` into `.kicad_sym` and emitted `Plotting symbol 'DX_User_Header_1x02' unit 1 to ..._unit1.svg`. The harness expected the wrong SVG filename and stopped before footprint reimport/reuse; the filename check is corrected for the next CI run. No complete round-trip is claimed yet. |
| ESPHome configuration with installed official CLI | **NOT TESTED locally** | Desktop code runs `esphome config` against the candidate YAML with ephemeral local placeholder secrets when an ESPHome CLI is detected. This machine has no CLI. Previous Checkpoint 2 hosted validation remains valid only for the prior schematic/netlist-generated configuration. |
| Provider MCP interoperability | **NOT TESTED** | The app labels AI/MCP unavailable. The existing hand-written read-only protocol subset remains limited and does not prove Codex/OpenAI or Claude/Anthropic compatibility. |
| Forge and CNC handoffs | **NOT TESTED** | UI labels both unavailable. No coordinates, Gerber-to-DXF, machining, or STEP orientation claim. |

## Desktop implementation

`desktop/` contains the Electron 45 app shell and TypeScript renderer/preload. The renderer enables context isolation, sandboxing, no Node integration, a local restrictive CSP, blocked navigation, and typed IPC. Main-process handlers use fixed KiCad/ESPHome argument lists, file dialogs, per-project paths, report files, and filesystem backup/approval flows. Buttons require native project files and return `NOT TESTED` when the required engine or file is absent. The AI panel accurately says unavailable; Forge and CNC are not presented as implemented. New Project creates a portable manifest-only folder and does not imply it created a schematic or PCB.

Launch command on a normal Windows desktop: `npm ci` followed by `npm start` from the repository root. Linux architecture is retained but has not been run. KiCad 10.0.7 and the ESPHome CLI must be separately installed. The optional Windows ZIP is a portable preview, not an installer, and does not include KiCad or ESPHome.

The local launch blocker is isolated to Electron/Chromium startup on this managed host; the Electron runtime and TypeScript compile succeeded. It is not safe to report the current preview as interactively usable until the hosted Windows job launches and captures the real window. No mock UI screenshot is substituted.

## Native component ownership implementation

The original component is a generic 2.54 mm 1x02 through-hole header; symbol and footprint files have no upstream asset dependency and are labeled CC0-1.0. The round-trip script records file hashes, makes an export ZIP, removes its source test workspace, imports into a clean workspace, and asks KiCad 10.0.7 to parse the symbol SVG and load both numbered footprint pads into a board which it reopens. **The files and test are authored; successful KiCad execution is pending CI.** This is not proof the generic header dimensions fit a particular manufactured part.

## Current blockers and risks

1. Full ESP32 PCB placement/routing, antenna copper keepout, actual KiCad DRC, Gerber X2/Excellon, assembly STEP and reopened-project checks remain outstanding. The relay is strictly low-voltage DC and the entire fixture is **NOT APPROVED FOR MANUFACTURE**.
2. This host cannot currently launch Electron, so the requested live desktop screenshot and local interactive usability proof are outstanding. The Windows runner result is the next evidence point.
3. KiCad and ESPHome are absent locally. Native checks must continue in the immutable KiCad 10.0.7 and ESPHome 2026.10.0 CI toolchains; no system-wide installs were attempted.
4. The application shell does not yet edit schematic or PCB documents itself, manage library edits in its UI, implement an MCP SDK/client, generate an enclosure or import Gerber into CNC.
5. User-generated component engineering review, firmware behavior and all physical electrical/mechanical behavior remain outside automated artifact validation.

## First-usable application recommendation

Continue with the **DemonX-owned Electron + TypeScript workflow shell backed by separately installed KiCad**, retaining native KiCad editors for schematic and PCB canvases. This remains provisional until the Windows preview artifact can be launched and captured on an ordinary Windows desktop. Do not fork KiCad or build a replacement canvas at this stage. If the hosted Windows artifact also fails to create a real window, resolve the Electron/Windows runtime issue before expanding the application shell; consider a small Tauri comparison only if the block is architectural rather than host-specific.

## Exact next milestone

1. Inspect both new GitHub Actions runs. Preserve the full output and artifacts. Require the user-library round-trip proof and the Windows app launch/screenshot/package status to be explicit PASS/FAIL/NOT TESTED.
2. If the hosted desktop window launches, verify the screenshot visually and test New Project, Open Project, component/library view, operation statuses and YAML preview/save behavior in the artifact.
3. Lay out and route the native ESP32-S3/BME280/TPS563201/low-voltage relay fixture. Verify exact pin/footprint assignment, regulator requirements, ESP32 antenna copper keepout, board edge/mounting and relay DC-only label before actual KiCad DRC. Export only after DRC output is inspected, reopen the project, rerun verification, and inspect STEP component models/orientations. Continue until pass or report a genuine blocker.
4. Keep all board/manufacturing outputs stamped **NOT APPROVED FOR MANUFACTURE**.

No manufacturing approval is requested or implied at this checkpoint.
