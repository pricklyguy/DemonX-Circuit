# DemonX Circuit — Checkpoint 1 Results

Date: 2026-10-23; branch: `codex/demonx-circuit-foundation`
Remote: `origin` → `https://github.com/pricklyguy/DemonX-Circuit.git`

## Decision

Continue with a DemonX-owned workflow, portable manifest and adapter around a separately installed KiCad CLI, with LibrePCB 2.1.1 kept as a serious comparison candidate. Do not fork KiCad or build an EDA canvas in the next milestone. This is a research-backed provisional selection; local checks have not yet validated a native EDA workflow.

## Test evidence

| Check | Result | Evidence / limitation |
|---|---|---|
| Branch and repository isolation | PASS | Current branch is `codex/demonx-circuit-foundation`; remote URL is the expected empty `DemonX-Circuit` repository. No other DemonX repo was edited. |
| Node runtime | PASS | `node --version` → `v24.19.0`; prototype uses no npm packages. |
| Python runtime | PASS | Bundled Python → `3.12.14`; Python import checks report `esphome: None`, `yaml: None`. |
| Node syntax | PASS | `node --check` passed for `prototype/mcp-server.mjs`, `prototype/generate-esphome.mjs`, and `prototype/smoke.mjs`. |
| MCP subset smoke | PASS | `node prototype/smoke.mjs`: initialization, tool discovery/schema annotations, read-only project inspection/component export/firmware preview, resource read, invalid argument (`-32602`) and unknown method (`-32601`) errors. This is only the declared 2025-11-25 subset, not named-client or 2026-07-28 conformance. |
| ESPHome starter generation | PASS, generator only | Created YAML with `esp32.variant: esp32s3`, GPIO8 SDA, GPIO9 SCL, GPIO10 relay driver, secret references, API encryption, OTA, fallback AP and captive portal. The input is a logical pin map, not an EDA netlist. |
| Overwrite protections | PASS | Existing-output attempt was refused and SHA-256 remained `9CBE40E50B0D71DA41D52335B02695A779D564BFD3EF9472ADCFCC39E79BBD97`. `--force` created a non-overwriting `.bak`; typing `NO` declined replacement and the same hash remained. |
| YAML parse / ESPHome config / compile | NOT TESTED | `esphome` and `yaml` modules are absent. No validity or compilation claim is made. |
| KiCad version / ERC / DRC | NOT TESTED | `kicad-cli` is absent and no `.kicad_pro`, `.kicad_sch` or `.kicad_pcb` exists. |
| Gerber X2 / Excellon / STEP | NOT TESTED | No native board exists and the KiCad CLI is absent. |
| Native library export/import | NOT TESTED | The included DemonX JSON part is a schema-only metadata example that references an upstream footprint; it has not been loaded by any EDA engine. |
| Linux portability | NOT TESTED | Only Windows Node.js smoke tests ran. |
| Forge / CNC downstream handoff | NOT TESTED | No generated geometry was available to inspect in Forge or CNC. The converter limitations remain documented in `docs/architecture/DEMONX-SUITE-HANDOFFS.md`. |

## Reference hardware scope

The manifest describes an ESP32-S3-WROOM-1-N8, bare BME280 on I²C address 0x76, and an Omron G5V-1 DC5 low-voltage relay driven by a low-side transistor/MOSFET concept. GPIO8/9/10 are an explicitly selected firmware example map, not discovered from a verified schematic. A 5V DC input and 3.3V regulator are design intent only. Exact regulator, driver, resistor, diode, footprints, power margins, and routing remain open. Mains routing is excluded. Datasheet references are in `docs/architecture/ESPHOME-HA-INTEGRATION.md`.

## Blockers and risks

1. KiCad 10.0.7 and ESPHome 2026.10.0 are not installed. No native project or real ERC/DRC, fabrication, STEP or ESPHome validation evidence exists.
2. The first reference board needs a datasheet-backed power and relay-driver design, exact symbols/footprints, license/provenance records and successful native checks.
3. The MCP server is a hand-written, read-only subset for a historical protocol revision. It must not be marketed as OpenAI/Codex or Anthropic/Claude interoperability; use a pinned SDK and test named clients before that claim.
4. The local component JSON has not been round-tripped through an EDA library. Custom-library ownership is a product principle but is not yet proven by the prototype.
5. Gerber-to-DXF, CNC alignment, Forge STEP orientation and board envelope remain unverified.

## Proposed phases

1. **Native fixture feasibility:** pin/provision KiCad 10.0.7 and ESPHome 2026.10.0 on Windows and Linux; create the licensed ESP32-S3 + BME280 + low-voltage relay schematic and PCB; run and inspect ERC/DRC, Gerber X2, Excellon, STEP, reopen and library round-trip; run `esphome config` and compile where toolchains allow.
2. **Engine adapter and project package:** versioned manifest/schema, native-engine preflight, safe staging, validation, approval, rollback, report capture and LibrePCB comparison.
3. **Production MCP and AI review:** use a pinned official SDK, read-only project/net/geometry/library views, named-client testing, sourced suggestions and permission separation.
4. **Manufacturing and handoffs:** verify units/origins/mirroring, converter geometry and Forge board/STEP orientation before automating CNC or enclosure operations.
5. **Firmware workflow:** board-derived pin metadata, configurable ESPHome template, official CLI validation, optional approved Device Builder handoff, and later HA onboarding.

## Exact next milestone

Complete the **native fixture feasibility run** before any GUI architecture work: provide the local KiCad 10.0.7 and ESPHome 2026.10.0 toolchains (or a reproducible CI runner), then create and verify the native reference project and capture actual reports/exports. The current environment has no KiCad or ESPHome and no remote Linux execution path, so this milestone is not complete here.

## Owner decisions still open

- Whether supported product users must install KiCad, or whether future bundling is worth legal review.
- Exact regulator and relay driver implementation after the native reference schematic is reviewed.
- Which OpenAI/Codex and Anthropic/Claude client versions are formal MCP release targets.
- Whether community-library distribution accepts only assets with explicit redistribution rights (recommended).

The user has authorized the provisional KiCad CLI direction and ESP32-S3 fixture target. No GUI has been started, nothing has been merged to `main`, and no device or external Home Assistant instance was modified.
