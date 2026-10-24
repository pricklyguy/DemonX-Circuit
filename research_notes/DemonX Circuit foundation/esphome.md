# ESPHome and Home Assistant integration research

**Checked:** 2026-10-23 (America/Phoenix). Sources below are official project documentation, release metadata, or upstream source repositories. “Current” means the latest stable release available on the check date.

## Current versions and support status

| Project/surface | Version on 2026-10-23 | Evidence and implications |
|---|---:|---|
| ESPHome firmware generator and CLI | **2026.10.0**, released 2026-10-21 | [Official release notes](https://esphome.io/changelog/2026.10.0/) and [signed GitHub release](https://github.com/esphome/esphome/releases/tag/2026.10.0). Pin this version for reproducible prototype validation/builds; do not use floating `latest` in CI. |
| ESPHome Device Builder dashboard | **1.25.0 bundled** by ESPHome 2026.10.0 | Upstream ESPHome release notes list the bundled Device Builder bump to 1.25.0; the [Device Builder repository](https://github.com/esphome/device-builder) states the dashboard is stable (1.0+) and default in the official add-on/container since ESPHome 2026.6.0. The dashboard package is versioned independently of ESPHome core. |
| ESPHome Home Assistant app/add-on | **2026.10.0** | [Official add-on release](https://github.com/esphome/home-assistant-addon/releases/tag/2026.10.0), released 2026-10-21. The current app bundles the Builder. |
| Home Assistant Core | **2026.10.0** | [Official Core 2026.10 release notes](https://www.home-assistant.io/blog/2026/10/07/release-202610/) and [full changelog](https://www.home-assistant.io/changelogs/core-2026.10/). Current Home Assistant integration pages document current native API discovery/setup behavior. |
| ESPHome Native API client library | **aioesphomeapi 46.4.0** in ESPHome 2026.10.0 | Listed in the [ESPHome 2026.10.0 changelog](https://esphome.io/changelog/2026.10.0/). It is an implementation dependency, not a supported public API for DemonX to mutate a device. |

ESPHome documents Windows 10/11 desktop support and supports Linux through the native Python/container and Home Assistant paths. The [official install page](https://esphome.io/install/) offers desktop, Device Builder, pip/CLI, Home Assistant app, and Docker setup. Its pip instructions require Python 3.12+; ESPHome 2026.7 removed the legacy Tornado dashboard from bare pip installs. Run `esphome-device-builder` for the UI or use the CLI directly. Linux serial access may require device permissions; container USB access requires passing the serial device through. On Docker Desktop, host networking/mDNS may be unavailable, so use explicit device IP/port when needed.

## Device Builder, CLI, and automation contract

The Device Builder is the practical user interface for configuration composition, component/board discovery, automations, firmware compilation, and installation. The 2026.5 preview release introduced a stable **backend helper API surface** to support the Builder, with documented contracts such as file-writing helpers; this is a Python extension surface for the Builder ecosystem, not a general remote REST/JSON API for external products. The [upstream repository README](https://github.com/esphome/device-builder) documents installation and marks the Builder stable. Its main backend/frontend source is [esphome/device-builder](https://github.com/esphome/device-builder) and [esphome/device-builder-frontend](https://github.com/esphome/device-builder-frontend).

For Circuit, prefer a version-pinned, isolated ESPHome CLI process over depending on Builder internals:

1. Generate a project-owned YAML and local includes/secrets in a staging directory. Keep a copy and hash of the prior output; never silently overwrite a user file.
2. Run `esphome version` and require the supported pinned tool version or an explicit compatibility profile.
3. Run `esphome config <staged.yaml>` for schema validation. This resolves substitutions, packages/includes and schema defaults; use default redaction and never request `--show-secrets`. The CLI reports validation, but this does not prove electrical correctness or sensor suitability.
4. Run `esphome compile <staged.yaml>` as the stronger check; it validates and compiles for the selected toolchain/board. Save exact tool version, platform/toolchain, output, and compiler diagnostics with the project.
5. Offer a human-visible diff, then atomically promote the validated file only after approval. Keep rollback copy and provenance. Build from the approved project configuration.
6. Export/download YAML first. Upload is a separate action requiring explicit user approval, a selected target, and confirmation of the connection path.

The official [CLI guide](https://esphome.io/guides/cli/) defines `config`, `compile`, `upload`, and `run`. `config` validates schema; `compile` validates and compiles; `upload` uploads the most recent firmware build. `upload --device` accepts a serial port or IP (or `OTA` for discovery); the CLI supports native ESPHome OTA and `web_server` OTA, preferring native OTA when both are configured. `run` combines build/upload and is therefore unsuitable for an implicit “validate” button. Do not invoke shell strings assembled from project/user data; pass argv directly, use timeouts, isolate working dirs, constrain external components/network, and capture exit code/stdout/stderr.

The `esphome bundle` command can package main YAML, local include files, referenced secrets, fonts/images, certificates, local external components, and other dependencies. Remote git components/resources are not included and may be fetched at build time. Do not export bundles by default if they include credentials/certificates; warn and let the user select contents. Secret values are redacted by CLI output unless explicitly asked to show them.

### Supported ESPHome configuration options to expose

- `substitutions` are expanded before configuration validation and support reusable templates. [Docs](https://esphome.io/components/substitutions/)
- `packages` support local `!include` and remote Git packages. Remote dependencies can change independently, cannot use secret lookups inside the remote file, and are a reproducibility/supply-chain risk; pin tags/commits and record resolved revisions. [Docs](https://esphome.io/components/packages/)
- `api.encryption.key` provides the preferred encrypted Home Assistant native API channel. Generate and store secrets locally (or leave secure secret input to user); never put secrets in AI prompts, logs, screenshots, public project manifests, or shared component libraries. [Native API docs](https://esphome.io/components/api/)
- `ota` should use the current list syntax with `- platform: esphome`. ESPHome recommends reusing native API encryption for encrypted OTA where applicable. OTA is a dangerous side effect and must be a separate approval. ESPHome documents safe mode, rollback caveats, and a special bootloader/partition update soft-brick risk. [OTA docs](https://esphome.io/components/ota/esphome/) and [security guidance](https://esphome.io/guides/security_best_practices/).
- `wifi.ap` plus `captive_portal:` can provide recovery provisioning; `web_server:` is optional and adds an HTTP management surface, so do not add it automatically. Let the user configure whether fallback AP/captive portal and web server are needed. [Captive portal docs](https://esphome.io/components/captive_portal/), [Web server docs](https://esphome.io/components/web_server/).

The Generator must make missing engineering decisions explicit. A schematic may establish nets and attached components, but often omits sensor model/configuration, behavior, naming, units, update interval, calibration, thresholds, Wi-Fi credentials, fallback/AP policy, entity exposure, and API/OTA choice. Generate marked TODOs/placeholders or ask the user; do not infer active-high/low relay semantics, analog scaling, safe output states, or sensor characteristics from GPIO connectivity alone.

## ESP32 support and pin-map safety

“ESP32” is not one pin model. ESPHome’s [ESP32 platform configuration](https://esphome.io/components/esp32/) accepts a chip `variant` and/or legacy PlatformIO board ID; variant is now recommended. The chosen chip must match the real silicon or firmware may fail to flash. Module/board designs can consume pins for flash, PSRAM, USB, boot straps, LEDs, boot/reset buttons, or on-board peripherals. Use the exact PCB/board revision and schematic/netlist to produce a board-specific pin map; do not infer GPIO availability from a generic ESP32 list.

For the original ESP32, Espressif’s [ESP Hardware Design Guidelines schematic checklist](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32/schematic-checklist.html) says GPIO0, GPIO2, GPIO5, MTDI/GPIO12 and MTDO/GPIO15 are boot strapping pins; states at reset affect boot configuration. GPIO34 and above are input-only and lack internal pull-ups/pull-downs. Avoid flash/PSRAM-connected pins. The same source warns ADC2 cannot be used with Wi-Fi enabled and recommends ADC1. These are chip-specific facts, not rules to apply blindly to ESP32-C3/S3/C6 etc.; resolve against the particular chip’s current official datasheet and board schematic.

For an ESP32-DevKitC V4 reference design, use Espressif’s [official board guide/pin tables](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html), not a generic pinout graphic. It identifies GPIO39/VN as input-only, ADC1_CH3. The official board reference identifies module flash-connected pads and board variations. A mapping database should contain provenance per pin: MCU variant, module, board/revision, role, direction, peripheral function, restrictions (strap, input-only, ADC1/2, boot, flash/PSRAM, USB, reserved), source URL/revision and confidence. Unknown board means warn and ask, never mark pins “safe” based on a chip-only table.

Suggested firmware-check diagnostics:

- Validate YAML/schema against pinned ESPHome, then compile against exact variant/toolchain.
- Check every assigned GPIO exists on selected silicon and is exposed/available on selected PCB; flag reserved/shared, input-only used as output, strap/boot sensitive, and ADC2 + Wi-Fi conflicts.
- Validate bus topology and shared pins: I2C SDA/SCL and pull-ups/voltage, SPI bus and chip select, UART TX/RX direction, address conflicts if modeled.
- Compare component datasheet electrical limits (logic voltage, power, ADC input range/divider, current, pull-ups, relay driver/isolation) to the netlist and component values. This is separate from ESPHome's syntax validation and must show source/evidence and uncertainty.

## Home Assistant integration options

### Supported core path: ESPHome Native API

ESPHome’s native API is a persistent, bi-directional TCP API (default TCP port **6053**) intended for low-latency device/entity integration, with optional Noise PSK encryption. Home Assistant discovers devices through mDNS and the user can add the built-in ESPHome integration in Settings > Devices & services; manual setup asks for host, port and Noise PSK. Entities exposed in HA depend on the ESPHome components in the firmware. Home Assistant controls which ESPHome actions/log subscriptions are enabled per integration entry. Sources: [ESPHome integration documentation](https://www.home-assistant.io/integrations/esphome), [ESPHome Native API component](https://esphome.io/components/api/), and the upstream [aioesphomeapi client](https://github.com/esphome/aioesphomeapi).

DemonX should generate YAML and then show the user the standard HA discovery/setup instructions. Later, an optional HA integration could import DemonX project metadata and surface project links, board pin assignments, and firmware build metadata; it should use HA’s config flow and documented integration conventions. Do not reimplement the ESPHome native API or use HA internals to insert integrations/entries. There is no documented supported public endpoint for another app to silently create an ESPHome integration config entry; leave pairing to the user or a future reviewed, versioned official integration feature.

### Optional HA-side companion

If a companion is justified, use a small, optional custom integration (or submit upstream if broad utility). A narrowly scoped integration could expose a “DemonX Circuit project” device/diagnostic entity, carry a project ID/revision and link to native files, and optionally report a user-selected compile artifact. It must not contain the CAD/EDA engine, control the ESP pins, deploy firmware automatically, or store unrelated secrets. Follow [Home Assistant integration developer documentation](https://developers.home-assistant.io/docs/creating_integration_manifest/) and [config flow documentation](https://developers.home-assistant.io/docs/config_entries_config_flow_handler/); provide unique IDs, config entry reauth/removal, diagnostics with redaction, async I/O, translations, and tests if/when implementation begins.

Home Assistant’s supported REST API is for simple HTTP requests; WebSocket is intended for long-lived subscriptions. Both require authorization. [HA REST API contributor docs](https://developers.home-assistant.io/docs/api/rest/) describe token authentication and recommend WebSocket for live connections. The [HTTP integration/API docs](https://www.home-assistant.io/integrations/http/) describe REST/WS APIs. These APIs are not a supported route to install firmware or create an ESPHome config entry. Avoid long-lived access tokens in DemonX where possible. If implementing sign-in, use the [Home Assistant auth API/OAuth flow](https://developers.home-assistant.io/docs/auth_api/) and request the minimum access needed.

Home Assistant itself now also offers an optional [Model Context Protocol Server integration](https://www.home-assistant.io/integrations/mcp_server/), endpoint `/api/mcp`, supporting OAuth 2.0 PKCE and selected LLM APIs/entities. This provides HA automation/entity tools to compatible agents; it is not an ESPHome firmware-generation interface and does not replace DemonX Circuit’s own MCP tools. Users should explicitly choose which HA entities/actions to expose. Cloud MCP clients require remote reachability to HA, which is a separate deployment/privacy decision.

## Recommended staged workflow and safety gates

**Phase A — download-only prototype:** From a saved schematic/explicit board pin-map, generate a starter file in project staging. Put configuration choices in substitutions and user-owned include/package templates. Add no Wi-Fi/API/OTA secrets. Emit comments identifying assumptions, missing info, component data sources, chosen ESPHome version, board/variant, and project revision. Run `esphome config`, then (where available) `esphome compile`; show errors/warnings and allow download of `.yaml` plus a readable manifest. A successful compile means toolchain acceptance, not a certified design.

**Phase B — checked integration:** Let the user select a compatible installed ESPHome CLI/Builder or Docker runtime, verify its exact version, and validate/compile locally. Keep Device Builder/native YAML editable; use its UI through user action rather than undocumented backend HTTP calls. Never store credentials in the manifest. Keep output diff, source hash and rollback file.

**Phase C — approved target deployment:** User chooses serial/USB or a named/discovered network device and sees target identity, board/profile, configuration diff, firmware hash, OTA route, security state and recovery caveats. Require explicit final confirmation before `upload`/`run`; do not upload automatically after compile. Back up current YAML/build metadata and offer a recovery path. Treat OTA bootloader/partition options as expert-only with additional warning and explicit approval.

**Phase D — Home Assistant handoff:** After a user-installed firmware publishes native API (and mDNS/network allow it), guide them to HA discovery or manual setup; provide hostname/IP, default port 6053, and instructions to retrieve the locally stored Noise key if configured. Do not send or retrieve HA credentials implicitly. Companion integration remains optional and separate from basic generated YAML.

## Constraints and findings

- ESPHome’s YAML schema knows ESPHome keys/components and type constraints, not whether the physical circuit is wired correctly, a pin is safe on the actual board, a sensor has the assumed address, a voltage divider is correct, a relay load is safe, or generated firmware is functionally suitable.
- A compile depends on toolchains, package downloads, component versions and network conditions. Pin exact ESPHome core versions and known toolchain/board profile; record external component revisions and warn if builds require remote dependencies.
- Device Builder is stable and useful for human authoring, but a UI/API dependency would couple DemonX to its independently versioned releases. Use the CLI as the supported automation boundary; re-check it each ESPHome release.
- Home Assistant API tokens are high-impact. Prefer local YAML download and documented user setup. Any future HA connection should use OAuth and scope/consent rather than asking for a long-lived token.
- Never claim generated firmware as electrically verified. Show AI and rule-based findings as recommendations with evidence, not certification.

## Primary references (checked 2026-10-23)

- ESPHome install and platform paths: https://esphome.io/install/
- ESPHome 2026.10.0 changelog/release: https://esphome.io/changelog/2026.10.0/ ; https://github.com/esphome/esphome/releases/tag/2026.10.0
- ESPHome CLI command semantics: https://esphome.io/guides/cli/
- Device Builder project/status/source: https://github.com/esphome/device-builder ; https://github.com/esphome/device-builder-frontend
- ESPHome add-on release: https://github.com/esphome/home-assistant-addon/releases/tag/2026.10.0
- ESPHome config/packages/substitutions: https://esphome.io/components/substitutions/ ; https://esphome.io/components/packages/
- ESPHome API/OTA: https://esphome.io/components/api/ ; https://esphome.io/components/ota/esphome/
- HA ESPHome integration: https://www.home-assistant.io/integrations/esphome
- HA developer integration/config entries: https://developers.home-assistant.io/docs/creating_integration_manifest/ ; https://developers.home-assistant.io/docs/config_entries_config_flow_handler/
- HA APIs/auth: https://developers.home-assistant.io/docs/api/rest/ ; https://developers.home-assistant.io/docs/api/websocket/ ; https://developers.home-assistant.io/docs/auth_api/
- HA MCP server: https://www.home-assistant.io/integrations/mcp_server/
- Espressif ESP32 pin/hardware constraints: https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32/schematic-checklist.html ; https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html
