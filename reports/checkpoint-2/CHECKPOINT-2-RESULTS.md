# DemonX Circuit — Checkpoint 2 results

Date: 2026-10-24
Branch: `codex/demonx-circuit-foundation`

## Recommendation

Keep KiCad 10.0.7 as the provisional native engine. The minimal proof established project creation/reopening, actual ERC/DRC, Gerber X2, Excellon and board-only STEP export in an isolated official KiCad container. It has not yet exercised the ESP32 fixture, component library ownership round-trip, full assembly STEP or cross-platform desktop integration, so it does not settle long-term engine choice. Keep LibrePCB as the documented alternative.

For the first usable DemonX Circuit desktop application, build an Electron 45 project/workflow shell with TypeScript UI and a separate KiCad installation. Launch native KiCad for schematic and PCB canvases. Circuit should own project onboarding, libraries, checks/reports, ESPHome preview, manufacturing handoffs and the AI review surface. Use a sandboxed renderer and allowlisted local process adapters. Electron 45 is a recommendation only; the shell has not been implemented or packaged.

## Actual test results

| Feature | Status | Evidence |
|---|---|---|
| Minimal KiCad project create/reopen | **PASS** | KiCad 10.0.7 in official container on Ubuntu 24.04; project files created, saved/reopened with `sch upgrade --force` and `pcb upgrade --force`, then netlist exported. [Actions run 40053908270](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40053908270), artifact 12544064934. |
| Minimal project ERC/DRC | **PASS** | Initial and reopened ERC/DRC exit codes `0/0`; 0 ERC errors/warnings, 0 DRC violations, 0 unconnected pads. |
| Gerber/Excellon export | **PASS** | Gerber X2 layer set (copper, mask, paste, silkscreen, outline) and Excellon drill file generated. Coordinate alignment and downstream Gerber-to-DXF are not proven. |
| STEP export | **PASS, limited** | Non-empty board-only STEP file generated. Component assembly geometry/orientations are **NOT TESTED**. |
| Reference schematic generation | **PASS** | KiCad 10.0.7 generated the editable 23-component ESP32-S3-WROOM-1-N8/BME280/TPS563201/relay schematic. The native XML netlist matched all 16 expected nets, including GPIO8/GPIO9/GPIO10 and relay contact groups. [Passing run 40057214585](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40057214585), [artifact 12545378201](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40057214585/artifacts/12545378201). |
| Reference schematic ERC/reopen | **PASS** | Initial and reopened KiCad ERC both report 0 errors and 0 warnings. Symbol inheritance warnings, the BME280 address strap/ERC conflict and an invalid generic inductor footprint were exposed and corrected during iterative runs. The final check did not suppress ERC rules. |
| ESPHome YAML from native netlist | **PASS** | Generator now requires KiCad-verified `U1.12=I2C_SDA`, `U1.17=I2C_SCL`, `U1.18=RELAY_GPIO` and the separately recorded Espressif GPIO map before writing YAML. The same passing run reports `Native KiCad connectivity source: DX_ESP32_Sensor.net`. |
| ESPHome schema validation | **PASS** | Official `ghcr.io/esphome/esphome:2026.10.0` pinned by digest; final integrated run reports `INFO Configuration is valid!` with GPIO8/9/10. Validation secrets are generated ephemerally and removed before artifact upload. An earlier integrated attempt **FAIL**ed because the example all-zero API key is reserved; this was fixed and rerun. |
| MCP subset smoke | **PASS, limited** | Local Windows Node.js 24.19.0: `MCP subset smoke passed: initialization, tool discovery/schema annotations, read-only inspect/export/generation, resource read, and invalid-argument/method errors.` This reads the JSON manifest, not the native KiCad project. |

Relevant exact output:

```text
KiCad 10.0.7
** ERC messages: 0 Errors 0 Warnings **
** Found 0 DRC violations **
** Found 0 unconnected pads **
Successfully saved schematic file using latest format
Successfully saved board file using latest format
ERC exit codes (initial/reopened): 0/0
DRC exit codes (initial/reopened): 0/0
PASS: KiCad 10.0.7; native project generated, checked, exported, and reopened by CLI.

ESPHome 2026.10.0
INFO Reading configuration DX_ESP32_Sensor.esphome.yaml...
INFO Configuration is valid!
  i2c_sda: GPIO8
  i2c_scl: GPIO9
  relay_gpio: GPIO10
```

The last lines above are native-derived YAML schema validation. This is not an ESPHome firmware compile, circuit simulation, board DRC or hardware test.

### Failed iterations retained

These failures were observed and corrected; they are not hidden by the passing run:

- **FAIL, run 40056091782:** KiCad reported three inherited-symbol mismatches and one bidirectional-pin/power-output conflict; the pin-group check itself passed. Replaced inherited symbols and separated the BME280 address strap.
- **FAIL, run 40056297142:** ERC found an undriven ground and a nonexistent inductor footprint. Added a ground power marker with a separate 0 Ω SDO strap and selected a standard library footprint.
- **FAIL, run 40056626569:** KiCad checks passed, but the minimal KiCad image has no Node.js. Moved YAML generation to the runner.
- **FAIL, run 40056817200:** Native connectivity and ERC passed; ESPHome rejected the all-zero example API key. The final workflow uses a random temporary key and removes the secret file.

The latest full run 40057214585 is **PASS** for its declared smoke, netlist, ERC, reopen and ESPHome schema-validation steps.

## Not tested / current blockers

- The full schematic passed netlist verification and ERC, but its PCB has not been created. Fixture-specific board DRC, Gerber/Excellon exports and assembly STEP are **NOT TESTED**; the small LED/resistor board alone passed those native manufacturing checks.
- Native custom component creation/edit/export/reimport; personal library backup/restore; community component search with explicit redistribution-rights enforcement.
- ESPHome firmware compile, hardware behavior, upload, Device Builder handoff or Home Assistant changes.
- MCP SDK/current-spec implementation and real Codex/OpenAI or Claude/Anthropic client interoperability.
- Windows KiCad or ESPHome execution, Windows/Linux desktop packaging, Gerber-to-DXF accuracy, CNC coordinate/mirroring contract, Forge STEP orientation.

No system-wide dependencies were installed and no machine configuration changed. The KiCad/ESPHome proofs ran in disposable CI containers pinned to version and digest. The source checkout stays on the approved feature branch; there is no merge to `main`.

## Selected reference circuit candidates

The candidate set is TI TPS563201 regulator, Bosch BME280, Omron G5V-1 5 V relay, onsemi MMBT2222ALT1G driver, and onsemi MMSD4148T1G flyback diode. The exact source-backed values and unverified design checks are in [ESP32-REFERENCE-FIXTURE-COMPONENTS.md](../../docs/research/ESP32-REFERENCE-FIXTURE-COMPONENTS.md). They are not a production approval or evidence of a fully checked circuit. Relay contacts stay low-voltage DC; no mains is in scope.

## Proposed next milestone

Create and route a two-layer PCB for the passing native ESP32 fixture. Run board DRC, reopen the generated project, and produce fixture-specific Gerber, Excellon and 3D assembly outputs when the component models and orientations are available. In parallel, demonstrate a native user-owned component library export/reimport. Then review layout, antenna keepout and electrical suitability before treating any manufacturing file as ready for fabrication.

Owner decisions are listed in [the roadmap](../../docs/roadmap/PROTOTYPE-PLAN.md): approve Electron 45 or request a Tauri comparison, approve the candidate components for prototype placement (not manufacturing), confirm low-voltage-only relay scope, and select client versions for later MCP conformance tests.
