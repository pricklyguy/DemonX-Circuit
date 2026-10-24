# DemonX Circuit — Checkpoint 3 results

Date: 2026-10-24  
Branch: `codex/demonx-circuit-foundation`  
Native workflow: [KiCad 10.0.7 run 40062064377](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40062064377)

Desktop workflow: [Windows preview run 40062434543](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40062434543)
Native artifact: [download reports, KiCad project, Gerber/Excellon and STEP](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40062064377/artifacts/12547248685) (30-day retention; 637,946 bytes). Refreshed Windows preview artifact: [portable ZIP, artifact 12548410536](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40062434543/artifacts/12548410536) (273,849,307 bytes; 30-day retention). No merge to `main` or changes to other DemonX repositories.

## Status

| Requirement | Result | Evidence / boundary |
|---|---|---|
| Electron 45.0.0 local runtime | **PASS** | Project-local Electron 45.0.0; no machine-wide installer, PATH or registry change. |
| TypeScript build | **PASS** | Node.js 24.19.0, npm 11.17.0; `npm run build` exited 0. |
| Node/MCP read-only smoke | **PASS, subset only** | `node prototype/smoke.mjs` exercised initialize, tool discovery, annotations, read-only calls, resource read and invalid input. This is not SDK conformance or provider interoperability. |
| Hosted Windows app launch and screenshot | **PASS** | Refreshed workflow 40062434543 launched Electron, captured the actual renderer at 1034 × 663, and Electron exited 0. Screenshot: [`desktop-preview.png`](desktop-preview.png). |
| Portable Windows preview ZIP | **PASS, package only** | Workflow artifact `demonx-circuit-windows-preview-0.3.0.zip`, artifact 12548410536. No installer and no KiCad/ESPHome bundled. Owner-machine launch and interactive acceptance remain **NOT TESTED**. |
| Electron launch on this managed Windows host | **FAIL / environment blocker** | Local GPU launch exited `-1073741819` (`0xC0000005`); `--disable-gpu` did not reach `ready`. A minimal Electron app reproduced the startup stall. Hosted Windows succeeded independently. |
| Reference schematic and netlist | **PASS** | Native workflow placed 23 footprints; verified 16 named nets from KiCad XML; ERC before and after reopen each reported 0 violations, 0 errors, 0 warnings. |
| Reference PCB routing | **PASS, feasibility only** | FreeRouting 2.5.0 with pinned SHA-256 `f6f51bb02245e8e717f9359bd260cc9c5c0b1bc0acc8b7cb2cd5b8ffeb5de3c7` routed 64 unrouted items to 0 unrouted / 0 router violations. 23 footprints imported into KiCad. |
| Reference PCB DRC and reopen | **PASS, feasibility only** | KiCad 10.0.7 DRC before and after `pcb upgrade --force` each reported 0 DRC violations, 0 unconnected pads and 0 footprint errors. The project uses explicit 0.15 mm minimum track and through-hole values for a two-layer, 1 oz capability profile; this workflow added no custom exclusions or rule-suppression flags. KiCad's standard ignored-check categories are listed below. Reconfirm with the eventual fabricator. |
| Fixture Gerber X2 / Excellon / STEP | **PASS, NOT APPROVED FOR MANUFACTURE** | Native artifact contains F/B copper, masks, pastes, silkscreens, Edge.Cuts, Gerber job file, absolute-mm Excellon drill and a 2,961,908-byte assembly STEP. KiCad CLI reported `STEP file '...DX_ESP32_Sensor-assembly.step' created.` |
| User-owned KiCad component round-trip | **PASS** | Current native run: CC0 generic header library exported to ZIP, source workspace deleted, reimported with content hashes matching; KiCad 10.0.7 parsed the symbol SVG and `pcbnew` reused both footprint pads in a reopened board. This does not validate fit to a particular purchased header. |
| ESPHome YAML | **PASS, schema only** | Generated from the native verified netlist for GPIO8 SDA, GPIO9 SCL and GPIO10 relay. ESPHome 2026.10.0 `esphome config` printed `INFO Configuration is valid!`. It also emitted a non-fatal warning that the OTA password consumes flash/RAM; credentials were placeholders. No firmware build, flashing or Home Assistant deployment. |
| Local KiCad/ESPHome availability | **NOT TESTED locally** | Neither CLI is installed in the managed shell. No system-wide dependencies were installed. |
| Codex/OpenAI and Claude/Anthropic MCP interoperability | **NOT TESTED** | Desktop correctly labels AI/MCP unavailable. The small hand-written read-only protocol subset is not an SDK or client compatibility proof. |
| Forge/CNC integration and Gerber-to-DXF | **NOT TESTED** | UI marks Forge and CNC unavailable. No coordinates, orientation, milling or CNC handoff is claimed. |
| Hardware, analog, thermal, RF and mechanical validation | **NOT TESTED** | No simulation, assembly, electrical test, thermal measurement, antenna test, enclosure fit check or manufacturing review. Relay contacts remain low-voltage DC only. |

## Actual native output

The KiCad native job printed these decisive results:

```text
PASS: verified 16 named nets from KiCad's native XML netlist
ERC messages: 0  Errors 0  Warnings 0
ERC messages: 0  Errors 0  Warnings 0
FreeRouting: 64 unrouted items -> 0 unrouted and 0 violations
Found 0 DRC violations
Found 0 unconnected pads
Successfully saved board file using the latest format
Found 0 DRC violations
Found 0 unconnected pads
STEP file 'reports/native-reference/layout/step/DX_ESP32_Sensor-assembly.step' created.
PASS: KiCad 10.0.7 imported the routed SES, DRC passed before and after reopen, and fixture Gerber/Excellon/assembly STEP files were generated.
INFO ESPHome 2026.10.0
INFO Configuration is valid!
```

The minimal LED/resistor smoke test also passed on KiCad 10.0.7. Initial and reopened ERC/DRC exited 0; the reports each show 0 DRC violations and 0 unconnected pads. It exported Gerber layers, Excellon drill and STEP, then reopened/rechecked the native project.

KiCad's fixture reports list its standard ignored-check categories (courtyard presence, track endpoint centering on via, tuning geometry and footprint filter/type matching). The workflow added no custom exclusions and used no severity-disabling or rule-suppression flags. DRC confirms the rules active under the declared profile; it does not verify electrical current capacity, thermal margins, regulator placement quality, RF behavior or physical fit.

## Desktop implementation and Windows testing

`desktop/` contains the Electron 45 shell and TypeScript renderer/preload with context isolation, sandboxing, no Node integration, restrictive local CSP and narrow typed IPC. Privileged operations use allowlisted CLI commands and project paths. The visible workflow includes project creation/open, project component/library metadata, KiCad open/check/export actions, ESPHome preview/validation/save safety, honest AI/MCP unavailable state and unavailable Forge/CNC handoffs. It does not provide schematic or PCB canvases, nor does it offer component-library editing UI yet.

To run from the source checkout on Windows, install Node.js 24.x, then run `npm ci` and `npm start`. Install KiCad 10.0.7 separately for native editor, ERC/DRC and manufacturing actions; install ESPHome separately for YAML validation. The hosted preview ZIP is a portable application folder, not an installer, and does not include either tool. Linux remains an architectural target but was not tested.

The screenshot is from the actual hosted Windows Electron window after the compact-width layout fix. The workflow also compiled the TypeScript and built the portable ZIP. The package and screenshot exist as separate 30-day GitHub Actions artifacts; its interactions have not yet been exercised on the owner's machine. App buttons that need absent native files/tools return `NOT TESTED`; AI/MCP, Forge and CNC remain unavailable rather than simulated.

## Native PCB and component ownership boundaries

The board contains 23 footprints, including the ESP32-S3-WROOM-1 KiCad footprint with its antenna keepout geometry, Bosch BME280, TPS563201 regulator, the user project Coilcraft inductor footprint, and a low-voltage DC relay driver. Native ERC, named-net checks, routing and DRC pass as reported above. All component references and engineering limitations remain in the fixture component-selection document and library READMEs.

The 0.15 mm profile reflects a publicly documented two-layer, 1 oz capability floor, not a selected production supplier. Exact manufacturing limits must be reconfirmed before ordering. Power-net width/current and temperature calculations, TPS563201 hot-loop/decoupling/inductor/output capacitor layout review, ESP32 RF/antenna performance, assembly STEP model/orientation inspection and hardware validation remain open. A passing geometric DRC is not manufacturing approval.

The original user component is a generic CC0 2.54 mm 1x02 header. The round-trip preserves its data independently from the fixture and proves KiCad can export, delete, reimport, parse and reuse the native symbol/footprint. It does not identify or guarantee compatibility with a particular commercial part.

## Desktop recommendation

The first usable application should remain the **DemonX-owned Electron + TypeScript workflow shell backed by separately installed KiCad**, with KiCad's native schematic and PCB editors providing the canvases. This is a provisional product direction: the hosted Windows app launched and captured, while local managed-host launch failed and owner-machine ZIP interaction is untested. Keep KiCad 10.0.7 provisional, preserve LibrePCB as the documented alternative, and do not fork an EDA editor or expand into new desktop architecture before owners test the preview.

## Owner review requested

1. Launch and interact with the [portable Windows preview ZIP](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40062434543/artifacts/12548410536) on the intended Windows machine; KiCad 10.0.7 and ESPHome are separate dependencies for their native actions.
2. If the dashboard workflow and Windows runtime are acceptable, authorize the next engineering-layout refinement: reposition/review the TPS563201 power loop, set current-based trace rules, inspect STEP model alignment and rerun DRC/exports. This remains a prototype engineering review; manufacturing approval is a separate later decision.

## Risks and limitations

- The board and outputs are candidate feasibility artifacts, expressly **NOT APPROVED FOR MANUFACTURE**. No mains use; relay contacts are low-voltage DC only.
- The project's minimum geometry was set to a sourced capability profile to make the active KiCad DRC limits explicit. A user must choose/reconfirm the eventual board fabricator and constraints.
- No current-carrying, regulator transient, thermal, EMC/RF, relay-life, safety or full mechanical enclosure validation has been done.
- STEP existence and file size do not prove every footprint model is correctly placed or oriented.
- ESPHome schema success does not compile firmware or prove the chosen GPIOs suit the intended runtime behavior; its OTA-password warning needs a reviewed template update.
- AI/MCP provider clients, staged AI edits/approval, community library rights enforcement, CNC conversion and Forge handoff remain unimplemented or unverified.
- User-machine application interaction and Linux operation remain untested.

## Exact next development milestone

Run an owner-led acceptance pass on the portable Windows ZIP and approve the routed fixture for an engineering-layout refinement milestone. First refine and review the regulator placement and power-net sizing, then rerun native DRC/reopen/exports and inspect the assembly STEP models and antenna keepout. In parallel, correct the ESPHome OTA template warning and validate again. Keep the current outputs marked **NOT APPROVED FOR MANUFACTURE**. Do not expand desktop architecture or begin manufacturing approval before this review.

No manufacturing approval is requested or implied at this checkpoint.
