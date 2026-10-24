# Feasibility prototype

This small Node.js prototype exercises portable project metadata, an owner-controlled component record, a read-only MCP stdio surface, and ESPHome YAML generation from an explicit logical ESP32-S3-WROOM-1-N8 pin map. It is not a native schematic or PCB and does not establish hardware correctness.

Run `node prototype/generate-esphome.mjs` from any directory to create `examples/esp32-sensor/esphome.yaml`. The explicit example map is GPIO8 SDA, GPIO9 SCL, GPIO10 relay driver; it is not validated against a native schematic. Existing files are refused by default. With `--force`, the generator creates a non-overwriting `.bak` copy, displays old and proposed YAML, and requires typing `REPLACE` before writing. The sample secrets file contains placeholders only; real secrets belong outside version control.

Run `node prototype/mcp-server.mjs` as an MCP stdio server. It implements a narrow 2025-11-25 initialize/tools/resources request subset: initialize, tools/list, tools/call, resources/list, and resources/read. `node prototype/smoke.mjs` exercises initialization, advertised schema annotations, read-only tool/resource calls and invalid-argument errors. This is not latest-revision or Codex/Claude client conformance. Its tools only return data; they cannot edit project files or deploy firmware.

The JSON manifest is not a KiCad schematic or PCB, and it does not provide electrical verification. The intended design calls for a 5V DC input, regulated 3.3V rail, bare BME280 I2C sensor, and Omron G5V-1 DC5 relay with a low-side driver and flyback suppression; exact driver/passive values and schematic are not yet designed. Relay contacts are low-voltage DC only; no mains routing is in scope.

## Reproducible feasibility commands

- Runtime: Node.js 24.x (`node --version`); no npm packages are required.
- KiCad: install the pinned 10.0.7 stable release from the [official downloads](https://www.kicad.org/download/), then run `kicad-cli version`.
- ESPHome: use Python 3.12+ and an isolated virtual environment, then `python -m pip install esphome==2026.10.0`; verify `esphome version`.
- Run `node --check prototype/generate-esphome.mjs`, `node --check prototype/mcp-server.mjs`, `node --check prototype/smoke.mjs`, and `node prototype/smoke.mjs`.
- Regenerate into a new path with `node prototype/generate-esphome.mjs C:\\temp\\dx-sensor.yaml`; validate only after providing a local secrets file with `esphome config C:\\temp\\dx-sensor.yaml`.
- The current environment has no KiCad CLI or ESPHome CLI and the fixture has no native `.kicad_pro`, `.kicad_sch`, or `.kicad_pcb` files. Therefore there are no valid ERC/DRC, Gerber/Excellon, or STEP commands to run yet. Do not manufacture or flash from this fixture.

Windows and Linux runs should use the same pinned native CLI versions and compare recorded output hashes/reports. At this checkpoint, only Windows Node.js smoke testing was available; Linux portability is not yet tested.
