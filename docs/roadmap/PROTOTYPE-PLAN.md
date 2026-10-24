# Prototype plan and checkpoint evidence

Checkpoint 1 approval is recorded. Work is isolated on `codex/demonx-circuit-foundation`; no other DemonX repository was changed, no host toolchain was installed, and no merge to `main` was performed.

## Checkpoint 3 status summary (2026-10-24)

| Capability | Result | Evidence and boundary |
|---|---|---|
| LED/resistor native smoke | **PASS** | KiCad 10.0.7 project creation, ERC/DRC, Gerber X2/Excellon/STEP export, reopen and repeat checks. |
| ESP32-S3/BME280/DC relay native fixture | **PASS, feasibility only** | Schematic/netlist, 64 unrouted items routed to 0, ERC and pre-/post-reopen DRC pass; Gerber X2, Excellon and assembly STEP exported. **NOT APPROVED FOR MANUFACTURE.** See [Checkpoint 3 results](../../reports/checkpoint-3/CHECKPOINT-3-RESULTS.md). |
| KiCad user-owned component round-trip | **PASS** | CC0 source exported, original test workspace deleted, reimported with matching hashes, parsed and reused on a reopened board. Generic test component only. |
| ESPHome validation | **PASS, schema only** | YAML generated from native netlist GPIO8/9/10 mapping; official ESPHome 2026.10.0 reports valid configuration. No compile/deploy/hardware validation. |
| Electron desktop preview | **PASS on hosted Windows CI** | TypeScript build, real Electron launch/screenshot and portable ZIP build. Owner-machine interactive acceptance and Linux packaging **NOT TESTED**. KiCad and ESPHome remain separate installs. |
| AI/MCP provider compatibility | **NOT TESTED** | Existing read-only hand-written subset only; no official SDK or Codex/Claude client interoperability proof. UI shows unavailable. |

## Checkpoint 2 status summary (historical, 2026-10-24)

| Capability | Result | Evidence and boundary |
|---|---|---|
| Minimal native project create/reopen | **PASS** | KiCad 10.0.7 created an LED/resistor project in Ubuntu 24.04 CI; `sch upgrade --force` and `pcb upgrade --force` reopened/saved it. Later netlist export succeeded. Artifacts: [run 40053908270](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40053908270). |
| ERC/DRC for smoke project | **PASS** | 0 ERC errors/warnings, 0 DRC violations, 0 unconnected pads; initial and reopened exit codes were 0. This does not validate the ESP32 reference fixture. |
| Manufacturing smoke exports | **PASS** | Gerber X2 layers and job file, Excellon drill file, non-empty board-only STEP. Coordinate/converter accuracy and component-assembly STEP were not checked. |
| KiCad existing library access | **PASS, limited** | Official symbol/footprint tables were initialized in the isolated official KiCad image; built-in LED, resistor and connector assets loaded. Not a community library search or custom library round-trip. |
| User custom component native export/import | **NOT TESTED** | Existing MCP fixture exports one JSON component record; no native `.kicad_sym`/`.pretty` create-export-reimport was executed. |
| Reference ESP32 schematic | **PASS** | KiCad 10.0.7 generated an editable 23-component native schematic. Its native XML netlist passed all 16 expected named-net assertions. Reopened ERC reports 0 errors and 0 warnings. [Run 40057214585](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40057214585), [artifact 12545378201](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40057214585/artifacts/12545378201). |
| ESPHome from native connectivity | **PASS** | The generator checks native netlist U1.12/U1.17/U1.18 groups against the ESP32-S3 datasheet pin map, then the official ESPHome 2026.10.0 CLI reports `INFO Configuration is valid!`. No firmware compile or hardware connection. |
| Reference board DRC/manufacturing/3D | **NOT TESTED** | The reference PCB has not been laid out. The only board-level DRC, Gerber, drill and board STEP proof is the small LED/resistor smoke board. |
| MCP project inspection | **PASS, limited** | Windows Node 24.19.0 `node prototype/smoke.mjs` passed init, tool discovery, read-only manifest/component/YAML calls, resource read and invalid-input handling. It reads the JSON fixture, not native KiCad. |
| MCP interoperability | **NOT TESTED** | Hand-written protocol subset targets 2025-11-25. No official SDK, Codex/OpenAI, Claude/Anthropic or other-client conformance claim. |
| ESP32-S3 YAML generation | **PASS** | Generated from the explicit candidate GPIO8 SDA / GPIO9 SCL / GPIO10 relay map. Generator creates missing parent directories and refuses existing outputs unless backup, comparison and typed approval are used. |
| ESPHome config validation | **PASS** | Official ESPHome 2026.10.0 image, pinned by digest, printed `INFO Configuration is valid!`; parsed substitutions as GPIO8/9/10. Passing [run 40054368439](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40054368439). |
| ESPHome compile/deploy | **NOT TESTED** | `esphome config` only; no compilation, hardware connection, flashing, Device Builder upload or HA change. CI uses disposable placeholder secrets and removes the file before artifact upload. |
| Complete reference fixture | **PARTIAL** | Schematic, native connectivity assertions, ERC and native-derived ESPHome YAML schema validation pass. PCB placement/routing, fixture DRC, fixture Gerbers/drill and assembly STEP remain untested. Candidate parts and physical design limits are documented in [ESP32-REFERENCE-FIXTURE-COMPONENTS.md](../research/ESP32-REFERENCE-FIXTURE-COMPONENTS.md). |
| Windows EDA and ESPHome workflow | **NOT TESTED** | Host has no KiCad CLI or ESPHome; no host installations or machine changes. Windows was tested for Node/MCP/YAML generation only. |
| Gerber-to-DXF / CNC and Forge | **NOT TESTED** | No geometry handoff or manufacturing coordinate test in this checkpoint. |

## Actual outputs

KiCad 10.0.7 container output included:

```text
** ERC messages: 0 Errors 0 Warnings **
** Found 0 DRC violations **
** Found 0 unconnected pads **
STEP file reports/native-smoke/step/DX_LED_Smoke.step created.
Successfully saved schematic file using latest format
Successfully saved board file using latest format
ERC exit codes (initial/reopened): 0/0
DRC exit codes (initial/reopened): 0/0
PASS: KiCad 10.0.7; native project generated, checked, exported, and reopened by CLI.
```

ESPHome first reported a **FAIL** because the schema rejects its all-zero API key test value. The workflow now generates a random key ephemerally; the subsequent run output was:

```text
Version: 2026.10.0
INFO ESPHome 2026.10.0
INFO Reading configuration dx-esp32-sensor.generated.yaml...
INFO Configuration is valid!
  i2c_sda: GPIO8
  i2c_scl: GPIO9
  relay_gpio: GPIO10
```

The failing run and correction are retained in GitHub Actions history; only the passing output establishes YAML schema acceptance.

## Safe toolchain provisioning

The proven Linux path uses official KiCad 10.0.7 and ESPHome 2026.10.0 containers pinned by immutable digests, run in disposable Ubuntu CI with the repository mounted as a workspace. For future Windows verification, use a disposable GitHub-hosted Windows runner and the official signed KiCad installer; verify the Authenticode signature before invoking it and pin the exact downloaded artifact/version. GitHub documents each hosted runner job as a fresh VM, and KiCad publishes the Windows signature-verification procedure. This Windows path is researched but **NOT TESTED**. Do not install onto the developer workstation or change its PATH/registry. ([GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [KiCad Windows installer verification](https://www.kicad.org/help/windows-download-verification/), [KiCad Windows downloads](https://www.kicad.org/download/windows/))

## Candidate circuit selections

- Controller: ESP32-S3-WROOM-1-N8; GPIO8 SDA, GPIO9 SCL and GPIO10 relay control are candidate assignments. Native symbol pad numbering still needs a checked mapping.
- Sensor: bare BME280 at I²C address 0x76, CSB high, SDO low, local decoupling and pull-ups.
- Regulator: TI TPS563201, using TI's 3.3 V recommended 33.2 kΩ/10.0 kΩ feedback, 2.2 µH typical inductor and 20–68 µF output-capacitance table range.
- Relay: Omron G5V-1 5 V coil (30 mA nominal) with onsemi MMBT2222ALT1G low-side transistor, 330 Ω base resistor, 100 kΩ base-emitter pulldown, and onsemi MMSD4148T1G flyback diode. Contacts stay low-voltage DC only.

These are manufacturer-sourced candidates, not an approved production design. Verify exact symbol pins, package assignments, transistor saturation, thermal/current margins, layout, antenna keepout and load suitability. KiCad rule checks are not electrical simulation or hardware testing.

## Recommended first usable desktop application

Proceed with an Electron 45 project/workflow shell (TypeScript UI) and separate KiCad 10.0.7 installation. Reuse the native editor for schematic and PCB canvas work. Initial controls should cover New/Open Project, Add Component/library ownership, Open in KiCad, Check Circuit, Prepare Manufacturing Files, Ask AI, Generate ESPHome YAML and Create Enclosure handoff. The main process owns allowlisted native CLI/ESPHome process adapters; the renderer stays sandboxed and has no direct filesystem or shell privilege. Show results, assumptions and diffs before any write or external action.

This recommendation is for the first UI milestone only; implementation is an Electron 45/TypeScript workflow-shell preview on the approved branch. Its renderer/preload compile, but this Windows environment did not complete Electron startup. A Windows CI job attempts a real capture and portable ZIP; no launch or packaging success is claimed until its artifacts/logs are inspected. Electron 45.0.0 stable was current on 2026-10-24. Tauri remains the lighter alternative if a later platform spike shows Electron packaging or memory costs are unacceptable.

## Proposed implementation phases

1. **Finish native reference fixture.** Build the ESP32-S3/BME280/relay schematic and PCB from official KiCad 10 libraries; export a custom user-owned component; bind firmware pin mapping to schematic nets; run actual ERC/DRC, exports and reopen. Keep all component and license provenance. If DRC is not clean, retain the reports and fix the design rather than suppressing checks.
2. **Validate firmware from native connectivity.** Generate a staged YAML preview with explicit unresolved behavior/placeholders; validate and, when practical, compile with pinned ESPHome. Never deploy or overwrite external configuration.
3. **Build desktop shell.** Electron + TypeScript project dashboard and secured main-process engine adapters. Do not rebuild schematic or layout canvases. Test Windows and Linux separately.
4. **Replace MCP stub.** Use a pinned official MCP SDK/protocol. Read-only native project and library inspection first; then staged writes with validation, explicit user approval, transaction/audit and rollback. Prove Codex/OpenAI and Claude/Anthropic clients before claiming interoperability.
5. **Manufacturing and suite handoffs.** Test Gerber/drill coordinate contracts and converter geometry, then STEP assembly orientation in Forge. CNC toolpath generation remains outside scope until geometry and machining constraints are proven.

## Exact next milestone

**Lay out and route the native ESP32-S3/BME280/relay fixture PCB, then close the user-owned library proof.** Preserve antenna keepout and datasheet package constraints; run KiCad DRC, reopen, export Gerber X2/Excellon and inspect STEP geometry/orientation. Also create/export/reimport one original personal library component using KiCad-native files. Keep the board unfit for manufacture until layout and electrical review plus hardware validation.

## Owner decisions at this checkpoint

1. Approve the proposed Electron 45 + native KiCad editor first-usable-app direction, or request a Tauri comparison spike.
2. Approve the selected component candidates for native prototype placement (not for production/manufacture); otherwise identify preferred part constraints.
3. Confirm whether the fixture may expose only low-voltage relay contacts (current design constraint: yes) and that no mains scenario is in scope.
4. Confirm the first named MCP client builds/versions when ready for actual conformance testing. Current target intent remains Codex/OpenAI and Claude/Anthropic, with no claim until tested.

Do not merge to `main`, install host dependencies, deploy firmware or write to a Home Assistant/Device Builder instance without the relevant approval.
