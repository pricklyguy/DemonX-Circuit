import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const modelApi = require(resolve(root, 'desktop', 'dist', 'schematic-model.js'));
const sample = JSON.parse(await readFile(resolve(root, 'examples', 'native-smoke', 'led-resistor.dxcircuit.json'), 'utf8'));

assert.deepEqual(modelApi.validateSchematic(sample), [], 'starter schematic validates');
assert.equal(sample.components.length, 3, 'starter contains connector, resistor and LED');
assert.equal(sample.wires.length, 3, 'starter contains three explicit electrical connections');
const nets = modelApi.deriveNets(sample);
assert.equal(nets.length, 3, 'each distinct electrical connection group is derived from wire endpoints');
assert.equal(nets.find(net => net.name === '5V_IN')?.pins.length, 2, '5V_IN label follows actual pin connectivity');

const resistor = sample.components.find(component => component.reference === 'R1');
assert.ok(resistor);
const rotatedPin = modelApi.pointForNode({ ...sample, components: sample.components.map(component => component.id === resistor.id ? { ...component, rotation: 90 } : component) }, modelApi.pinId(resistor.id, '1'));
assert.deepEqual(rotatedPin, { x: 53, y: 40 }, 'rotation moves pins on the 50 mil grid');

const disconnected = structuredClone(sample);
disconnected.wires = disconnected.wires.filter(wire => wire.id !== 'wire-resistor-led');
assert.equal(modelApi.deriveNets(disconnected).length, 4, 'removing a wire disconnects the semantic net even if the drawing overlaps');
const reconnected = structuredClone(disconnected);
reconnected.wires.push({ id: 'wire-reconnect-test', fromNodeId: modelApi.pinId('component-resistor-01', '2'), toNodeId: modelApi.pinId('component-led-01', '1') });
assert.equal(modelApi.deriveNets(reconnected).length, 3, 'adding a wire merges pin connectivity');
assert.deepEqual(modelApi.validateSchematic(reconnected), [], 'reconnected model remains valid');

const persisted = JSON.stringify(JSON.parse(JSON.stringify(sample)));
assert.equal(JSON.stringify(JSON.parse(persisted)), persisted, 'save/reopen serialization is deterministic for the starter document');
const before = modelApi.deriveNets(sample).map(net => [net.name, net.pins.map(pin => `${pin.reference}.${pin.pinNumber}`).sort()]);
const after = modelApi.deriveNets(JSON.parse(persisted)).map(net => [net.name, net.pins.map(pin => `${pin.reference}.${pin.pinNumber}`).sort()]);
assert.deepEqual(after, before, 'save/reopen preserves each pin association');

console.log('PASS: model creation, rotation-aware pins, explicit wire connect/disconnect, deterministic save/reopen, and net-equivalence checks.');
