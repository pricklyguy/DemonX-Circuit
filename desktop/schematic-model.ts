export type PinDefinition = { number: string; name: string; x: number; y: number; electricalType: string };
export type SchematicComponent = { id: string; libId: string; reference: string; value: string; x: number; y: number; rotation: 0 | 90 | 180 | 270; pins: PinDefinition[] };
export type SchematicJunction = { id: string; x: number; y: number };
export type SchematicWire = { id: string; fromNodeId: string; toNodeId: string };
export type SchematicLabel = { id: string; nodeId: string; name: string };
export type SchematicDocument = { format: 'demonx-schematic'; formatVersion: 1; name: string; gridMm: 1.27; components: SchematicComponent[]; junctions: SchematicJunction[]; wires: SchematicWire[]; labels: SchematicLabel[]; nativeSync?: { sourceSha256: string; sourceFormat?: string } };
export type DerivedNet = { id: string; name: string | null; pins: Array<{ componentId: string; reference: string; pinNumber: string; pinName: string }> };

export const COMPONENT_LIBRARY: Array<{ libId: string; name: string; category: string; pins: PinDefinition[] }> = [
  { libId: 'Connector_Generic:Conn_01x02', name: '2-pin connector', category: 'Connector', pins: [{ number: '1', name: 'Pin 1', x: -4, y: 0, electricalType: 'passive' }, { number: '2', name: 'Pin 2', x: -4, y: 2, electricalType: 'passive' }] },
  { libId: 'Device:R', name: 'Resistor', category: 'Passive', pins: [{ number: '1', name: '1', x: 0, y: -3, electricalType: 'passive' }, { number: '2', name: '2', x: 0, y: 3, electricalType: 'passive' }] },
  { libId: 'Device:LED', name: 'LED', category: 'Diode', pins: [{ number: '1', name: 'K', x: -3, y: 0, electricalType: 'passive' }, { number: '2', name: 'A', x: 3, y: 0, electricalType: 'passive' }] },
];

export function createLedReferenceModel(): SchematicDocument {
  const component = (id: string, libId: string, reference: string, value: string, x: number, y: number, rotation: 0 | 90 | 180 | 270): SchematicComponent => {
    const definition = COMPONENT_LIBRARY.find(item => item.libId === libId);
    if (!definition) throw new Error(`Unsupported starter component ${libId}`);
    return { id, libId, reference, value, x, y, rotation, pins: definition.pins.map(pin => ({ ...pin })) };
  };
  return {
    format: 'demonx-schematic', formatVersion: 1, name: 'LED and resistor starter', gridMm: 1.27,
    components: [
      component('component-input-01', 'Connector_Generic:Conn_01x02', 'J1', '5V INPUT', 40, 40, 0),
      component('component-resistor-01', 'Device:R', 'R1', '330', 50, 40, 0),
      component('component-led-01', 'Device:LED', 'D1', 'RED LED', 60, 40, 0),
    ],
    junctions: [],
    wires: [
      { id: 'wire-input-resistor', fromNodeId: 'pin:component-input-01:1', toNodeId: 'pin:component-resistor-01:1' },
      { id: 'wire-resistor-led', fromNodeId: 'pin:component-resistor-01:2', toNodeId: 'pin:component-led-01:1' },
      { id: 'wire-led-return', fromNodeId: 'pin:component-led-01:2', toNodeId: 'pin:component-input-01:2' },
    ],
    labels: [
      { id: 'label-5v-in', nodeId: 'pin:component-input-01:1', name: '5V_IN' },
      { id: 'label-gnd', nodeId: 'pin:component-input-01:2', name: 'GND' },
    ],
  };
}

export function pinId(componentId: string, number: string): string { return `pin:${componentId}:${number}`; }

export function pointForNode(document: SchematicDocument, nodeId: string): { x: number; y: number } | null {
  const junction = document.junctions.find(item => item.id === nodeId);
  if (junction) return { x: junction.x, y: junction.y };
  const match = /^pin:([^:]+):(.+)$/.exec(nodeId);
  if (!match) return null;
  const component = document.components.find(item => item.id === match[1]);
  const pin = component?.pins.find(item => item.number === match[2]);
  if (!component || !pin) return null;
  const turns = component.rotation / 90;
  let x = pin.x, y = pin.y;
  for (let index = 0; index < turns; index++) [x, y] = [-y, x];
  return { x: component.x + x, y: component.y + y };
}

export function deriveNets(document: SchematicDocument): DerivedNet[] {
  const parent = new Map<string, string>();
  const find = (node: string): string => { const current = parent.get(node) ?? node; if (current !== node) parent.set(node, find(current)); else parent.set(node, current); return parent.get(node)!; };
  const join = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) { const [first, second] = [ra, rb].sort(); parent.set(second, first); } };
  for (const component of document.components) for (const pin of component.pins) find(pinId(component.id, pin.number));
  for (const junction of document.junctions) find(junction.id);
  for (const wire of document.wires) join(wire.fromNodeId, wire.toNodeId);
  const groups = new Map<string, DerivedNet>();
  for (const component of document.components) for (const pin of component.pins) {
    const key = find(pinId(component.id, pin.number));
    const net = groups.get(key) ?? { id: `net:${key}`, name: null, pins: [] };
    net.pins.push({ componentId: component.id, reference: component.reference, pinNumber: pin.number, pinName: pin.name });
    groups.set(key, net);
  }
  for (const label of document.labels) {
    const key = find(label.nodeId);
    const net = groups.get(key);
    if (net) net.name = net.name ? `${net.name}, ${label.name}` : label.name;
  }
  return [...groups.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function validateSchematic(document: SchematicDocument): string[] {
  const errors: string[] = [];
  if (document.format !== 'demonx-schematic' || document.formatVersion !== 1 || document.gridMm !== 1.27) errors.push('Unsupported DemonX schematic format or grid.');
  if (document.nativeSync !== undefined && (!document.nativeSync || typeof document.nativeSync.sourceSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(document.nativeSync.sourceSha256))) errors.push('Native schematic source revision hash is malformed.');
  const componentIds = new Set<string>(), references = new Set<string>(), nodeIds = new Set<string>();
  for (const component of document.components) {
    if (!component.id || componentIds.has(component.id)) errors.push(`Duplicate or missing component ID: ${component.id}`);
    if (!component.reference || references.has(component.reference)) errors.push(`Duplicate or missing reference: ${component.reference}`);
    componentIds.add(component.id); references.add(component.reference);
    const definition = COMPONENT_LIBRARY.find(item => item.libId === component.libId);
    if (!definition || definition.pins.map(pin => pin.number).sort().join(',') !== component.pins.map(pin => pin.number).sort().join(',')) errors.push(`Component ${component.reference} has an unsupported or altered pin definition.`);
    for (const pin of component.pins) nodeIds.add(pinId(component.id, pin.number));
    if (![0, 90, 180, 270].includes(component.rotation) || !Number.isInteger(component.x) || !Number.isInteger(component.y)) errors.push(`Component ${component.reference} is off the supported 50 mil grid or rotation.`);
  }
  for (const junction of document.junctions) {
    if (!junction.id || nodeIds.has(junction.id)) errors.push(`Duplicate or missing junction ID: ${junction.id}`);
    nodeIds.add(junction.id);
    if (!Number.isInteger(junction.x) || !Number.isInteger(junction.y)) errors.push(`Junction ${junction.id} is off the supported 50 mil grid.`);
  }
  const wireIds = new Set<string>();
  for (const wire of document.wires) {
    if (!wire.id || wireIds.has(wire.id)) errors.push(`Duplicate or missing wire ID: ${wire.id}`);
    wireIds.add(wire.id);
    if (!nodeIds.has(wire.fromNodeId) || !nodeIds.has(wire.toNodeId) || wire.fromNodeId === wire.toNodeId) errors.push(`Wire ${wire.id} has an invalid endpoint.`);
  }
  for (const label of document.labels) if (!nodeIds.has(label.nodeId) || !label.name.trim()) errors.push(`Label ${label.id} has an invalid attachment or name.`);
  for (const net of deriveNets(document)) if (net.pins.length > 1 && !document.wires.some(wire => net.pins.some(pin => wire.fromNodeId === pinId(pin.componentId, pin.pinNumber)) || net.pins.some(pin => wire.toNodeId === pinId(pin.componentId, pin.pinNumber)))) errors.push(`Net ${net.id} has no explicit wire connection.`);
  return errors;
}

export function cloneDocument(document: SchematicDocument): SchematicDocument { return JSON.parse(JSON.stringify(document)) as SchematicDocument; }
