export type PinDefinition = { number: string; name: string; x: number; y: number; electricalType: string };
export type SchematicComponent = { id: string; libId: string; reference: string; value: string; x: number; y: number; rotation: 0 | 90 | 180 | 270; pins: PinDefinition[] };
export type SchematicJunction = { id: string; x: number; y: number };
export type SchematicWire = { id: string; fromNodeId: string; toNodeId: string };
export type SchematicLabel = { id: string; nodeId: string; name: string };
export type SchematicDocument = { format: 'demonx-schematic'; formatVersion: 1; name: string; gridMm: 1.27; components: SchematicComponent[]; junctions: SchematicJunction[]; wires: SchematicWire[]; labels: SchematicLabel[]; nativeSync?: { sourceSha256: string; sourceFormat?: string } };
export type DerivedNet = { id: string; name: string | null; pins: Array<{ componentId: string; reference: string; pinNumber: string; pinName: string }> };
export type WireRoute = { wireId: string; netId: string; points: Array<{ x: number; y: number }> };

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

const routeKey = (x: number, y: number) => `${x},${y}`;
const routeStateKey = (x: number, y: number, direction: number) => `${x},${y},${direction}`;

/** Route the semantic pin-to-pin edges as orthogonal display geometry. Geometry never changes the net graph. */
export function routeSchematicWires(document: SchematicDocument): { routes: WireRoute[]; errors: string[] } {
  const errors: string[] = [];
  if (document.wires.length > 256) return { routes: [], errors: ['Automatic schematic routing is limited to 256 connections in this preview. No wires were drawn or staged.'] };
  const pinPoints = new Map<string, { x: number; y: number }>();
  for (const component of document.components) for (const pin of component.pins) {
    const id = pinId(component.id, pin.number);
    const point = pointForNode(document, id);
    if (point) pinPoints.set(id, point);
  }
  const parent = new Map<string, string>();
  const find = (node: string): string => { const value = parent.get(node) ?? node; if (value !== node) parent.set(node, find(value)); else parent.set(node, value); return parent.get(node)!; };
  const join = (left: string, right: string) => { const a = find(left), b = find(right); if (a !== b) { const [first, second] = [a, b].sort(); parent.set(second, first); } };
  for (const id of [...pinPoints.keys(), ...document.junctions.map(item => item.id)]) find(id);
  for (const wire of document.wires) join(wire.fromNodeId, wire.toNodeId);
  const netByNode = new Map([...parent.keys()].map(node => [node, `net:${find(node)}`]));
  const nodePoint = (id: string) => {
    const pin = pinPoints.get(id);
    if (pin) return pin;
    const junction = document.junctions.find(item => item.id === id);
    return junction ? { x: junction.x, y: junction.y } : null;
  };
  const maxX = Math.max(0, ...[...pinPoints.values()].map(point => point.x)) + 32;
  const maxY = Math.max(0, ...[...pinPoints.values()].map(point => point.y)) + 32;
  const minX = Math.min(0, ...[...pinPoints.values()].map(point => point.x)) - 32;
  const minY = Math.min(0, ...[...pinPoints.values()].map(point => point.y)) - 32;
  if (maxX - minX > 512 || maxY - minY > 512) return { routes: [], errors: ['Schematic extent is too large for safe automatic wire routing in this preview. No wires were drawn or staged.'] };
  const reservedByNet = new Map<string, string>();
  const sortedWires = [...document.wires].sort((left, right) => {
    const a1 = nodePoint(left.fromNodeId), a2 = nodePoint(left.toNodeId), b1 = nodePoint(right.fromNodeId), b2 = nodePoint(right.toNodeId);
    const length = (a: typeof a1, b: typeof a1) => a && b ? Math.abs(a.x - b.x) + Math.abs(a.y - b.y) : 0;
    return length(b1, b2) - length(a1, a2) || left.id.localeCompare(right.id);
  });
  const routes: WireRoute[] = [];
  const directions = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
  for (const wire of sortedWires) {
    const start = nodePoint(wire.fromNodeId), end = nodePoint(wire.toNodeId);
    if (!start || !end) { errors.push(`Wire ${wire.id} has no routable endpoint.`); continue; }
    const netId = netByNode.get(wire.fromNodeId) || netByNode.get(wire.toNodeId) || `net:${wire.id}`;
    const blocked = (x: number, y: number) => {
      if ((x < minX || x > maxX || y < minY || y > maxY) && routeKey(x, y) !== routeKey(end.x, end.y)) return true;
      if (routeKey(x, y) !== routeKey(start.x, start.y) && routeKey(x, y) !== routeKey(end.x, end.y)) {
        const owner = reservedByNet.get(routeKey(x, y));
        if (owner && owner !== netId) return true;
        // Reserve the rendered component body. The supported symbols occupy at
        // most one model-grid cell from their origin; the wider lead area stays
        // routable so close but valid starter placements still have a path.
        for (const component of document.components) if (Math.abs(x - component.x) <= 1 && Math.abs(y - component.y) <= 1) return true;
        for (const [id, point] of pinPoints) if (id !== wire.fromNodeId && id !== wire.toNodeId && point.x === x && point.y === y) return true;
        for (const junction of document.junctions) if (junction.id !== wire.fromNodeId && junction.id !== wire.toNodeId && junction.x === x && junction.y === y) return true;
        for (const label of document.labels) {
          if (label.nodeId === wire.fromNodeId || label.nodeId === wire.toNodeId) continue;
          const point = nodePoint(label.nodeId);
          if (point && x >= point.x - Math.max(1, Math.ceil(label.name.length / 4)) && x <= point.x + 1 && Math.abs(y - point.y) <= 1) return true;
        }
      }
      return false;
    };
    const firstKey = routeStateKey(start.x, start.y, -1);
    const open = [{ x: start.x, y: start.y, direction: -1, g: 0, f: Math.abs(start.x - end.x) + Math.abs(start.y - end.y), key: firstKey }];
    const costs = new Map([[firstKey, 0]]);
    const parents = new Map<string, string>();
    let goal: string | null = null;
    while (open.length) {
      open.sort((a, b) => a.f - b.f || a.g - b.g || a.key.localeCompare(b.key));
      const current = open.shift()!;
      if (current.g !== costs.get(current.key)) continue;
      if (current.x === end.x && current.y === end.y) { goal = current.key; break; }
      for (let direction = 0; direction < directions.length; direction++) {
        const next = { x: current.x + directions[direction].x, y: current.y + directions[direction].y };
        if (blocked(next.x, next.y)) continue;
        const nextKey = routeStateKey(next.x, next.y, direction);
        const nextCost = current.g + 1 + (current.direction >= 0 && current.direction !== direction ? 0.3 : 0);
        if (nextCost >= (costs.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
        costs.set(nextKey, nextCost); parents.set(nextKey, current.key);
        open.push({ ...next, direction, g: nextCost, f: nextCost + Math.abs(next.x - end.x) + Math.abs(next.y - end.y), key: nextKey });
      }
    }
    if (!goal) { errors.push(`No clear orthogonal route is available for ${wire.fromNodeId} → ${wire.toNodeId}; geometry was not drawn.`); continue; }
    const cells: Array<{ x: number; y: number }> = [];
    for (let key: string | undefined = goal; key; key = parents.get(key)) {
      const [x, y] = key.split(',').map(Number); cells.push({ x, y }); if (key === firstKey) break;
    }
    cells.reverse();
    const points = cells.filter((point, index) => index === 0 || index === cells.length - 1 || (point.x - cells[index - 1].x) * (cells[index + 1].y - point.y) !== (point.y - cells[index - 1].y) * (cells[index + 1].x - point.x));
    const route = { wireId: wire.id, netId, points };
    routes.push(route);
    for (const point of cells) if (routeKey(point.x, point.y) !== routeKey(start.x, start.y) && routeKey(point.x, point.y) !== routeKey(end.x, end.y)) reservedByNet.set(routeKey(point.x, point.y), netId);
  }
  errors.push(...validateWireGeometry(routes));
  return { routes, errors };
}

/** Reject display routes whose orthogonal segments touch across distinct semantic nets. */
export function validateWireGeometry(routes: WireRoute[]): string[] {
  const errors: string[] = [];
  const intersects = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) => {
    if (a.x === b.x && c.x === d.x) return a.x === c.x && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
    if (a.y === b.y && c.y === d.y) return a.y === c.y && Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
    if (a.x === b.x) return c.x >= Math.min(a.x, b.x) && c.x <= Math.max(a.x, b.x) && a.y >= Math.min(c.y, d.y) && a.y <= Math.max(c.y, d.y);
    if (c.x === d.x) return c.x >= Math.min(a.x, b.x) && c.x <= Math.max(a.x, b.x) && a.y >= Math.min(c.y, d.y) && a.y <= Math.max(c.y, d.y);
    return false;
  };
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    const left = routes[i], right = routes[j]; if (left.netId === right.netId) continue;
    for (let a = 1; a < left.points.length; a++) for (let b = 1; b < right.points.length; b++) {
      if (intersects(left.points[a - 1], left.points[a], right.points[b - 1], right.points[b])) {
        errors.push(`Display routes ${left.wireId} and ${right.wireId} touch or cross despite belonging to different semantic nets.`); break;
      }
    }
  }
  return [...new Set(errors)];
}

export function findSupplyShorts(document: SchematicDocument): string[] {
  const ground = /^(?:GND|GROUND|0V|VSS)$/i;
  const positive = /^(?:\+?5V(?:_IN)?|VBUS|VIN|VCC|3V3|3\.3V)$/i;
  const errors: string[] = [];
  for (const net of deriveNets(document)) {
    const names = document.labels.filter(label => net.pins.some(pin => pinId(pin.componentId, pin.pinNumber) === label.nodeId)).map(label => label.name.trim());
    if (names.some(name => ground.test(name)) && names.some(name => positive.test(name))) errors.push(`Electrical short: ${names.join(' and ')} labels are attached to the same semantic net.`);
  }
  return errors;
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
