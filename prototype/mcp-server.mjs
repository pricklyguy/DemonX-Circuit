#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { realpath, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { deriveNets, pinId } = require(resolve(dirname(fileURLToPath(import.meta.url)), '../desktop/dist/schematic-model.js'));
const schematicAdapter = require(resolve(dirname(fileURLToPath(import.meta.url)), '../desktop/kicad-schematic-adapter.cjs'));
const MAX_TEXT = 50_000;
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const server = new McpServer({ name: 'demonx-circuit', version: '0.6.0' });

function projectArgument() {
  const index = process.argv.indexOf('--project-root');
  if (index < 0 || !process.argv[index + 1]) throw new Error('Project access was not authorized. Start the server with --project-root <project-folder> in the user-controlled MCP client configuration.');
  return process.argv[index + 1];
}
const authorizedRoot = await realpath(resolve(projectArgument()));
const manifestFile = await realpath(resolve(authorizedRoot, 'project.json'));
if (!manifestFile.startsWith(`${authorizedRoot}${sep}`)) throw new Error('The project manifest resolves outside the explicitly authorized project.');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
if (manifest.format !== 'demonx-project') throw new Error('The authorized folder does not contain a DemonX project manifest.');

async function safeProjectFile(rel) {
  if (typeof rel !== 'string' || !rel || isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error('Project metadata contains an unsafe path; access was refused.');
  const candidate = resolve(authorizedRoot, rel);
  const relativePath = relative(authorizedRoot, candidate);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) throw new Error('Project metadata points outside the authorized project; access was refused.');
  const actual = await realpath(candidate);
  if (!actual.startsWith(`${authorizedRoot}${sep}`)) throw new Error('A project symlink resolves outside the authorized project; access was refused.');
  return actual;
}
async function currentSchematicModel() {
  let directory;
  try { directory = await safeProjectFile('schematic-circuit/revisions'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const files = entries.filter(entry => entry.isFile() && /^\d{6}-.+\.json$/i.test(entry.name)).map(entry => entry.name).sort();
  if (!files.length) return null;
  const file = await safeProjectFile(`schematic-circuit/revisions/${files.at(-1)}`);
  const text = await readFile(file, 'utf8');
  if (Buffer.byteLength(text, 'utf8') > 2_000_000) throw new Error('Latest DemonX schematic model exceeds the MCP read limit.');
  const value = JSON.parse(text);
  if (value.format !== 'demonx-schematic' || value.formatVersion !== 1) throw new Error('Latest DemonX schematic model uses an unsupported format.');
  return value;
}
async function nativeRevisionSummary(model = null) {
  const schematicRel = (Array.isArray(manifest.native?.files) ? manifest.native.files : []).find(item => typeof item === 'string' && item.toLowerCase().endsWith('.kicad_sch'));
  if (!schematicRel) return { status: 'NOT_TESTED', sourceSha256: null, editorRevision: null, reason: 'No native schematic is listed in the project manifest.' };
  let file;
  try { file = await safeProjectFile(schematicRel); }
  catch (error) { if (error.code === 'ENOENT') return { status: 'NOT_TESTED', sourceSha256: null, editorRevision: null, reason: 'The native schematic is missing.' }; throw error; }
  const source = await readFile(file, 'utf8'); const sourceSha256 = schematicAdapter.digest(source);
  let revisions = [];
  try { revisions = await readdir(await safeProjectFile('schematic-circuit/revisions'), { withFileTypes: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const editorRevision = revisions.filter(entry => entry.isFile() && /^\d{6}-.+\.json$/i.test(entry.name)).map(entry => entry.name).sort().at(-1) || null;
  if (!model || !editorRevision) return { status: 'NOT_IMPORTED', sourceSha256, editorRevision, reason: 'No DemonX schematic revision is available.' };
  if (model.nativeSync?.sourceSha256 !== sourceSha256) return { status: 'EXTERNAL_CONFLICT', sourceSha256, editorRevision, reason: 'Native KiCad content changed since the editor model was imported.' };
  try {
    const nativeModel = schematicAdapter.importKiCadSchematic(source);
    const same = schematicAdapter.sameSemantic(model, nativeModel);
    return { status: same ? 'IN_SYNC' : 'UNSYNCHRONIZED', sourceSha256, editorRevision, reason: same ? 'Semantic model matches this exact native schematic SHA-256.' : 'Saved DemonX edits are not reflected in the native KiCad schematic.' };
  } catch (error) { return { status: 'UNSUPPORTED', sourceSha256, editorRevision, reason: error.message || String(error) }; }
}
async function listProjectFiles(directory, extensions, limit = 200) {
  let result = [];
  async function visit(relDir, depth) {
    if (depth > 5 || result.length >= limit) return;
    let entries;
    try { entries = await readdir(await safeProjectFile(relDir), { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) await visit(rel, depth + 1);
      else if (extensions.some(ext => entry.name.toLowerCase().endsWith(ext))) result.push(rel);
      if (result.length >= limit) break;
    }
  }
  await visit(directory, 0);
  return result;
}
function ok(data) { return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data }; }
function noData(message) { return { content: [{ type: 'text', text: message }] }; }

server.registerTool('project_info', { title: 'Project information', description: 'Read the manifest and safe native-file inventory for the one project explicitly authorized at MCP server startup. Does not execute native tools.', annotations: READ_ONLY }, async () => {
  const nativeFiles = [];
  for (const item of Array.isArray(manifest.native?.files) ? manifest.native.files : []) {
    try { await safeProjectFile(item); nativeFiles.push({ path: item, present: true }); }
    catch (error) { if (error.code === 'ENOENT') nativeFiles.push({ path: item, present: false }); else throw error; }
  }
  const model = await currentSchematicModel();
  const schematicRevision = await nativeRevisionSummary(model);
  return ok({ name: manifest.name || basename(authorizedRoot), projectId: manifest.projectId || null, revision: manifest.revision || null, formatVersion: manifest.formatVersion || null, native: { engine: manifest.native?.engine || null, engineVersion: manifest.native?.engineVersion || null, files: nativeFiles, schematicRevision }, authorization: 'One local project directory explicitly granted at server startup; no paths or commands are accepted from tool calls.' });
});

server.registerTool('list_components', { title: 'List schematic components', description: 'List component references, library IDs, values, and stable IDs from the saved DemonX schematic model. No component definitions or project files are modified.', annotations: READ_ONLY }, async () => {
  const model = await currentSchematicModel();
  if (!model) return noData('No saved DemonX schematic model exists in the authorized project.');
  return ok({ source: 'DemonX schematic model; not a native KiCad extraction', components: model.components.map(({ id, libId, reference, value, pins }) => ({ id, libId, reference, value, pinCount: pins.length })) });
});

server.registerTool('inspect_component_pins', { title: 'Inspect component pins', description: 'Read numbered pins and coordinates for a reference designator in the saved DemonX schematic model.', inputSchema: z.object({ reference: z.string().min(1).max(64).describe('Reference designator, such as R1 or U1.') }), annotations: READ_ONLY }, async ({ reference }) => {
  const model = await currentSchematicModel();
  if (!model) return noData('No saved DemonX schematic model exists in the authorized project.');
  const component = model.components.find(item => item.reference.toLowerCase() === reference.toLowerCase());
  if (!component) return noData(`No component ${reference} is present in the saved DemonX schematic model.`);
  return ok({ id: component.id, reference: component.reference, value: component.value, libraryId: component.libId, rotation: component.rotation, pins: component.pins.map(pin => ({ number: pin.number, name: pin.name, electricalType: pin.electricalType, gridPosition: { x: component.x + pin.x, y: component.y + pin.y } })) });
});

server.registerTool('list_electrical_nets', { title: 'List electrical nets', description: 'Derive pin connectivity from explicit wire endpoint IDs in the saved DemonX schematic graph. Visual line crossings never create electrical connections. This is model data, not a KiCad netlist or an ERC result.', annotations: READ_ONLY }, async () => {
  const model = await currentSchematicModel();
  if (!model) return noData('No saved DemonX schematic model exists in the authorized project.');
  return ok({ source: 'DemonX schematic graph; KiCad netlist equivalence has not been established for arbitrary projects', nets: deriveNets(model) });
});

server.registerTool('inspect_schematic_object', { title: 'Inspect schematic object', description: 'Look up a component, wire, junction, or net by stable object ID in the current saved DemonX schematic model. This does not expose arbitrary files.', inputSchema: z.object({ objectId: z.string().min(1).max(200).describe('Stable component, wire, or junction ID.') }), annotations: READ_ONLY }, async ({ objectId }) => {
  const model = await currentSchematicModel();
  if (!model) return noData('No saved DemonX schematic model exists in the authorized project.');
  const component = model.components.find(item => item.id === objectId);
  const wire = model.wires.find(item => item.id === objectId);
  const junction = model.junctions.find(item => item.id === objectId);
  const net = deriveNets(model).find(item => item.id === objectId);
  return ok({ object: component || wire || junction || net || null, selectedInUi: false, note: 'The MCP server is read-only and has no live selection bridge; objectId identifies the requested object.' });
});

server.registerTool('search_project_library', { title: 'Search project library', description: 'Search only the explicitly authorized project-owned symbol, footprint, and JSON component-library files. Community or global libraries are not searched.', inputSchema: z.object({ query: z.string().min(1).max(120).describe('Text to match in project library filenames or component records.') }), annotations: READ_ONLY }, async ({ query }) => {
  const matches = [];
  for (const rel of await listProjectFiles('libraries', ['.kicad_sym', '.kicad_mod', '.json'])) {
    const file = await safeProjectFile(rel);
    const contents = await readFile(file, 'utf8');
    if (Buffer.byteLength(contents, 'utf8') > 2_000_000) continue;
    if (`${rel}\n${contents}`.toLowerCase().includes(query.toLowerCase())) matches.push({ path: rel, filename: basename(rel), matchingText: contents.toLowerCase().includes(query.toLowerCase()) && !rel.toLowerCase().includes(query.toLowerCase()) ? contents.slice(Math.max(0, contents.toLowerCase().indexOf(query.toLowerCase()) - 120), contents.toLowerCase().indexOf(query.toLowerCase()) + query.length + 120).replace(/[\r\n]+/g, ' ').slice(0, 260) : undefined });
    if (matches.length >= 50) break;
  }
  return ok({ query, scope: 'authorized project libraries only', matches });
});

server.registerTool('list_verification_reports', { title: 'List ERC and DRC reports', description: 'Read existing KiCad ERC/DRC report files under the authorized project reports folder. Does not run KiCad and does not infer verification from a missing report.', inputSchema: z.object({ kind: z.enum(['ERC', 'DRC', 'all']).default('all').describe('Which existing report type to read.') }), annotations: READ_ONLY }, async ({ kind }) => {
  const reports = [];
  const current = await nativeRevisionSummary(await currentSchematicModel());
  const currentPcbRel = (Array.isArray(manifest.native?.files) ? manifest.native.files : []).find(item => typeof item === 'string' && item.toLowerCase().endsWith('.kicad_pcb'));
  let currentPcbSha256 = null;
  if (currentPcbRel) { try { currentPcbSha256 = schematicAdapter.digest(await readFile(await safeProjectFile(currentPcbRel))); } catch {} }
  for (const rel of await listProjectFiles('reports', ['.rpt'], 100)) {
    if (kind !== 'all' && !rel.toLowerCase().includes(kind.toLowerCase())) continue;
    const file = await safeProjectFile(rel), text = await readFile(file, 'utf8');
    const parent = rel.slice(0, rel.lastIndexOf('/'));
    let designRevision = null;
    try { designRevision = JSON.parse(await readFile(await safeProjectFile(`${parent}/design-revision.json`), 'utf8')); } catch {}
    const schematicHash = designRevision?.files?.schematic?.sha256;
    const pcbHash = designRevision?.files?.pcb?.sha256;
    const hasRevision = !!designRevision;
    const stale = hasRevision && ((schematicHash && current.sourceSha256 && schematicHash !== current.sourceSha256) || (pcbHash && currentPcbSha256 && pcbHash !== currentPcbSha256));
    reports.push({ path: rel, bytes: Buffer.byteLength(text, 'utf8'), excerpt: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT,
      revisionStatus: !hasRevision ? 'UNKNOWN' : stale ? 'STALE' : current.status === 'UNSYNCHRONIZED' || current.status === 'EXTERNAL_CONFLICT' ? 'STALE' : 'CURRENT',
      validatedSchematicSha256: schematicHash || null, currentSchematicSha256: current.sourceSha256 || null, validatedPcbSha256: pcbHash || null, currentPcbSha256 });
  }
  return ok({ kind, status: reports.length ? 'existing-reports-found' : 'no-report-found', reports });
});

server.registerTool('firmware_generation_info', { title: 'Firmware generation information', description: 'Read explicit firmware target, controller, and pin-map facts from the project manifest. Reports missing inputs as missing; it does not infer firmware behavior or generate YAML.', annotations: READ_ONLY }, async () => {
  const firmware = manifest.firmware || {};
  const hardware = manifest.hardware || {};
  const pinMap = hardware.pinMap && typeof hardware.pinMap === 'object' ? hardware.pinMap : null;
  return ok({ target: firmware.target || null, controller: hardware.controller || null, explicitPinMapPresent: !!pinMap && Object.keys(pinMap).length > 0, pinMap: pinMap || {}, capabilities: Array.isArray(firmware.capabilities) ? firmware.capabilities : [], status: firmware.target && pinMap ? 'inputs-recorded; compatibility still requires ESPHome validation' : 'missing-explicit-firmware-target-or-pin-map' });
});

const transport = new StdioServerTransport();
server.server.onerror = error => console.error('[DemonX Circuit MCP]', error.message);
await server.connect(transport);
console.error(`[DemonX Circuit MCP] Read-only project scope: ${authorizedRoot}`);
