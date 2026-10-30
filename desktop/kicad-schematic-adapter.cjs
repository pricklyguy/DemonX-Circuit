const crypto = require('node:crypto');
const { COMPONENT_LIBRARY, deriveNets, pointForNode, validateSchematic } = require('./dist/schematic-model.js');

const GRID_MM = 1.27;
const ATOM = Symbol('sexpr-atom');
const COMMENT = Symbol('sexpr-comment');
const allowedRootItems = new Set(['version', 'generator', 'generator_version', 'uuid', 'paper', 'title_block', 'lib_symbols', 'symbol', 'wire', 'junction', 'label', 'sheet_instances', 'embedded_fonts']);

function atom(value) { return { [ATOM]: true, value: String(value) }; }
function comment(value) { return { [COMMENT]: true, value }; }
function isAtom(value) { return !!value?.[ATOM]; }
function isComment(value) { return !!value?.[COMMENT]; }
function head(node) { return Array.isArray(node) && isAtom(node[0]) ? node[0].value : null; }
function strings(node) { return Array.isArray(node) ? node.filter(item => !isComment(item)) : []; }
function children(node, name) { return strings(node).filter(item => Array.isArray(item) && head(item) === name); }
function child(node, name) { return children(node, name)[0] || null; }
function textValue(node) { return isAtom(node) ? node.value : typeof node === 'string' ? node : null; }
function value(node, name) { return textValue(child(node, name)?.[1]); }
function number(node, name, index = 1) {
  const tuple = head(node) === name ? node : child(node, name);
  const raw = textValue(tuple?.[index]);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Unsupported native schematic: missing numeric ${name} coordinate.`);
  return parsed;
}
function direct(node, name) { return children(node, name); }
function walk(node, predicate, result = []) {
  if (!Array.isArray(node)) return result;
  if (predicate(node)) result.push(node);
  for (const item of node) walk(item, predicate, result);
  return result;
}
function tokenize(source) {
  const tokens = [];
  for (let i = 0; i < source.length;) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === ';') { const end = source.indexOf('\n', i); const stop = end < 0 ? source.length : end; tokens.push(comment(source.slice(i, stop))); i = stop; continue; }
    if (c === '(' || c === ')') { tokens.push(c); i++; continue; }
    if (c === '"') {
      let raw = '"'; i++; let escaped = false;
      while (i < source.length) { const next = source[i++]; raw += next; if (!escaped && next === '"') break; if (!escaped && next === '\\') escaped = true; else escaped = false; }
      if (raw.length < 2 || raw.at(-1) !== '"') throw new Error('Unsupported native schematic: unterminated quoted string.');
      tokens.push(JSON.parse(raw)); continue;
    }
    let end = i + 1;
    while (end < source.length && !/[\s();]/.test(source[end])) end++;
    tokens.push(atom(source.slice(i, end))); i = end;
  }
  return tokens;
}
function parse(source) {
  const tokens = tokenize(source); let cursor = 0;
  const read = () => {
    const token = tokens[cursor++];
    if (token === undefined) throw new Error('Unsupported native schematic: unexpected end of file.');
    if (token === ')') throw new Error('Unsupported native schematic: unmatched closing parenthesis.');
    if (token !== '(') return token;
    const list = [];
    while (cursor < tokens.length && tokens[cursor] !== ')') list.push(read());
    if (tokens[cursor++] !== ')') throw new Error('Unsupported native schematic: unterminated list.');
    return list;
  };
  const root = read();
  if (cursor !== tokens.length || head(root) !== 'kicad_sch') throw new Error('Unsupported native schematic: expected exactly one KiCad schematic document.');
  return root;
}
function quote(value) { return JSON.stringify(String(value)); }
function write(node) {
  if (isAtom(node)) return node.value;
  if (isComment(node)) return `${node.value}\n`;
  if (typeof node === 'string') return quote(node);
  if (Array.isArray(node)) return `(${node.map(write).join(' ')})`;
  throw new Error('Cannot serialize unsupported schematic syntax.');
}
function digest(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function uuidFromId(id) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return id;
  const hex = crypto.createHash('sha256').update(`demonx-circuit:${id}`).digest('hex').slice(0, 32).split('');
  hex[12] = '5'; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join(''); return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}
function toGrid(mm, what) {
  const grid = Math.round(mm / GRID_MM);
  if (Math.abs(mm - grid * GRID_MM) > 1e-5) throw new Error(`Unsupported native schematic: ${what} is not on DemonX's 1.27 mm grid.`);
  return grid;
}
function mm(value) { return Number((value * GRID_MM).toFixed(4)); }
function coordKey(x, y) { return `${Number(x.toFixed(4))},${Number(y.toFixed(4))}`; }
function pinPosition(component, pin) {
  const point = pointForNode({ junctions: [], components: [component] }, `pin:${component.id}:${pin.number}`);
  if (!point) throw new Error(`Unsupported native schematic: cannot resolve ${component.reference}.${pin.number}.`);
  return { x: mm(point.x), y: mm(point.y) };
}
function directProperty(symbol, name) {
  return direct(symbol, 'property').find(item => item[1] === name) || null;
}
function propertyValue(symbol, name) { return textValue(directProperty(symbol, name)?.[2]); }
function nestedPinDefinitions(libSymbols, libId, expected) {
  const definitions = children(libSymbols, 'symbol').filter(item => item[1] === libId);
  if (!definitions.length) throw new Error(`Unsupported native schematic: embedded library definition ${libId} is missing.`);
  const pins = walk(definitions[0], item => head(item) === 'pin');
  const actual = pins.map(pin => ({ number: value(pin, 'number'), name: (value(pin, 'name') || '').replaceAll('_', ' '), electricalType: textValue(pin[1]), at: child(pin, 'at') }));
  const expectedIds = expected.pins.map(pin => pin.number).sort().join(',');
  if (actual.map(pin => pin.number).sort().join(',') !== expectedIds) throw new Error(`Unsupported native schematic: ${libId} pin identities do not match the constrained editor library.`);
  for (const expectedPin of expected.pins) {
    const native = actual.find(pin => pin.number === expectedPin.number);
    if (native && native.name && native.name !== expectedPin.name) throw new Error(`Unsupported native schematic: ${libId}.${expectedPin.number} pin name differs from the editor library.`);
    if (native && native.electricalType !== expectedPin.electricalType) throw new Error(`Unsupported native schematic: ${libId}.${expectedPin.number} electrical pin type differs from the editor model.`);
    if (!native?.at || toGrid(number(native.at, 'at', 1), `${libId}.${expectedPin.number} pin X`) !== expectedPin.x || toGrid(-number(native.at, 'at', 2), `${libId}.${expectedPin.number} pin Y`) !== expectedPin.y) throw new Error(`Unsupported native schematic: ${libId}.${expectedPin.number} pin geometry differs from the editor model.`);
  }
}
function importKiCadSchematic(sourceText) {
  if (Buffer.byteLength(sourceText, 'utf8') > 5 * 1024 * 1024) throw new Error('Unsupported native schematic: file exceeds the 5 MB import limit.');
  const root = parse(sourceText);
  for (const item of strings(root).slice(1)) {
    if (!Array.isArray(item)) continue;
    const type = head(item);
    if (!allowedRootItems.has(type)) throw new Error(`Unsupported native KiCad construct “${type}”. Import is read-only for this construct; no edit was made.`);
  }
  const libSymbols = child(root, 'lib_symbols');
  if (!libSymbols) throw new Error('Unsupported native schematic: embedded symbol libraries are required for safe import.');
  const sourceSymbols = children(root, 'symbol');
  if (!sourceSymbols.length || sourceSymbols.length > 32) throw new Error('Unsupported native schematic: expected between 1 and 32 placed symbols.');
  const components = [];
  const symbolByReference = new Map();
  for (const native of sourceSymbols) {
    const libId = value(native, 'lib_id');
    const definition = COMPONENT_LIBRARY.find(item => item.libId === libId);
    if (!definition) throw new Error(`Unsupported native component ${value(native, 'property') || libId || '(unknown)'}. No native edit was made.`);
    nestedPinDefinitions(libSymbols, libId, definition);
    const reference = propertyValue(native, 'Reference');
    const componentValue = propertyValue(native, 'Value');
    const uuid = value(native, 'uuid');
    const placement = child(native, 'at');
    if (!reference || !componentValue || !uuid || !placement) throw new Error(`Unsupported native schematic: ${libId} is missing a reference, value, UUID or placement.`);
    // The semantic editor uses positive clockwise angles in its screen-space
    // (Y-down) coordinate system. KiCad serializes the inverse orientation.
    const nativeRotation = ((number(native, 'at', 3) % 360) + 360) % 360;
    const rotation = (360 - nativeRotation) % 360;
    if (![0, 90, 180, 270].includes(rotation)) throw new Error(`Unsupported native schematic: ${reference} has unsupported rotation ${rotation}.`);
    const component = {
      id: uuid, libId, reference, value: componentValue,
      x: toGrid(number(native, 'at', 1), `${reference} X position`),
      y: toGrid(number(native, 'at', 2), `${reference} Y position`),
      rotation, pins: definition.pins.map(pin => ({ ...pin }))
    };
    if (symbolByReference.has(reference)) throw new Error(`Unsupported native schematic: duplicate component reference ${reference}.`);
    components.push(component); symbolByReference.set(reference, native);
  }
  const junctions = children(root, 'junction').map(item => {
    const uuid = value(item, 'uuid');
    if (!uuid) throw new Error('Unsupported native schematic: junction without UUID.');
    return { id: uuid, x: toGrid(number(item, 'at', 1), 'Junction X position'), y: toGrid(number(item, 'at', 2), 'Junction Y position') };
  });
  const coordinates = new Map();
  const addCoordinate = (point, id) => {
    const key = coordKey(point.x, point.y); const ids = coordinates.get(key) || [];
    ids.push(id); coordinates.set(key, ids);
  };
  for (const component of components) for (const pin of component.pins) addCoordinate(pinPosition(component, pin), `pin:${component.id}:${pin.number}`);
  for (const junction of junctions) addCoordinate({ x: mm(junction.x), y: mm(junction.y) }, junction.id);
  const nodeAt = (x, y, context) => {
    const ids = coordinates.get(coordKey(x, y)) || [];
    if (ids.length !== 1) throw new Error(`Unsupported native schematic: ${context} lands on ${ids.length ? 'ambiguous' : 'unmapped'} electrical point (${x}, ${y}).`);
    return ids[0];
  };
  const wires = children(root, 'wire').map(item => {
    const nativeFields = strings(item).filter(value => Array.isArray(value)).map(head);
    if (nativeFields.some(name => !['pts', 'stroke', 'uuid'].includes(name)) || nativeFields.sort().join(',') !== 'pts,stroke,uuid') throw new Error('Unsupported native schematic: wire contains unsupported fields that this adapter cannot safely rewrite.');
    const pts = child(item, 'pts'); const points = children(pts, 'xy');
    if (points.length !== 2) throw new Error('Unsupported native schematic: only two-point straight wires are editable.');
    const stroke = child(item, 'stroke');
    if (!stroke || number(stroke, 'width', 1) !== 0 || value(stroke, 'type') !== 'default') throw new Error('Unsupported native schematic: custom wire strokes are not editable by this adapter.');
    const uuid = value(item, 'uuid');
    if (!uuid) throw new Error('Unsupported native schematic: wire without UUID.');
    return { id: uuid, fromNodeId: nodeAt(number(points[0], 'xy', 1), number(points[0], 'xy', 2), 'Wire start'), toNodeId: nodeAt(number(points[1], 'xy', 1), number(points[1], 'xy', 2), 'Wire end') };
  });
  const labels = children(root, 'label').map(item => {
    const uuid = value(item, 'uuid');
    if (!uuid) throw new Error('Unsupported native schematic: label without UUID.');
    return { id: uuid, nodeId: nodeAt(number(item, 'at', 1), number(item, 'at', 2), 'Label'), name: textValue(item[1]) };
  });
  const document = { format: 'demonx-schematic', formatVersion: 1, name: 'Imported KiCad schematic', gridMm: GRID_MM, components, junctions, wires, labels,
    nativeSync: { sourceSha256: digest(sourceText), sourceFormat: 'KiCad 10.0.7 constrained LED/resistor subset' } };
  const issues = validateSchematic(document);
  if (issues.length) throw new Error(`Unsupported native schematic: semantic import validation failed. ${issues.join(' ')}`);
  return document;
}
function setChild(node, name, replacement) {
  const index = node.findIndex(item => Array.isArray(item) && head(item) === name);
  if (index < 0) throw new Error(`Unsupported native schematic: cannot update missing ${name} node.`);
  node[index] = replacement;
}
function coordinateNode(x, y, angle = 0, headName = 'at') { return [atom(headName), atom(Number(x.toFixed(4))), atom(Number(y.toFixed(4))), atom(Number(angle.toFixed(4)))]; }
function findComponentById(document, id) { return document.components.find(item => item.id === id); }
function nativePointForNode(document, nodeId) {
  const point = pointForNode(document, nodeId);
  if (!point) throw new Error(`Unsupported edit: the wire endpoint ${nodeId} is missing.`);
  return { x: mm(point.x), y: mm(point.y) };
}
function rotateVector(x, y, degrees) {
  const angle = degrees * Math.PI / 180; const cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}
function moveProperty(property, oldCenter, nextCenter, oldRotation, nextRotation) {
  const placement = child(property, 'at');
  if (!placement) return;
  const oldAngle = number(property, 'at', 3);
  const local = rotateVector(number(property, 'at', 1) - oldCenter.x, number(property, 'at', 2) - oldCenter.y, -oldRotation);
  const moved = rotateVector(local.x, local.y, nextRotation);
  setChild(property, 'at', coordinateNode(nextCenter.x + moved.x, nextCenter.y + moved.y, oldAngle + nextRotation - oldRotation));
}
function exportKiCadCandidate(sourceText, document) {
  const errors = validateSchematic(document);
  if (errors.length) throw new Error(`Unsupported edit: semantic schematic validation failed. ${errors.join(' ')}`);
  const root = parse(sourceText);
  const native = new Map(children(root, 'symbol').map(item => [propertyValue(item, 'Reference'), item]));
  if (native.size !== document.components.length) throw new Error('Conflict: component count changed outside DemonX; reimport before editing.');
  for (const component of document.components) {
    const symbol = native.get(component.reference);
    if (!symbol || value(symbol, 'lib_id') !== component.libId || value(symbol, 'uuid') !== component.id) throw new Error(`Conflict: native symbol identity for ${component.reference} changed outside DemonX.`);
    const oldX = number(symbol, 'at', 1), oldY = number(symbol, 'at', 2), oldRotation = number(symbol, 'at', 3);
    const nextNativeRotation = (360 - component.rotation) % 360;
    const next = { x: mm(component.x), y: mm(component.y) };
    setChild(symbol, 'at', coordinateNode(next.x, next.y, nextNativeRotation));
    const valueProperty = directProperty(symbol, 'Value');
    if (!valueProperty) throw new Error(`Unsupported native schematic: ${component.reference} has no editable Value property.`);
    valueProperty[2] = component.value;
    for (const property of direct(symbol, 'property')) moveProperty(property, { x: oldX, y: oldY }, next, oldRotation, nextNativeRotation);
  }
  const originalWires = children(root, 'wire');
  const wireNodesById = new Map(originalWires.map(item => [value(item, 'uuid'), item]));
  const firstWire = root.indexOf(originalWires[0]);
  root.splice(0, root.length, ...root.filter(item => !Array.isArray(item) || head(item) !== 'wire'));
  const wireNodes = document.wires.map(wire => {
    const from = nativePointForNode(document, wire.fromNodeId), to = nativePointForNode(document, wire.toNodeId);
    if (coordKey(from.x, from.y) === coordKey(to.x, to.y)) throw new Error(`Unsupported edit: wire ${wire.id} has zero length.`);
    const wireUuid = uuidFromId(wire.id);
    const nativeWire = wireNodesById.get(wireUuid);
    const pts = [atom('pts'), [atom('xy'), atom(from.x), atom(from.y)], [atom('xy'), atom(to.x), atom(to.y)]];
    if (nativeWire) { setChild(nativeWire, 'pts', pts); return nativeWire; }
    return [atom('wire'), pts, [atom('stroke'), [atom('width'), atom('0')], [atom('type'), atom('default')]], [atom('uuid'), wireUuid]];
  });
  const insertion = Math.max(1, Math.min(firstWire < 0 ? root.length : firstWire, root.length));
  root.splice(insertion, 0, ...wireNodes);
  for (const label of children(root, 'label')) {
    const labelId = value(label, 'uuid'); const semantic = document.labels.find(item => item.id === labelId);
    if (!semantic) throw new Error(`Unsupported edit: native label ${labelId || '(unknown)'} was removed from the DemonX model.`);
    const point = nativePointForNode(document, semantic.nodeId);
    setChild(label, 'at', coordinateNode(point.x, point.y, number(label, 'at', 3)));
  }
  if (children(root, 'label').length !== document.labels.length) throw new Error('Unsupported edit: creating or deleting native labels is not supported in this adapter.');
  const output = `${write(root)}\n`;
  const imported = importKiCadSchematic(output);
  if (!sameSemantic(document, imported)) throw new Error(`Candidate round-trip did not preserve the DemonX semantic model; the original remains untouched. Expected ${JSON.stringify(semanticView(document))}; reimported ${JSON.stringify(semanticView(imported))}.`);
  return { text: output, sha256: digest(output), imported };
}
function semanticView(doc) {
  return {
    components: doc.components.map(item => [item.reference, item.libId, item.value, item.x, item.y, item.rotation, item.pins.map(pin => [pin.number, pin.name, pin.x, pin.y, pin.electricalType])]).sort((x,y)=>x[0].localeCompare(y[0])),
    junctions: doc.junctions.map(item => [item.id, item.x, item.y]).sort((x,y)=>x[0].localeCompare(y[0])),
    wires: doc.wires.map(item => [item.fromNodeId, item.toNodeId].sort().join('|')).sort(),
    labels: doc.labels.map(item => [item.name, item.nodeId]).sort((x,y)=>`${x[0]}:${x[1]}`.localeCompare(`${y[0]}:${y[1]}`))
  };
}
function sameSemantic(a, b) { return JSON.stringify(semanticView(a)) === JSON.stringify(semanticView(b)); }
function netGroups(document) { return deriveNets(document).map(net => net.pins.map(pin => `${pin.reference}.${pin.pinNumber}`).sort()).sort((a,b)=>a.join('|').localeCompare(b.join('|'))); }
function parseKicadNetlist(xml) {
  const groups = [];
  for (const match of xml.matchAll(/<net\b[^>]*>([\s\S]*?)<\/net>/gi)) {
    const pins = [...match[1].matchAll(/<node\b([^>]*)\/?\s*>/gi)].map(node => {
      const ref = /\bref="([^"]+)"/i.exec(node[1])?.[1];
      const pin = /\bpin="([^"]+)"/i.exec(node[1])?.[1];
      if (!ref || !pin) throw new Error('KiCad netlist contains an unrecognized node entry.');
      return `${ref}.${pin}`;
    }).sort();
    if (pins.length) groups.push(pins);
  }
  return groups.sort((a,b)=>a.join('|').localeCompare(b.join('|')));
}
function compareNetGroups(expected, actual) {
  const left = expected.map(net => net.join('|')).sort(); const right = actual.map(net => net.join('|')).sort();
  return { matches: JSON.stringify(left) === JSON.stringify(right), expected: left, actual: right,
    missing: left.filter(item => !right.includes(item)), unexpected: right.filter(item => !left.includes(item)) };
}

module.exports = { compareNetGroups, digest, exportKiCadCandidate, importKiCadSchematic, netGroups, parseKicadNetlist, sameSemantic };
