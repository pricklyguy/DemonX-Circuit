#!/usr/bin/env node
// Minimal, dependency-free MCP stdio feasibility server. It exposes no write or deployment tool.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectPath = resolve(root, 'examples/esp32-sensor/project.json');
const componentPath = resolve(root, 'examples/libraries/DemonX_Local/Component_DX_Sensor_Header_1x04.json');
const protocolVersion = '2025-11-25';
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const tools = [
  { name: 'circuit.inspect_project', description: 'Read project components, pins, nets, and firmware requirements.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false } },
  { name: 'library.export_component', description: 'Return a portable copy of a user-owned component as JSON content.', inputSchema: { type: 'object', properties: { id: { type: 'string', const: 'DemonX_Local:Sensor_Header_1x04' } }, required: ['id'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false } },
  { name: 'firmware.generate_esphome', description: 'Return starter ESPHome YAML generated from the explicit fixture pin map. No files are written.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false } }
];

function yamlFrom(project) {
  const variant = project.hardware.controller.esphomeVariant;
  const pins = project.hardware.pinMap;
  const mapped = new Set(project.hardware.nets.flatMap(net => net.connections));
  for (const gpio of [pins.I2C_SDA, pins.I2C_SCL, pins.RELAY_DRIVER]) {
    if (!/^GPIO\d+$/.test(gpio ?? '') || !mapped.has(`U1.${gpio}`)) throw new Error(`Missing explicit GPIO connection: U1.${gpio}`);
  }
  return `substitutions:\n  device_name: dx-esp32-sensor\n  friendly_name: DemonX ESP32 Sensor\n  i2c_sda: ${pins.I2C_SDA}\n  i2c_scl: ${pins.I2C_SCL}\n  relay_gpio: ${pins.RELAY_DRIVER}\nesphome:\n  name: \${device_name}\n  friendly_name: \${friendly_name}\nesp32:\n  variant: ${variant}\n  framework:\n    type: arduino\nlogger:\napi:\n  encryption:\n    key: !secret api_encryption_key\nota:\n  - platform: esphome\n    password: !secret ota_password\nwifi:\n  ssid: !secret wifi_ssid\n  password: !secret wifi_password\n  ap:\n    ssid: \${friendly_name} Fallback\n    password: !secret fallback_ap_password\ncaptive_portal:\ni2c:\n  sda: \${i2c_sda}\n  scl: \${i2c_scl}\n  scan: true\nsensor:\n  - platform: bme280_i2c\n    address: 0x76\n    temperature:\n      name: "\${friendly_name} Temperature"\n    pressure:\n      name: "\${friendly_name} Pressure"\n    humidity:\n      name: "\${friendly_name} Humidity"\n    update_interval: 60s\nswitch:\n  - platform: gpio\n    name: "\${friendly_name} Relay"\n    pin: \${relay_gpio}\n    restore_mode: ALWAYS_OFF\n`;
}

async function callTool(name, args = {}) {
  if (name === 'circuit.inspect_project') return JSON.stringify(await readJson(projectPath), null, 2);
  if (name === 'library.export_component' && args.id === 'DemonX_Local:Sensor_Header_1x04') return JSON.stringify(await readJson(componentPath), null, 2);
  if (name === 'firmware.generate_esphome') return yamlFrom(await readJson(projectPath));
  throw new Error(`Unknown tool or invalid arguments: ${name}`);
}

async function respond(message) {
  if (!message || typeof message !== 'object' || typeof message.method !== 'string') return;
  const id = message.id;
  const send = result => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
  const fail = (code, text) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message: text } })}\n`);
  try {
    switch (message.method) {
      case 'initialize':
        send({ protocolVersion, capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'demonx-circuit-feasibility', version: '0.1.0' } }); break;
      case 'notifications/initialized': break;
      case 'ping': send({}); break;
      case 'tools/list': send({ tools }); break;
      case 'tools/call': {
        const args = message.params?.arguments ?? {};
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
        const name = message.params?.name;
        if (name === 'circuit.inspect_project' || name === 'firmware.generate_esphome') {
          if (Object.keys(args).length) throw new Error(`${name} accepts no arguments.`);
        } else if (name === 'library.export_component') {
          if (Object.keys(args).length !== 1 || args.id !== 'DemonX_Local:Sensor_Header_1x04') throw new Error('library.export_component requires the supported component id.');
        }
        const text = await callTool(name, args);
        send({ content: [{ type: 'text', text }], structuredContent: { text } }); break;
      }
      case 'resources/list':
        send({ resources: [{ uri: 'demonx://project/esp32-sensor', name: 'ESP32 sensor project manifest', mimeType: 'application/json' }, { uri: 'demonx://library/DemonX_Local:Sensor_Header_1x04', name: 'Custom sensor header component', mimeType: 'application/json' }] }); break;
      case 'resources/read': {
        const uri = message.params?.uri;
        const path = uri === 'demonx://project/esp32-sensor' ? projectPath : uri === 'demonx://library/DemonX_Local:Sensor_Header_1x04' ? componentPath : null;
        if (!path) throw new Error(`Unknown resource: ${uri}`);
        send({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(await readJson(path), null, 2) }] }); break;
      }
      default: if (id !== undefined) fail(-32601, `Method not found: ${message.method}`);
    }
  } catch (error) { fail(-32602, error.message); }
}

let buffer = '';
for await (const chunk of process.stdin) {
  buffer += chunk.toString('utf8');
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
    if (line) { try { await respond(JSON.parse(line)); } catch (error) { process.stderr.write(`${error.message}\n`); } }
  }
}
