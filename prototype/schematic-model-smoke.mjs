import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const modelApi = require(resolve(root, 'desktop', 'dist', 'schematic-model.js'));
const nativeAdapter = require(resolve(root, 'desktop', 'kicad-schematic-adapter.cjs'));
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

const expectOwnerNets = [['D1.1', 'R1.1'], ['D1.2', 'J1.2'], ['J1.1', 'R1.2']];
const importedOwnerCandidate = modelApi.createLedReferenceModel();
const candidateResistor = importedOwnerCandidate.components.find(item => item.reference === 'R1');
candidateResistor.value = '510'; candidateResistor.x = 52; candidateResistor.y = 42; candidateResistor.rotation = 90;
const node = (reference, number) => modelApi.pinId(importedOwnerCandidate.components.find(item => item.reference === reference).id, number);
const swapEndpoint = (wire, oldNode, nextNode) => { if (wire.fromNodeId === oldNode) wire.fromNodeId = nextNode; else if (wire.toNodeId === oldNode) wire.toNodeId = nextNode; else throw new Error(`Expected ${oldNode} in ${wire.id}`); };
const inputWire = importedOwnerCandidate.wires.find(wire => [wire.fromNodeId, wire.toNodeId].includes(node('J1', '1')) && [wire.fromNodeId, wire.toNodeId].includes(node('R1', '1')));
const ledWire = importedOwnerCandidate.wires.find(wire => [wire.fromNodeId, wire.toNodeId].includes(node('R1', '2')) && [wire.fromNodeId, wire.toNodeId].includes(node('D1', '1')));
swapEndpoint(inputWire, node('R1', '1'), node('R1', '2'));
swapEndpoint(ledWire, node('R1', '2'), node('R1', '1'));
assert.deepEqual(nativeAdapter.netGroups(importedOwnerCandidate), expectOwnerNets, 'model fixture represents the expected owner candidate topology');
assert.deepEqual(modelApi.findSupplyShorts(importedOwnerCandidate), [], 'LED fixture has no semantic 5V-to-GND short');

const routed = modelApi.routeSchematicWires(importedOwnerCandidate);
assert.deepEqual(routed.errors, [], 'orthogonal renderer routes avoid symbol, label, pin and cross-net collisions');
assert.deepEqual(nativeAdapter.netGroups(importedOwnerCandidate), expectOwnerNets, 'computing display geometry cannot change semantic net assignments');
assert.ok(routed.routes.every(route => route.points.length >= 2 && route.points.every((point, index) => index === 0 || route.points[index - 1].x === point.x || route.points[index - 1].y === point.y)), 'routed geometry contains only orthogonal segments');

const netIdByPin = new Map();
for (const net of modelApi.deriveNets(importedOwnerCandidate)) for (const pin of net.pins) netIdByPin.set(modelApi.pinId(pin.componentId, pin.pinNumber), net.id);
const previousMidpointRoutes = importedOwnerCandidate.wires.map(wire => {
  const a = modelApi.pointForNode(importedOwnerCandidate, wire.fromNodeId), b = modelApi.pointForNode(importedOwnerCandidate, wire.toNodeId);
  const midX = Math.round((a.x + b.x) / 2);
  return { wireId: wire.id, netId: netIdByPin.get(wire.fromNodeId), points: [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b] };
});
assert.ok(modelApi.validateWireGeometry(previousMidpointRoutes).length > 0, 'regression reproduces the checked-in owner candidate midpoint routes touching across distinct semantic nets');
const oldMidpointCollision = (a, b, wireId, netId) => {
  const midX = Math.round((a.x + b.x) / 2);
  return { wireId, netId, points: [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b] };
};
assert.ok(modelApi.validateWireGeometry([
  oldMidpointCollision({ x: 0, y: 0 }, { x: 10, y: 4 }, 'old-a', 'net:5v'),
  oldMidpointCollision({ x: 0, y: 2 }, { x: 5, y: 0 }, 'old-b', 'net:gnd'),
]).length > 0, 'regression catches cross-net T-touch introduced by the former independent midpoint router');

const crossing = modelApi.validateWireGeometry([
  { wireId: 'horizontal', netId: 'net:5v', points: [{ x: 0, y: 2 }, { x: 4, y: 2 }] },
  { wireId: 'vertical', netId: 'net:gnd', points: [{ x: 2, y: 0 }, { x: 2, y: 4 }] },
]);
assert.equal(crossing.length, 1, 'crossing wires on different nets are flagged');
const tee = modelApi.validateWireGeometry([
  { wireId: 'trunk', netId: 'net:5v', points: [{ x: 0, y: 2 }, { x: 4, y: 2 }] },
  { wireId: 'branch', netId: 'net:gnd', points: [{ x: 2, y: 0 }, { x: 2, y: 2 }] },
]);
assert.equal(tee.length, 1, 'a geometric T-junction without a semantic junction is flagged');
assert.deepEqual(modelApi.validateWireGeometry([
  { wireId: 'joined-a', netId: 'net:joined', points: [{ x: 0, y: 2 }, { x: 4, y: 2 }] },
  { wireId: 'joined-b', netId: 'net:joined', points: [{ x: 2, y: 0 }, { x: 2, y: 4 }] },
]), [], 'intersection within one already-connected semantic net does not report a false cross-net short');

const shorted = structuredClone(importedOwnerCandidate);
shorted.wires.push({ id: 'deliberate-5v-gnd-short', fromNodeId: modelApi.pinId(shorted.components.find(item => item.reference === 'J1').id, '1'), toNodeId: modelApi.pinId(shorted.components.find(item => item.reference === 'J1').id, '2') });
assert.ok(modelApi.findSupplyShorts(shorted).some(issue => /5V_IN.*GND|GND.*5V_IN/.test(issue)), 'direct 5V_IN-to-GND semantic short is explicitly detected');

const rotatedMoved = structuredClone(importedOwnerCandidate);
const movedResistor = rotatedMoved.components.find(item => item.reference === 'R1');
movedResistor.x += 3; movedResistor.rotation = 180;
assert.deepEqual(nativeAdapter.netGroups(rotatedMoved), expectOwnerNets, 'moving and rotating a component preserves pin-ID connectivity');
assert.deepEqual(modelApi.routeSchematicWires(rotatedMoved).errors, [], 'moved and rotated component still receives collision-free wire geometry');

const persisted = JSON.stringify(JSON.parse(JSON.stringify(sample)));
assert.equal(JSON.stringify(JSON.parse(persisted)), persisted, 'save/reopen serialization is deterministic for the starter document');
const before = modelApi.deriveNets(sample).map(net => [net.name, net.pins.map(pin => `${pin.reference}.${pin.pinNumber}`).sort()]);
const after = modelApi.deriveNets(JSON.parse(persisted)).map(net => [net.name, net.pins.map(pin => `${pin.reference}.${pin.pinNumber}`).sort()]);
assert.deepEqual(after, before, 'save/reopen preserves each pin association');

console.log('PASS: model create/edit/connect/disconnect/rotate/move, explicit 5V-to-GND short detection, orthogonal collision-free routing, cross-net crossing/T-junction rejection, and deterministic save/reopen.');
