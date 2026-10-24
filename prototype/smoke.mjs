#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const server = resolve(root, 'prototype/mcp-server.mjs');
const requests = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'circuit.inspect_project', arguments: {} } },
  { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'library.export_component', arguments: { id: 'DemonX_Local:Sensor_Header_1x04' } } },
  { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'firmware.generate_esphome', arguments: {} } },
  { jsonrpc: '2.0', id: 6, method: 'resources/read', params: { uri: 'demonx://project/esp32-sensor' } },
  { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'library.export_component', arguments: { id: 'not-a-supported-component' } } },
  { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'circuit.inspect_project', arguments: { unexpected: true } } },
  { jsonrpc: '2.0', id: 9, method: 'method/unsupported' }
];
const child = spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'inherit'] });
let stdout = '';
child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
child.stdin.end(`${requests.map(request => JSON.stringify(request)).join('\n')}\n`);
const code = await new Promise((resolveCode, reject) => {
  child.once('error', reject);
  child.once('close', resolveCode);
});
assert.equal(code, 0, 'MCP process exits cleanly');
const replies = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
assert.deepEqual(replies.map(reply => reply.id), requests.map(request => request.id));
assert.equal(replies[0].result.protocolVersion, '2025-11-25');
const available = replies[1].result.tools;
assert.equal(available.length, 3);
assert(available.every(tool => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint));
assert(available.every(tool => tool.inputSchema.type === 'object' && tool.inputSchema.additionalProperties === false));
const project = JSON.parse(replies[2].result.content[0].text);
assert.equal(project.projectId, 'dx-esp32-bme280-relay-demo');
assert.equal(project.hardware.nets.length, 9);
assert.equal(project.hardware.controller.model, 'ESP32-S3-WROOM-1-N8');
const component = JSON.parse(replies[3].result.content[0].text);
assert.equal(component.pins.length, 4);
const yaml = replies[4].result.content[0].text;
for (const expected of ['variant: esp32s3', 'sda: ${i2c_sda}', 'scl: ${i2c_scl}', 'pin: ${relay_gpio}', '!secret api_encryption_key', 'captive_portal:']) assert(yaml.includes(expected), `generated YAML includes ${expected}`);
assert.equal(JSON.parse(replies[5].result.contents[0].text).projectId, project.projectId);
assert.equal(replies[6].error.code, -32602, 'invalid component argument returns JSON-RPC error');
assert.equal(replies[7].error.code, -32602, 'unexpected tool argument returns JSON-RPC error');
assert.equal(replies.at(-1).error.code, -32601, 'unknown method returns method-not-found error');
console.log('MCP subset smoke passed: initialization, tool discovery/schema annotations, read-only inspect/export/generation, resource read, and invalid-argument/method errors.');
