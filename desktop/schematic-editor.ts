import Konva from 'konva';
import { cloneDocument, COMPONENT_LIBRARY, deriveNets, findSupplyShorts, pinId, pointForNode, routeSchematicWires, validateSchematic, type SchematicDocument, type SchematicComponent } from './schematic-model';

const GRID = 20;
const MIN_SCALE = 0.45;
const MAX_SCALE = 2.6;
type SaveSchematic = (document: SchematicDocument) => Promise<string>;
type StageNative = (document: SchematicDocument) => Promise<OperationResult & { stageId?: string; sourceSha256?: string; candidateSha256?: string }>;

let documentModel: SchematicDocument | null = null;
let stage: Konva.Stage | null = null;
let layer: Konva.Layer | null = null;
let selectedComponentId: string | null = null;
let selectedWireId: string | null = null;
let selectedNetNodes = new Set<string>();
let selectedNetWires = new Set<string>();
let mode: 'select' | 'wire' | 'place' = 'select';
let pendingLibId: string | null = null;
let pendingRotation: 0 | 90 | 180 | 270 = 0;
let wireStart: string | null = null;
let pointer: { x: number; y: number } | null = null;
let hoveredNodeId: string | null = null;
let saveModel: SaveSchematic | null = null;
let stageCandidate: StageNative | null = null;
let history: string[] = [];
let redoHistory: string[] = [];
let spaceDown = false;
let searchText = '';
let showPinNumbers = false;
let showPinNames = false;
let toolbarInstalled = false;
let globalKeysInstalled = false;
let savedSnapshot = '';
let gridVisible = true;
let snapEnabled = true;
let savedSidecarRevision = false;
let stagedRevisionCurrent = false;

function updateDirtyState() {
  if (!documentModel) return;
  const dirty = JSON.stringify(documentModel) !== savedSnapshot;
  document.body.dataset.schematicDirty = String(dirty);
  const state = document.getElementById('schematic-revision-state');
  if (state) {
    state.textContent = dirty ? stagedRevisionCurrent ? 'Unsaved DemonX edits · candidate validated, awaiting approval' : 'Unsaved DemonX edits · native file unchanged' : stagedRevisionCurrent ? 'Candidate validated · awaiting review and approval' : savedSidecarRevision ? 'Saved DemonX revision · native schematic not synchronized' : 'Imported native schematic · in sync';
    state.dataset.state = dirty ? 'unsaved' : stagedRevisionCurrent ? 'validated' : savedSidecarRevision ? 'sidecar' : 'synced';
  }
  window.dispatchEvent(new CustomEvent('circuit:schematic-dirty', { detail: dirty }));
}

const colors = () => {
  const css = getComputedStyle(document.body);
  return { grid: css.getPropertyValue('--line').trim() || '#304047', wire: css.getPropertyValue('--accent').trim() || '#0f9da8', text: css.getPropertyValue('--text').trim() || '#e8edef', muted: css.getPropertyValue('--muted').trim() || '#9aa9ae', panel: css.getPropertyValue('--panel2').trim() || '#263238', copper: css.getPropertyValue('--copper').trim() || '#c87940' };
};

function nodeXY(nodeId: string) {
  const point = documentModel && pointForNode(documentModel, nodeId);
  return point ? { x: point.x * GRID, y: point.y * GRID } : null;
}
function worldPointer() {
  if (!stage) return null;
  const position = stage.getPointerPosition();
  if (!position) return null;
  const transform = stage.getAbsoluteTransform().copy().invert();
  return transform.point(position);
}
function snap(n: number) { return Math.round(n / GRID) * GRID; }
function stableId(prefix: string) { return `${prefix}-${crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`; }
function pushHistory() {
  if (!documentModel) return;
  stagedRevisionCurrent = false;
  history.push(JSON.stringify(documentModel));
  if (history.length > 100) history.shift();
  redoHistory = [];
  updateHistoryButtons();
}
function updateHistoryButtons() {
  const undo = document.getElementById('schematic-undo') as HTMLButtonElement | null;
  const redo = document.getElementById('schematic-redo') as HTMLButtonElement | null;
  if (undo) undo.disabled = history.length === 0;
  if (redo) redo.disabled = redoHistory.length === 0;
}
function setStatus(message: string, bad = false) {
  const element = document.getElementById('schematic-status');
  if (element) { element.textContent = message; element.dataset.status = bad ? 'error' : 'normal'; }
}
function schematicIssues(document: SchematicDocument) {
  return [
    ...validateSchematic(document).map(message => `Semantic/model error: ${message}`),
    ...findSupplyShorts(document).map(message => `Electrical connectivity error: ${message}`),
    ...routeSchematicWires(document).errors.map(message => `Visual routing failure: ${message}`),
  ];
}
function updateNativeNote(message?: string) {
  const label = document.getElementById('schematic-sync-state');
  const hash = document.getElementById('schematic-source-hash');
  if (label) label.textContent = message || (documentModel?.nativeSync?.sourceSha256 ? `Edits remain staged until approved · native hash ${documentModel.nativeSync.sourceSha256.slice(0, 12)}` : 'No native revision is linked; editing is disabled until safe import succeeds.');
  if (hash) hash.textContent = documentModel?.nativeSync?.sourceSha256 ? `Native source SHA-256: ${documentModel.nativeSync.sourceSha256}` : 'Native source SHA-256: unavailable';
}
function selected() { return documentModel?.components.find(component => component.id === selectedComponentId) || null; }
function selectNet(nodeId: string | null) {
  selectedNetNodes = new Set(); selectedNetWires = new Set();
  const info = document.getElementById('schematic-net-info');
  if (!documentModel || !nodeId) { if (info) info.textContent = 'Click a wire or pin to highlight its complete net.'; return; }
  const adjacent = new Map<string, Array<{ node: string; wireId: string }>>();
  for (const wire of documentModel.wires) {
    adjacent.set(wire.fromNodeId, [...(adjacent.get(wire.fromNodeId) || []), { node: wire.toNodeId, wireId: wire.id }]);
    adjacent.set(wire.toNodeId, [...(adjacent.get(wire.toNodeId) || []), { node: wire.fromNodeId, wireId: wire.id }]);
  }
  const queue = [nodeId]; selectedNetNodes.add(nodeId);
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of adjacent.get(current) || []) {
      selectedNetWires.add(edge.wireId);
      if (!selectedNetNodes.has(edge.node)) { selectedNetNodes.add(edge.node); queue.push(edge.node); }
    }
  }
  const pins = documentModel.components.flatMap(component => component.pins.filter(pin => selectedNetNodes.has(pinId(component.id, pin.number))).map(pin => `${component.reference}.${pin.number} ${pin.name}`));
  const derived = deriveNets(documentModel).find(net => net.pins.some(pin => selectedNetNodes.has(pinId(pin.componentId, pin.pinNumber))));
  if (info) info.textContent = pins.length ? `${derived?.name || 'Unnamed net'} · ${pins.length} pin${pins.length === 1 ? '' : 's'}\n${pins.join('\n')}` : 'Unconnected wire or junction';
}
function renderProperties() {
  const component = selected();
  const panel = document.getElementById('schematic-properties');
  if (!panel) return;
  if (!component) { panel.innerHTML = '<div class="schematic-property-empty">Select a component, pin, or wire to inspect it.</div>'; return; }
  const safeReference = document.createElement('input'); safeReference.id = 'schematic-reference'; safeReference.value = component.reference; safeReference.setAttribute('aria-label', `Reference for ${component.reference}`);
  safeReference.addEventListener('change', () => {
    const next = safeReference.value.trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(next) || documentModel?.components.some(item => item.id !== component.id && item.reference.toLowerCase() === next.toLowerCase())) { safeReference.value = component.reference; setStatus('Reference must be unique and start with a letter.', true); return; }
    if (next !== component.reference && documentModel) { pushHistory(); component.reference = next; draw(); renderProperties(); setStatus(`Reference changed to ${next}. Save a revision before native validation.`); }
  });
  const safeValue = document.createElement('input'); safeValue.id = 'schematic-value'; safeValue.value = component.value; safeValue.setAttribute('aria-label', `Value for ${component.reference}`);
  safeValue.addEventListener('change', () => {
    const next = safeValue.value.trim();
    if (!next || next === component.value || !documentModel) return;
    pushHistory(); component.value = next; draw(); setStatus(`${component.reference} value updated. Save a revision, then validate and explicitly approve the KiCad candidate.`);
  });
  panel.replaceChildren();
  const heading = document.createElement('div'); heading.className = 'eyebrow'; heading.textContent = 'SELECTED COMPONENT';
  const title = document.createElement('strong'); title.className = 'schematic-property-title'; title.textContent = `${component.reference} · ${component.libId}`;
  const refLabel = document.createElement('label'); refLabel.className = 'schematic-field'; refLabel.textContent = 'Reference'; refLabel.append(safeReference);
  const label = document.createElement('label'); label.className = 'schematic-field'; label.textContent = 'Value'; label.append(safeValue);
  const pinsTitle = document.createElement('div'); pinsTitle.className = 'schematic-property-label'; pinsTitle.textContent = 'Electrical pins';
  const pins = document.createElement('ul'); pins.className = 'schematic-pin-list';
  for (const pin of component.pins) { const item = document.createElement('li'); item.textContent = `${pin.number} · ${pin.name} · ${pin.electricalType}`; pins.append(item); }
  panel.append(heading, title, refLabel, label, pinsTitle, pins);
}
function addWire(fromNodeId: string, toNodeId: string) {
  if (!documentModel || fromNodeId === toNodeId) { setStatus('Choose a different pin or junction.'); return; }
  const from = nodeXY(fromNodeId), to = nodeXY(toNodeId);
  if (!from || !to) { setStatus('That connection point is no longer available.', true); return; }
  pushHistory();
  documentModel.wires.push({ id: stableId('wire'), fromNodeId, toNodeId });
  draw(); setStatus('Wire added. KiCad remains unchanged until candidate validation and explicit commit.');
}
function handlePin(nodeId: string) {
  if (mode !== 'wire' || !documentModel) { const match = /^pin:([^:]+):/.exec(nodeId); selectedComponentId = match?.[1] || null; selectedWireId = null; selectNet(nodeId); renderProperties(); draw(); return; }
  if (!wireStart) { wireStart = nodeId; setStatus('Choose another pin, or click the grid to place a junction.'); draw(); return; }
  if (wireStart === nodeId) { setStatus('Choose a different pin or junction.'); return; }
  const from = wireStart; wireStart = null; addWire(from, nodeId);
}
function drawGrid(width: number, height: number) {
  if (!gridVisible) return;
  const style = colors();
  const grid = new Konva.Group({ listening: false });
  const scale = stage?.scaleX() || 1;
  const visible = stage?.getAbsoluteTransform().copy().invert().point({ x: 0, y: 0 }) || { x: 0, y: 0 };
  const right = visible.x + width / scale, bottom = visible.y + height / scale;
  const startX = Math.floor(visible.x / GRID) * GRID, startY = Math.floor(visible.y / GRID) * GRID;
  for (let x = startX; x <= right; x += GRID) grid.add(new Konva.Line({ points: [x, visible.y, x, bottom], stroke: style.grid, strokeWidth: 0.65 / scale, opacity: 0.72 }));
  for (let y = startY; y <= bottom; y += GRID) grid.add(new Konva.Line({ points: [visible.x, y, right, y], stroke: style.grid, strokeWidth: 0.65 / scale, opacity: 0.72 }));
  layer?.add(grid);
}
function drawWires() {
  if (!documentModel || !layer) return;
  const style = colors();
  const routed = routeSchematicWires(documentModel);
  const electricalErrors = findSupplyShorts(documentModel);
  const routingErrors = routed.errors;
  for (const wire of documentModel.wires) {
    const route = routed.routes.find(item => item.wireId === wire.id);
    if (!route) continue;
    const points = route.points.flatMap(point => [point.x * GRID, point.y * GRID]);
    const highlighted = selectedNetWires.has(wire.id);
    const line = new Konva.Line({ points, stroke: highlighted ? style.copper : style.wire, strokeWidth: highlighted ? 3.5 : 2.1, lineCap: 'square', lineJoin: 'miter', hitStrokeWidth: 14, name: 'wire', id: wire.id });
    line.on('click tap', event => { if (mode === 'select') { event.cancelBubble = true; selectedWireId = wire.id; selectedComponentId = null; selectNet(wire.fromNodeId); renderProperties(); draw(); setStatus('Connected net highlighted. Delete removes only this explicit wire segment.'); } });
    layer.add(line);
  }
  for (const junction of documentModel.junctions) {
    const dot = new Konva.Circle({ x: junction.x * GRID, y: junction.y * GRID, radius: 5, fill: style.copper, stroke: style.panel, strokeWidth: 2, name: 'junction', id: junction.id });
    dot.on('click tap', event => { event.cancelBubble = true; if (mode === 'wire') handlePin(junction.id); else { selectNet(junction.id); selectedComponentId = null; selectedWireId = null; renderProperties(); draw(); } });
    layer.add(dot);
  }
  for (const label of documentModel.labels) {
    const point = nodeXY(label.nodeId);
    if (point) layer.add(new Konva.Text({ x: point.x - Math.max(38, label.name.length * 7) - 8, y: point.y - 8, width: Math.max(38, label.name.length * 7), align: 'right', text: label.name, fontFamily: 'Consolas, monospace', fontSize: 11, fill: style.copper, listening: false }));
  }
  for (const [index, error] of electricalErrors.entries()) {
    const warning = new Konva.Label({ x: 12, y: 12 + index * 32, listening: false });
    warning.add(new Konva.Tag({ fill: '#7d2727', cornerRadius: 4, opacity: 0.96 }));
    warning.add(new Konva.Text({ text: `ELECTRICAL CONNECTIVITY ERROR · ${error}`, padding: 8, fill: '#ffffff', fontSize: 12, fontFamily: 'Segoe UI, sans-serif' }));
    layer.add(warning);
  }
  for (const [index, error] of routingErrors.entries()) {
    const warning = new Konva.Label({ x: 12, y: 12 + (electricalErrors.length + index) * 32, listening: false });
    warning.add(new Konva.Tag({ fill: '#8b5a21', cornerRadius: 4, opacity: 0.96 }));
    warning.add(new Konva.Text({ text: `VISUAL ROUTING FAILURE · ${error}`, padding: 8, fill: '#ffffff', fontSize: 12, fontFamily: 'Segoe UI, sans-serif' }));
    layer.add(warning);
  }
  if (wireStart) {
    const a = nodeXY(wireStart);
    const snappedPin = snapEnabled && hoveredNodeId ? nodeXY(hoveredNodeId) : null;
    const end = snappedPin || (pointer ? { x: snap(pointer.x), y: snap(pointer.y) } : null);
    if (a && end) layer.add(new Konva.Line({ points: [a.x, a.y, end.x, a.y, end.x, end.y], stroke: style.copper, strokeWidth: 1.8, dash: [5, 4], listening: false, name: 'wire-preview' }));
  }
}
function drawComponent(component: SchematicComponent) {
  if (!layer || !stage) return;
  const style = colors();
  const scale = stage.scaleX() || 1;
  const group = new Konva.Group({ x: component.x * GRID, y: component.y * GRID, rotation: component.rotation, draggable: mode === 'select', name: 'component', id: component.id });
  const selectedNow = selectedComponentId === component.id;
  const outline = selectedNow ? style.copper : style.text;
  const body = new Konva.Group();
  if (component.libId === 'Device:R') {
    body.add(new Konva.Line({ points: [0, -60, 0, -10], stroke: outline, strokeWidth: 1.8 / scale }));
    body.add(new Konva.Rect({ x: -20, y: -10, width: 40, height: 20, stroke: outline, strokeWidth: 1.8 / scale, fill: style.panel }));
    body.add(new Konva.Line({ points: [0, 10, 0, 60], stroke: outline, strokeWidth: 1.8 / scale }));
  }
  else if (component.libId === 'Device:LED') {
    body.add(new Konva.Line({ points: [-60, 0, -6, 0], stroke: outline, strokeWidth: 1.8 / scale }));
    body.add(new Konva.Line({ points: [-6, -8, -6, 8, 8, 0, -6, -8], stroke: outline, strokeWidth: 1.8 / scale, closed: true, fill: style.panel }));
    body.add(new Konva.Line({ points: [9, -9, 9, 9], stroke: outline, strokeWidth: 1.8 / scale }));
    body.add(new Konva.Line({ points: [9, 0, 60, 0], stroke: outline, strokeWidth: 1.8 / scale }));
    body.add(new Konva.Arrow({ points: [1, -12, 7, -18], pointerLength: 4, pointerWidth: 4, stroke: style.copper, fill: style.copper, strokeWidth: 1.2 / scale }));
    body.add(new Konva.Arrow({ points: [8, -8, 14, -14], pointerLength: 4, pointerWidth: 4, stroke: style.copper, fill: style.copper, strokeWidth: 1.2 / scale }));
  } else {
    body.add(new Konva.Line({ points: [-80, 0, -15, 0, -15, -13], stroke: outline, strokeWidth: 1.8 / scale }));
    body.add(new Konva.Rect({ x: -15, y: -13, width: 30, height: 26, cornerRadius: 3, stroke: outline, strokeWidth: 1.8 / scale, fill: style.panel }));
    body.add(new Konva.Text({ x: -15, y: -6, width: 30, align: 'center', text: '2', fontSize: 10 / scale, fill: style.muted }));
    body.add(new Konva.Line({ points: [-80, 40, -15, 40, -15, 13], stroke: outline, strokeWidth: 1.8 / scale }));
  }
  group.add(body);
  const ref = new Konva.Text({ x: -30, y: -40, width: 60, align: 'center', text: component.reference, fontFamily: 'Consolas, monospace', fontSize: 12 / scale, fill: style.text, listening: false });
  const value = new Konva.Text({ x: -48, y: 23, width: 96, align: 'center', text: component.value, fontFamily: 'Segoe UI, sans-serif', fontSize: 10 / scale, fill: style.muted, listening: false });
  const annotations = new Konva.Group({ rotation: -component.rotation, listening: false });
  annotations.add(ref, value);
  group.add(annotations);
  for (const pin of component.pins) {
    const pinNode = pinId(component.id, pin.number);
    const dot = new Konva.Circle({ x: pin.x * GRID, y: pin.y * GRID, radius: (wireStart === pinNode || selectedNetNodes.has(pinNode) ? 5.3 : 3.9) / scale, fill: wireStart === pinNode ? style.copper : selectedNetNodes.has(pinNode) ? style.copper : style.wire, stroke: style.panel, strokeWidth: 1.3 / scale, name: 'pin', id: pinNode });
    dot.on('mouseenter', () => { hoveredNodeId = pinNode; dot.radius(6 / scale); dot.stroke(style.copper); dot.strokeWidth(2 / scale); if (stage) stage.container().style.cursor = mode === 'place' ? 'copy' : 'crosshair'; setStatus(`Snap point · ${component.reference}.${pin.number} · ${pin.name} · ${pin.electricalType}`); });
    dot.on('mouseleave', () => { hoveredNodeId = null; dot.radius((wireStart === pinNode || selectedNetNodes.has(pinNode) ? 5.3 : 3.9) / scale); dot.stroke(style.panel); dot.strokeWidth(1.3 / scale); if (stage) stage.container().style.cursor = mode === 'wire' ? 'crosshair' : mode === 'place' ? 'copy' : 'default'; });
    dot.on('click tap', event => { event.cancelBubble = true; handlePin(pinNode); });
    group.add(dot);
    if (showPinNumbers || showPinNames) {
      const identity = [showPinNumbers ? pin.number : '', showPinNames ? pin.name : ''].filter(Boolean).join(' · ');
      annotations.add(new Konva.Text({ x: pin.x * GRID + 7 / scale, y: pin.y * GRID + 4 / scale, text: identity, fontFamily: 'Consolas, monospace', fontSize: 9 / scale, fill: style.muted, listening: false }));
    }
  }
  group.on('click tap', event => { event.cancelBubble = true; if (mode === 'select') { selectedComponentId = component.id; selectedWireId = null; selectNet(null); renderProperties(); draw(); } });
  group.on('dragstart', () => { pushHistory(); });
  group.on('dragmove', () => setStatus(`Moving ${component.reference} · pins remain connected by their IDs.`));
  group.on('dragend', () => {
    component.x = Math.round(group.x() / GRID); component.y = Math.round(group.y() / GRID);
    group.position({ x: component.x * GRID, y: component.y * GRID });
    draw(); setStatus(`${component.reference} placed on the 50 mil grid. Connected wires follow its pins.`);
  });
  layer.add(group);
}
function drawPlacementPreview() {
  if (!layer || !stage || !documentModel || mode !== 'place' || !pendingLibId || !pointer) return;
  const definition = COMPONENT_LIBRARY.find(item => item.libId === pendingLibId);
  if (!definition) return;
  const style = colors();
  const position = snapEnabled ? { x: snap(pointer.x), y: snap(pointer.y) } : pointer;
  const ghost = new Konva.Group({ x: position.x, y: position.y, rotation: pendingRotation, opacity: 0.56, listening: false, name: 'placement-preview' });
  if (pendingLibId === 'Device:R') {
    ghost.add(new Konva.Line({ points: [0, -60, 0, -10], stroke: style.copper, strokeWidth: 2 }));
    ghost.add(new Konva.Rect({ x: -20, y: -10, width: 40, height: 20, stroke: style.copper, strokeWidth: 2, fill: style.panel }));
    ghost.add(new Konva.Line({ points: [0, 10, 0, 60], stroke: style.copper, strokeWidth: 2 }));
  }
  else if (pendingLibId === 'Device:LED') {
    ghost.add(new Konva.Line({ points: [-60, 0, -6, 0], stroke: style.copper, strokeWidth: 2 }));
    ghost.add(new Konva.Line({ points: [-6, -8, -6, 8, 8, 0, -6, -8], stroke: style.copper, strokeWidth: 2, closed: true, fill: style.panel }));
    ghost.add(new Konva.Line({ points: [9, -9, 9, 9], stroke: style.copper, strokeWidth: 2 }));
    ghost.add(new Konva.Line({ points: [9, 0, 60, 0], stroke: style.copper, strokeWidth: 2 }));
    ghost.add(new Konva.Arrow({ points: [1, -12, 7, -18], pointerLength: 4, pointerWidth: 4, stroke: style.copper, fill: style.copper, strokeWidth: 1.2 }));
    ghost.add(new Konva.Arrow({ points: [8, -8, 14, -14], pointerLength: 4, pointerWidth: 4, stroke: style.copper, fill: style.copper, strokeWidth: 1.2 }));
  } else {
    ghost.add(new Konva.Line({ points: [-80, 0, -15, 0, -15, -13], stroke: style.copper, strokeWidth: 2 }));
    ghost.add(new Konva.Rect({ x: -15, y: -13, width: 30, height: 26, cornerRadius: 3, stroke: style.copper, strokeWidth: 2, fill: style.panel }));
    ghost.add(new Konva.Line({ points: [-80, 40, -15, 40, -15, 13], stroke: style.copper, strokeWidth: 2 }));
    ghost.add(new Konva.Text({ x: -15, y: -6, width: 30, align: 'center', text: '2', fontSize: 10, fill: style.text }));
  }
  ghost.add(new Konva.Text({ x: -42, y: 25, width: 84, align: 'center', text: `${nextReference(pendingLibId)} · ${definition.name} · ${pendingRotation}°`, fontSize: 10, fill: style.text }));
  layer.add(ghost);
}

function draw() {
  if (!stage || !layer || !documentModel) return;
  layer.destroyChildren();
  drawGrid(stage.width(), stage.height()); drawWires();
  for (const component of documentModel.components) drawComponent(component);
  drawPlacementPreview();
  layer.batchDraw();
  updateHistoryButtons();
  updateDirtyState();
}
function setMode(next: 'select' | 'wire' | 'place') {
  mode = next; wireStart = null;
  if (next !== 'place') pendingLibId = null;
  document.getElementById('schematic-select')?.classList.toggle('active', mode === 'select');
  document.getElementById('schematic-wire')?.classList.toggle('active', mode === 'wire');
  document.getElementById('schematic-add')?.classList.toggle('active', mode === 'place');
  if (stage) stage.container().style.cursor = mode === 'wire' ? 'crosshair' : mode === 'place' ? 'copy' : 'default';
  draw();
  setStatus(mode === 'wire' ? 'Wire mode · click a pin, then another pin. Click empty grid after the first pin to place a junction.' : mode === 'place' ? 'Component placement mode · click once to place or Esc to cancel.' : 'Select mode · drag components, click pins to inspect them, or use the toolbar.');
}
function nextReference(libId: string) {
  if (!documentModel) return libId === 'Device:R' ? 'R1' : libId === 'Device:LED' ? 'D1' : 'J1';
  const prefix = libId === 'Device:R' ? 'R' : libId === 'Device:LED' ? 'D' : 'J';
  let index = 1;
  while (documentModel.components.some(component => component.reference === `${prefix}${index}`)) index++;
  return `${prefix}${index}`;
}
function beginPlacement(libId: string) {
  if (!documentModel) return;
  const definition = COMPONENT_LIBRARY.find(item => item.libId === libId);
  if (!definition) return;
  pendingLibId = libId; pendingRotation = 0; selectedComponentId = null; selectedWireId = null; selectNet(null); setMode('place'); stage?.container().focus();
  setStatus(`${definition.name} preview attached to cursor · click once to place ${nextReference(libId)}, or Esc to cancel.`);
  (document.getElementById('component-picker') as HTMLDialogElement | null)?.close();
}
function placePending(point = pointer) {
  if (!documentModel || !pendingLibId || !point) return;
  const definition = COMPONENT_LIBRARY.find(item => item.libId === pendingLibId);
  if (!definition) return;
  const x = Math.round((snapEnabled ? snap(point.x) : point.x) / GRID), y = Math.round((snapEnabled ? snap(point.y) : point.y) / GRID);
  const libId = pendingLibId;
  pushHistory();
  const component: SchematicComponent = { id: stableId('component'), libId, reference: nextReference(libId), value: definition.name, x, y, rotation: pendingRotation, pins: definition.pins.map(pin => ({ ...pin })) };
  documentModel.components.push(component); selectedComponentId = component.id;
  pendingLibId = null; setMode('select'); renderProperties(); draw(); setStatus(`${component.reference} placed. Placement ended after one click; use Component to add another.`);
}
function removeSelected() {
  if (selectedWireId && documentModel) {
    const selectedId = selectedWireId;
    if (!documentModel.wires.some(item => item.id === selectedId)) { selectedWireId = null; return; }
    pushHistory(); documentModel.wires = documentModel.wires.filter(item => item.id !== selectedId); selectedWireId = null; selectNet(null);
    renderProperties(); draw(); setStatus('Connection removed. KiCad/ERC will not reflect this until a staged candidate passes native validation and you approve commit.'); return;
  }
  if (!documentModel || !selectedComponentId) return;
  const component = selected(); if (!component) return;
  const nodes = new Set(component.pins.map(pin => pinId(component.id, pin.number)));
  pushHistory();
  documentModel.components = documentModel.components.filter(item => item.id !== component.id);
  documentModel.wires = documentModel.wires.filter(wire => !nodes.has(wire.fromNodeId) && !nodes.has(wire.toNodeId));
  documentModel.labels = documentModel.labels.filter(label => !nodes.has(label.nodeId));
  selectedComponentId = null; selectedWireId = null; selectNet(null); renderProperties(); draw(); setStatus(`${component.reference} and its attached connections were removed; KiCad remains unchanged.`);
}
function rotateSelected() {
  if (mode === 'place' && pendingLibId) { pendingRotation = ((pendingRotation + 90) % 360) as 0 | 90 | 180 | 270; draw(); setStatus(`Placement preview rotated to ${pendingRotation}°. Click once to place, or Esc to cancel.`); return; }
  if (!documentModel) return;
  const component = selected(); if (!component) return;
  pushHistory(); component.rotation = ((component.rotation + 90) % 360) as SchematicComponent['rotation'];
  draw(); setStatus(`${component.reference} rotated. Pin coordinates and wire endpoints were recalculated.`);
}
function undo() {
  if (!documentModel || !history.length) return;
  redoHistory.push(JSON.stringify(documentModel)); documentModel = JSON.parse(history.pop()!) as SchematicDocument; selectNet(null);
  selectedComponentId = selectedComponentId && documentModel.components.some(item => item.id === selectedComponentId) ? selectedComponentId : null;
  selectedWireId = selectedWireId && documentModel.wires.some(item => item.id === selectedWireId) ? selectedWireId : null;
  renderProperties(); draw(); setStatus('Undid the last schematic edit.');
}
function redo() {
  if (!documentModel || !redoHistory.length) return;
  history.push(JSON.stringify(documentModel)); documentModel = JSON.parse(redoHistory.pop()!) as SchematicDocument; selectNet(null);
  renderProperties(); draw(); setStatus('Restored the last undone schematic edit.');
}
function placeJunction(point: { x: number; y: number }) {
  if (!documentModel || !wireStart) return;
  const snappedX = snap(point.x) / GRID, snappedY = snap(point.y) / GRID;
  const existing = documentModel.junctions.find(junction => junction.x === snappedX && junction.y === snappedY);
  const junction = existing || { id: stableId('junction'), x: snappedX, y: snappedY };
  pushHistory(); if (!existing) documentModel.junctions.push(junction);
  documentModel.wires.push({ id: stableId('wire'), fromNodeId: wireStart, toNodeId: junction.id });
  wireStart = junction.id; draw(); setStatus('Junction added. Other wires must end on this junction to join the same net.');
}
function installInteractions() {
  if (!stage) return;
  stage.on('wheel', event => {
    event.evt.preventDefault();
    const oldScale = stage!.scaleX(), pointerPosition = stage!.getPointerPosition();
    if (!pointerPosition) return;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, oldScale * (event.evt.deltaY > 0 ? 0.92 : 1.08)));
    const point = { x: (pointerPosition.x - stage!.x()) / oldScale, y: (pointerPosition.y - stage!.y()) / oldScale };
    stage!.scale({ x: scale, y: scale }); stage!.position({ x: pointerPosition.x - point.x * scale, y: pointerPosition.y - point.y * scale }); draw();
  });
  stage.on('mousedown touchstart', event => {
    if (event.target !== stage || (!spaceDown && event.evt.button !== 1)) return;
    stage!.draggable(true); stage!.startDrag();
  });
  stage.on('mouseup touchend', () => stage!.draggable(false));
  stage.on('pointermove', () => { pointer = worldPointer(); if ((mode === 'wire' && wireStart) || mode === 'place') draw(); });
  stage.on('click tap', event => {
    if (event.target !== stage) return;
    const point = worldPointer();
    if (mode === 'place' && pendingLibId && point) { placePending(point); return; }
    if (mode === 'wire' && wireStart && point) { placeJunction(point); return; }
    selectedComponentId = null; selectedWireId = null; selectNet(null); renderProperties(); draw();
  });
  if (!globalKeysInstalled) {
    globalKeysInstalled = true;
    window.addEventListener('keydown', event => {
      const target = event.target;
      const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);
      if (event.code === 'Space' && !editing) { event.preventDefault(); spaceDown = true; if (stage) stage.container().style.cursor = 'grab'; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      else if (event.key === 'Escape' && !editing) { event.preventDefault(); wireStart = null; pendingLibId = null; selectedComponentId = null; selectedWireId = null; selectNet(null); setMode('select'); renderProperties(); setStatus('Operation cancelled.'); }
      else if (!editing && event.key === 'Delete') removeSelected();
      else if (!editing && event.key.toLowerCase() === 'r') rotateSelected();
      else if (!editing && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'v') setMode('select');
      else if (!editing && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'w') setMode('wire');
      else if (!editing && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'a') openComponentPicker();
      else if (!editing && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'f') fit();
      else if (event.key === '?' || (event.shiftKey && event.key === '/')) (document.getElementById('schematic-shortcuts-dialog') as HTMLDialogElement | null)?.showModal();
    });
    window.addEventListener('keyup', event => { if (event.code === 'Space') { spaceDown = false; if (stage) stage.container().style.cursor = mode === 'wire' ? 'crosshair' : 'default'; } });
    window.addEventListener('resize', resize);
  }
}
function resize() {
  if (!stage) return;
  const container = document.getElementById('schematic-stage'); if (!container) return;
  stage.size({ width: Math.max(320, container.clientWidth), height: Math.max(280, container.clientHeight) }); draw();
}
function installToolbar() {
  if (toolbarInstalled) return;
  toolbarInstalled = true;
  document.getElementById('schematic-back')?.addEventListener('click', () => { wireStart = null; document.getElementById('schematic-workspace')?.classList.add('hidden'); document.getElementById('welcome')?.classList.remove('hidden'); document.getElementById('workspace-grid')?.classList.remove('hidden'); });
  document.getElementById('schematic-save')?.addEventListener('click', async () => {
    if (!documentModel || !saveModel) return;
    const issues = schematicIssues(documentModel);
    if (issues.length) { setStatus(issues.join(' '), true); return; }
    try { const revision = await saveModel(cloneDocument(documentModel)); savedSnapshot = JSON.stringify(documentModel); savedSidecarRevision = true; stagedRevisionCurrent = false; updateDirtyState(); setStatus(`Saved local DemonX revision ${revision}. Native KiCad checks do not include these edits until a candidate is validated and committed.`); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error), true); }
  });
  document.getElementById('schematic-stage-native')?.addEventListener('click', async () => {
    if (!documentModel || !stageCandidate) return;
    const issues = schematicIssues(documentModel);
    if (issues.length) { setStatus(issues.join(' '), true); return; }
    try {
      const staged = await stageCandidate(cloneDocument(documentModel));
      if (staged.status === 'PASS') { stagedRevisionCurrent = true; window.dispatchEvent(new CustomEvent('circuit:native-stage-ready', { detail: staged })); }
      else window.dispatchEvent(new CustomEvent('circuit:native-stage-failed', { detail: staged }));
      updateDirtyState();
      setStatus(staged.message, staged.status !== 'PASS');
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error), true); }
  });
  document.getElementById('schematic-undo')?.addEventListener('click', undo);
  document.getElementById('schematic-redo')?.addEventListener('click', redo);
  document.getElementById('schematic-rotate')?.addEventListener('click', rotateSelected);
  document.getElementById('schematic-delete')?.addEventListener('click', removeSelected);
  document.getElementById('schematic-select')?.addEventListener('click', () => setMode('select'));
  document.getElementById('schematic-wire')?.addEventListener('click', () => setMode('wire'));
  document.getElementById('schematic-add')?.addEventListener('click', openComponentPicker);
  document.getElementById('component-search')?.addEventListener('input', event => { searchText = (event.target as HTMLInputElement).value.toLowerCase(); showComponentChoices(); });
  document.getElementById('schematic-zoom-in')?.addEventListener('click', () => zoom(1.15));
  document.getElementById('schematic-zoom-out')?.addEventListener('click', () => zoom(0.87));
  document.getElementById('schematic-fit')?.addEventListener('click', fit);
  document.getElementById('schematic-reset-view')?.addEventListener('click', resetView);
  document.getElementById('schematic-shortcuts')?.addEventListener('click', () => (document.getElementById('schematic-shortcuts-dialog') as HTMLDialogElement | null)?.showModal());
  document.getElementById('schematic-grid-visible')?.addEventListener('change', event => { gridVisible = (event.target as HTMLInputElement).checked; localStorage.setItem('demonxCircuit.schematicGrid', String(gridVisible)); draw(); });
  document.getElementById('schematic-snap')?.addEventListener('change', event => { snapEnabled = (event.target as HTMLInputElement).checked; localStorage.setItem('demonxCircuit.schematicSnap', String(snapEnabled)); draw(); setStatus(snapEnabled ? 'Snap guide on · model coordinates use the supported 50 mil grid.' : 'Snap guide off · committed model coordinates remain quantized to the supported 50 mil grid.'); });
  for (const id of ['schematic-pin-numbers', 'schematic-pin-names']) document.getElementById(id)?.addEventListener('change', event => {
    const target = event.target as HTMLInputElement;
    if (id === 'schematic-pin-numbers') showPinNumbers = target.checked; else showPinNames = target.checked;
    draw();
  });
}
function openComponentPicker() {
  setMode('select'); searchText = '';
  const input = document.getElementById('component-search') as HTMLInputElement | null;
  if (input) input.value = '';
  showComponentChoices(); (document.getElementById('component-picker') as HTMLDialogElement | null)?.showModal();
  input?.focus();
}
function showComponentChoices() {
  const list = document.getElementById('component-choices'); if (!list) return;
  list.replaceChildren();
  for (const item of COMPONENT_LIBRARY.filter(component => `${component.name} ${component.category} ${component.libId} ${nextReference(component.libId)} ${documentModel?.components.filter(current => current.libId === component.libId).map(current => current.reference).join(' ') || ''}`.toLowerCase().includes(searchText))) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'component-choice';
    const preview = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); preview.setAttribute('viewBox', '-30 -24 60 48'); preview.setAttribute('aria-hidden', 'true'); preview.classList.add('component-symbol-preview');
    const addShape = (tag: string, attrs: Record<string, string>) => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); preview.append(node); };
    const stroke = 'currentColor';
    if (item.libId === 'Device:R') { addShape('line', { x1: '-28', y1: '0', x2: '-14', y2: '0', stroke, 'stroke-width': '2' }); addShape('rect', { x: '-14', y: '-8', width: '28', height: '16', fill: 'none', stroke, 'stroke-width': '2' }); addShape('line', { x1: '14', y1: '0', x2: '28', y2: '0', stroke, 'stroke-width': '2' }); }
    else if (item.libId === 'Device:LED') { addShape('line', { x1: '-28', y1: '0', x2: '-6', y2: '0', stroke, 'stroke-width': '2' }); addShape('path', { d: 'M-6 -11 L10 0 L-6 11 Z', fill: 'none', stroke, 'stroke-width': '2' }); addShape('line', { x1: '12', y1: '-11', x2: '12', y2: '11', stroke, 'stroke-width': '2' }); addShape('line', { x1: '4', y1: '-13', x2: '12', y2: '-21', stroke, 'stroke-width': '2' }); addShape('path', { d: 'M9 -21 L12 -21 L12 -18', fill: 'none', stroke, 'stroke-width': '2' }); addShape('line', { x1: '12', y1: '-8', x2: '20', y2: '-16', stroke, 'stroke-width': '2' }); addShape('path', { d: 'M17 -16 L20 -16 L20 -13', fill: 'none', stroke, 'stroke-width': '2' }); addShape('line', { x1: '12', y1: '0', x2: '28', y2: '0', stroke, 'stroke-width': '2' }); }
    else { addShape('line', { x1: '-28', y1: '-10', x2: '-16', y2: '-10', stroke, 'stroke-width': '2' }); addShape('rect', { x: '-16', y: '-15', width: '32', height: '30', rx: '3', fill: 'none', stroke, 'stroke-width': '2' }); addShape('text', { x: '0', y: '4', fill: stroke, 'text-anchor': 'middle', 'font-size': '11' }); preview.lastElementChild!.textContent = '2'; addShape('line', { x1: '16', y1: '-10', x2: '28', y2: '-10', stroke, 'stroke-width': '2' }); addShape('line', { x1: '-28', y1: '10', x2: '-16', y2: '10', stroke, 'stroke-width': '2' }); addShape('line', { x1: '16', y1: '10', x2: '28', y2: '10', stroke, 'stroke-width': '2' }); }
    const title = document.createElement('strong'); title.textContent = item.name;
    const detail = document.createElement('small'); detail.textContent = `${item.category} · ${item.libId}`;
    button.append(preview, title, detail); button.addEventListener('click', () => beginPlacement(item.libId)); list.append(button);
  }
  if (!list.childElementCount) list.innerHTML = '<div class="list-empty">No component matches that search.</div>';
}
function zoom(factor: number) {
  if (!stage) return;
  const old = stage.scaleX(), next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, old * factor));
  const center = { x: stage.width() / 2, y: stage.height() / 2 };
  const point = { x: (center.x - stage.x()) / old, y: (center.y - stage.y()) / old };
  stage.scale({ x: next, y: next }); stage.position({ x: center.x - point.x * next, y: center.y - point.y * next }); draw();
}
function fit() {
  if (!stage || !documentModel) return;
  const points = documentModel.components.map(item => ({ x: item.x, y: item.y }));
  const routed = routeSchematicWires(documentModel);
  for (const route of routed.routes) points.push(...route.points);
  for (const label of documentModel.labels) { const point = pointForNode(documentModel, label.nodeId); if (point) points.push(point); }
  if (!points.length) return;
  const minX = Math.min(...points.map(point => point.x)) - 8, maxX = Math.max(...points.map(point => point.x)) + 8;
  const minY = Math.min(...points.map(point => point.y)) - 8, maxY = Math.max(...points.map(point => point.y)) + 8;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(stage.width() / ((maxX - minX) * GRID), stage.height() / ((maxY - minY) * GRID))));
  stage.scale({ x: scale, y: scale }); stage.position({ x: (stage.width() - (maxX + minX) * GRID * scale) / 2, y: (stage.height() - (maxY + minY) * GRID * scale) / 2 }); draw();
}
function resetView() {
  if (!stage || !documentModel) return;
  const xs = documentModel.components.map(item => item.x), ys = documentModel.components.map(item => item.y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2, centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const scale = 0.85;
  stage.scale({ x: scale, y: scale }); stage.position({ x: stage.width() / 2 - centerX * GRID * scale, y: stage.height() / 2 - centerY * GRID * scale }); draw();
}
export function mount(initialDocument: SchematicDocument, save: SaveSchematic, stageCandidateAction: StageNative) {
  const container = document.getElementById('schematic-stage');
  if (!container) throw new Error('Schematic workspace is missing its canvas.');
  const issues = validateSchematic(initialDocument);
  if (issues.length) throw new Error(`This schematic model cannot be opened safely: ${issues.join(' ')}`);
  documentModel = cloneDocument(initialDocument); savedSnapshot = JSON.stringify(documentModel); savedSidecarRevision = false; stagedRevisionCurrent = false; saveModel = save; stageCandidate = stageCandidateAction; history = []; redoHistory = []; selectedComponentId = null; selectedWireId = null; selectedNetNodes = new Set(); selectedNetWires = new Set(); wireStart = null; hoveredNodeId = null; pendingLibId = null; pendingRotation = 0; mode = 'select';
  gridVisible = localStorage.getItem('demonxCircuit.schematicGrid') !== 'false'; snapEnabled = localStorage.getItem('demonxCircuit.schematicSnap') !== 'false';
  const gridToggle = document.getElementById('schematic-grid-visible') as HTMLInputElement | null; if (gridToggle) gridToggle.checked = gridVisible;
  const snapToggle = document.getElementById('schematic-snap') as HTMLInputElement | null; if (snapToggle) snapToggle.checked = snapEnabled;
  if (stage) stage.destroy();
  stage = new Konva.Stage({ container: container as HTMLDivElement, width: container.clientWidth, height: container.clientHeight });
  stage.container().tabIndex = 0;
  stage.scale({ x: 0.85, y: 0.85 });
  stage.position({ x: container.clientWidth / 2 - 50 * GRID * 0.85, y: container.clientHeight / 2 - 40 * GRID * 0.85 });
  layer = new Konva.Layer(); stage.add(layer); installToolbar(); installInteractions(); renderProperties(); draw(); updateHistoryButtons(); updateNativeNote();
  setStatus('Imported from the native KiCad schematic. Editor changes remain sidecar revisions until native validation and explicit approval.');
}
