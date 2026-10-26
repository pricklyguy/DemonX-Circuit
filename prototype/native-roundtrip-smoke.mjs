import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const adapter = require(resolve('desktop', 'kicad-schematic-adapter.cjs'));
const sourceDirectory = process.env.DEMONX_NATIVE_SMOKE_FIXTURE || resolve('examples', 'native-smoke', 'DX_LED_Smoke');
const sourcePath = resolve(sourceDirectory, 'DX_LED_Smoke.kicad_sch');
const originalText = await readFile(sourcePath, 'utf8');
const sourceHash = adapter.digest(originalText);
const imported = adapter.importKiCadSchematic(originalText);
const componentSummary = imported.components.map(({ reference, libId, value, x, y, rotation }) => [reference, libId, value, x, y, rotation]).sort((a, b) => a[0].localeCompare(b[0]));
assert.deepEqual(componentSummary, [
  ['D1', 'Device:LED', 'RED LED', 60, 40, 0],
  ['J1', 'Connector_Generic:Conn_01x02', '5V INPUT', 40, 40, 0],
  ['R1', 'Device:R', '330', 50, 40, 0],
]);
assert.equal(imported.wires.length, 3);
assert.deepEqual(adapter.netGroups(imported), [['D1.1', 'R1.2'], ['D1.2', 'J1.2'], ['J1.1', 'R1.1']]);
assert.equal(imported.nativeSync.sourceSha256, sourceHash);

const edited = structuredClone(imported);
const resistor = edited.components.find(component => component.reference === 'R1');
const pinNode = (reference, pinNumber) => `pin:${edited.components.find(component => component.reference === reference).id}:${pinNumber}`;
resistor.value = '470';
resistor.x = 52;
resistor.rotation = 90;
const j1Pin1 = pinNode('J1', '1');
const r1Pin1 = pinNode('R1', '1');
const r1Pin2 = pinNode('R1', '2');
const d1Pin1 = pinNode('D1', '1');
const inputWire = edited.wires.find(wire => [wire.fromNodeId, wire.toNodeId].includes(j1Pin1) && [wire.fromNodeId, wire.toNodeId].includes(r1Pin1));
const ledWire = edited.wires.find(wire => [wire.fromNodeId, wire.toNodeId].includes(d1Pin1) && [wire.fromNodeId, wire.toNodeId].includes(r1Pin2));
assert.ok(inputWire && ledWire, 'fixture connectivity resolves by pin identity independent of native wire ordering');
if (inputWire.fromNodeId === r1Pin1) inputWire.fromNodeId = r1Pin2; else inputWire.toNodeId = r1Pin2;
if (ledWire.fromNodeId === r1Pin2) ledWire.fromNodeId = r1Pin1; else ledWire.toNodeId = r1Pin1;
const candidate = adapter.exportKiCadCandidate(originalText, edited);
assert.notEqual(candidate.sha256, sourceHash);
const resistorNativePlacement = candidate.text.match(/\(symbol\s+\(lib_id "Device:R"\)\s+\(at [^)]+\)/s)?.[0];
assert.match(resistorNativePlacement || '', /\(at [\d.]+ [\d.]+ 270\)/, 'semantic clockwise 90-degree rotation is serialized using KiCad native orientation');
assert.equal(adapter.sameSemantic(edited, candidate.imported), true, 'native export and reimport preserve edited semantic state');
assert.deepEqual(adapter.netGroups(candidate.imported), [['D1.1', 'R1.1'], ['D1.2', 'J1.2'], ['J1.1', 'R1.2']], 'rewiring changes real pin-to-net topology');
assert.equal(adapter.digest(await readFile(sourcePath, 'utf8')), sourceHash, 'native source remains untouched by staging');

const disconnected = structuredClone(edited);
disconnected.wires = disconnected.wires.slice(1);
const invalidCandidate = adapter.exportKiCadCandidate(originalText, disconnected);
assert.equal(adapter.sameSemantic(disconnected, invalidCandidate.imported), true, 'disconnected semantic edit can be staged for native ERC rejection');

let refused = false;
const rootClose = originalText.trimEnd().lastIndexOf(')');
const unsupportedText = `${originalText.trimEnd().slice(0, rootClose)} (no_connect (at 1 2) (uuid "00000000-0000-4000-8000-000000000000")) ${originalText.trimEnd().slice(rootClose)}`;
try { adapter.importKiCadSchematic(unsupportedText); }
catch (error) { refused = /Unsupported native KiCad construct “no_connect”/.test(error.message); }
assert.equal(refused, true, 'unsupported electrical constructs are explicitly refused');

const offGrid = structuredClone(imported);
offGrid.components.find(component => component.reference === 'R1').x += 0.25;
assert.throws(() => adapter.exportKiCadCandidate(originalText, offGrid), /50 mil grid|grid/i, 'off-grid edit is refused rather than rounded into a lossy export');

console.log(`PASS: imported ${imported.components.length} native components and ${imported.wires.length} wires; value/move/rotation/reconnect round-trip changes net topology; source hash ${sourceHash} remains unchanged; unsupported no-connect and off-grid edits are refused.`);
