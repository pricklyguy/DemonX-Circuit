import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const adapter = require(resolve('desktop', 'kicad-schematic-adapter.cjs'));
const sourcePath = resolve('examples', 'native-smoke', 'DX_LED_Smoke', 'DX_LED_Smoke.kicad_sch');
const originalText = await readFile(sourcePath, 'utf8');
const sourceHash = adapter.digest(originalText);
const imported = adapter.importKiCadSchematic(originalText);
assert.deepEqual(imported.components.map(({ reference, libId, value, x, y, rotation }) => [reference, libId, value, x, y, rotation]), [
  ['J1', 'Connector_Generic:Conn_01x02', '5V INPUT', 40, 40, 0],
  ['R1', 'Device:R', '330', 50, 40, 0],
  ['D1', 'Device:LED', 'RED LED', 60, 40, 0],
]);
assert.equal(imported.wires.length, 3);
assert.deepEqual(adapter.netGroups(imported), [['D1.1', 'R1.2'], ['D1.2', 'J1.2'], ['J1.1', 'R1.1']]);
assert.equal(imported.nativeSync.sourceSha256, sourceHash);

const edited = structuredClone(imported);
const resistor = edited.components.find(component => component.reference === 'R1');
resistor.value = '470';
resistor.x = 52;
resistor.rotation = 90;
edited.wires[0].toNodeId = `pin:${resistor.id}:2`;
edited.wires[1].fromNodeId = `pin:${resistor.id}:1`;
const candidate = adapter.exportKiCadCandidate(originalText, edited);
assert.notEqual(candidate.sha256, sourceHash);
assert.equal(adapter.sameSemantic(edited, candidate.imported), true, 'native export and reimport preserve edited semantic state');
assert.deepEqual(adapter.netGroups(candidate.imported), [['D1.1', 'R1.1'], ['D1.2', 'J1.2'], ['J1.1', 'R1.2']], 'rewiring changes real pin-to-net topology');
assert.equal(adapter.digest(await readFile(sourcePath, 'utf8')), sourceHash, 'native source remains untouched by staging');

const disconnected = structuredClone(edited);
disconnected.wires = disconnected.wires.slice(1);
const invalidCandidate = adapter.exportKiCadCandidate(originalText, disconnected);
assert.equal(adapter.sameSemantic(disconnected, invalidCandidate.imported), true, 'disconnected semantic edit can be staged for native ERC rejection');

let refused = false;
try { adapter.importKiCadSchematic(originalText.replace('(sheet_instances', '(no_connect (at 1 2) (uuid "00000000-0000-4000-8000-000000000000")) (sheet_instances')); }
catch (error) { refused = /Unsupported native KiCad construct “no_connect”/.test(error.message); }
assert.equal(refused, true, 'unsupported electrical constructs are explicitly refused');

const offGrid = structuredClone(imported);
offGrid.components.find(component => component.reference === 'R1').x += 0.25;
assert.throws(() => adapter.exportKiCadCandidate(originalText, offGrid), /50 mil grid|grid/i, 'off-grid edit is refused rather than rounded into a lossy export');

console.log(`PASS: imported ${imported.components.length} native components and ${imported.wires.length} wires; value/move/rotation/reconnect round-trip changes net topology; source hash ${sourceHash} remains unchanged; unsupported no-connect and off-grid edits are refused.`);
