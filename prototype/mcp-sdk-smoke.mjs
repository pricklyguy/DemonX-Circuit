import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await mkdtemp(join(tmpdir(), 'demonx-circuit-mcp-'));
const project = join(tempRoot, 'Owner Authorized Project');
await mkdir(join(project, 'schematic-circuit', 'revisions'), { recursive: true });
await mkdir(join(project, 'libraries', 'DemonX_User.pretty'), { recursive: true });
await mkdir(join(project, 'reports'), { recursive: true });
await writeFile(join(project, 'project.json'), JSON.stringify({ format: 'demonx-project', formatVersion: '0.2.0', name: 'MCP test', projectId: 'mcp-fixture', revision: 'test', native: { engine: 'kicad', engineVersion: '10.0.7', files: [] }, hardware: { controller: { model: 'ESP32-S3-WROOM-1-N8' }, pinMap: { SDA: 'GPIO8' } }, firmware: { target: 'esphome' } }), { flag: 'wx' });
await copyFile(resolve(root, 'examples/native-smoke/led-resistor.dxcircuit.json'), join(project, 'schematic-circuit/revisions/000001-starter.json'));
await writeFile(join(project, 'libraries', 'DemonX_User.pretty', 'DX_User_Header_1x02.kicad_mod'), '(footprint "DX_User_Header_1x02")\n', { flag: 'wx' });

const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(root, 'prototype/mcp-server.mjs'), '--project-root', project], cwd: root, stderr: 'pipe' });
const client = new Client({ name: 'demonx-circuit-sdk-smoke', version: '1.0.0' }, { capabilities: {} });
try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map(tool => tool.name);
  assert.deepEqual(names, ['project_info', 'list_components', 'inspect_component_pins', 'list_electrical_nets', 'inspect_schematic_object', 'search_project_library', 'list_verification_reports', 'firmware_generation_info']);
  assert.ok(listed.tools.every(tool => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false), 'every advertised tool is marked read-only and non-destructive');
  const info = await client.callTool({ name: 'project_info', arguments: {} });
  assert.equal(info.structuredContent.projectId, 'mcp-fixture');
  const components = await client.callTool({ name: 'list_components', arguments: {} });
  assert.equal(components.structuredContent.components.length, 3);
  const pins = await client.callTool({ name: 'inspect_component_pins', arguments: { reference: 'R1' } });
  assert.equal(pins.structuredContent.pins.length, 2);
  const nets = await client.callTool({ name: 'list_electrical_nets', arguments: {} });
  assert.equal(nets.structuredContent.nets.length, 3);
  assert.match(nets.structuredContent.source, /not been established for arbitrary projects/i);
  const objects = await client.callTool({ name: 'inspect_schematic_object', arguments: { objectId: 'component-resistor-01' } });
  assert.equal(objects.structuredContent.object.reference, 'R1');
  assert.equal(objects.structuredContent.selectedInUi, false);
  const library = await client.callTool({ name: 'search_project_library', arguments: { query: 'DX_User_Header' } });
  assert.equal(library.structuredContent.matches.length, 1);
  const firmware = await client.callTool({ name: 'firmware_generation_info', arguments: {} });
  assert.equal(firmware.structuredContent.status, 'inputs-recorded; compatibility still requires ESPHome validation');
  assert.ok(!names.some(name => /write|edit|delete|run_command|shell/i.test(name)), 'the SDK server exposes no mutation or arbitrary process tool');
  console.log('PASS: official MCP TypeScript SDK 2.4.0 stdio client negotiated, enumerated eight read-only tools, inspected an explicitly authorized project, and returned component, pin, net, library, object, and firmware data.');
} finally {
  await client.close().catch(() => {});
  await transport.close().catch(() => {});
  await rm(tempRoot, { recursive: true, force: true });
}
