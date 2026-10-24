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
| ESPHome starter YAML | **PASS** | Generator output uses GPIO8 SDA, GPIO9 SCL, GPIO10 relay; it marks this as a candidate/logical map, not native verified connectivity. |
| ESPHome schema validation | **PASS** | Official `ghcr.io/esphome/esphome:2026.10.0` pinned by digest; [passing run 40054368439](https://github.com/pricklyguy/DemonX-Circuit/actions/runs/40054368439) reports `Version: 2026.10.0` and `INFO Configuration is valid!`. A first run failed because all-zero test API encryption is rejected; CI now creates a random ephemeral validation key and removes its secret file before artifact upload. |
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
INFO Reading configuration dx-esp32-sensor.generated.yaml...
INFO Configuration is valid!
  i2c_sda: GPIO8
  i2c_scl: GPIO9
  relay_gpio: GPIO10
```

## Not tested / current blockers

- Full ESP32-S3-WROOM-1-N8/BME280/relay native schematic and PCB, fixture-specific ERC/DRC, manufacturing exports and assembly STEP.
- Native custom component creation/edit/export/reimport; personal library backup/restore; community component search with explicit redistribution-rights enforcement.
- ESPHome firmware compile, hardware behavior, upload, Device Builder handoff or Home Assistant changes.
- MCP SDK/current-spec implementation and real Codex/OpenAI or Claude/Anthropic client interoperability.
- Windows KiCad or ESPHome execution, Windows/Linux desktop packaging, Gerber-to-DXF accuracy, CNC coordinate/mirroring contract, Forge STEP orientation.

No system-wide dependencies were installed and no machine configuration changed. The KiCad/ESPHome proofs ran in disposable CI containers pinned to version and digest. The source checkout stays on the approved feature branch; there is no merge to `main`.

## Selected reference circuit candidates

The candidate set is TI TPS563201 regulator, Bosch BME280, Omron G5V-1 5 V relay, onsemi MMBT2222ALT1G driver, and onsemi MMSD4148T1G flyback diode. The exact source-backed values and unverified design checks are in [ESP32-REFERENCE-FIXTURE-COMPONENTS.md](../../docs/research/ESP32-REFERENCE-FIXTURE-COMPONENTS.md). They are not a production approval or evidence of a fully checked circuit. Relay contacts stay low-voltage DC; no mains is in scope.

## Proposed next milestone

Create the component-level native ESP32 fixture using official KiCad 10 symbol/pad mappings verified against manufacturer datasheets. Export and reimport a user-owned native library component. Run fixture ERC/DRC before using schematic-derived connectivity to generate ESPHome YAML. Retain exact tool output and unresolved electrical/layout findings; build the Electron shell only after this fixture path demonstrates the library and native-project lifecycle.

Owner decisions are listed in [the roadmap](../../docs/roadmap/PROTOTYPE-PLAN.md): approve Electron 45 or request a Tauri comparison, approve the candidate components for prototype placement (not manufacturing), confirm low-voltage-only relay scope, and select client versions for later MCP conformance tests.
