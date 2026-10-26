import Konva from 'konva';
import { cloneDocument, COMPONENT_LIBRARY, findSupplyShorts, pinId, pointForNode, routeSchematicWires, validateSchematic, type SchematicDocument, type SchematicComponent } from './schematic-model';

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
let mode: 'select' | 'wire' = 'select';
let wireStart: string | null = null;
let pointer: { x: number; y: number } | null = null;
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
function updateNativeNote(message?: string) {
  const label = document.getElementById('schematic-sync-state');
  const hash = document.getElementById('schematic-source-hash');
  if (label) label.textContent = message || (documentModel?.nativeSync?.sourceSha256 ? `Edits remain staged until approved · native hash ${documentModel.nativeSync.sourceSha256.slice(0, 12)}` : 'No native revision is linked; editing is disabled until safe import succeeds.');
  if (hash) hash.textContent = documentModel?.nativeSync?.sourceSha256 ? `Native source SHA-256: ${documentModel.nativeSync.sourceSha256}` : 'Native source SHA-256: unavailable';
}
function selected() { return documentModel?.components.find(component => component.id === selectedComponentId) || null; }
function renderProperties() {
  const component = selected();
  const panel = document.getElementById('schematic-properties');
  if (!panel) return;
  if (!component) { panel.innerHTML = '<div class="schematic-property-empty">Select a component to see its details.</div>'; return; }
  const safeValue = document.createElement('input'); safeValue.id = 'schematic-value'; safeValue.value = component.value; safeValue.setAttribute('aria-label', `Value for ${component.reference}`);
  safeValue.addEventListener('change', () => {
    const next = safeValue.value.trim();
    if (!next || next === component.value || !documentModel) return;
    pushHistory(); component.value = next; draw(); setStatus(`${component.reference} value updated. Save a revision, then validate and explicitly approve the KiCad candidate.`);
  });
  panel.replaceChildren();
  const heading = document.createElement('div'); heading.className = 'eyebrow'; heading.textContent = 'SELECTED COMPONENT';
  const title = document.createElement('strong'); title.className = 'schematic-property-title'; title.textContent = `${component.reference} · ${component.libId}`;
  const label = document.createElement('label'); label.className = 'schematic-field'; label.textContent = 'Value'; label.append(safeValue);
  const pinsTitle = document.createElement('div'); pinsTitle.className = 'schematic-property-label'; pinsTitle.textContent = 'Electrical pins';
  const pins = document.createElement('ul'); pins.className = 'schematic-pin-list';
  for (const pin of component.pins) { const item = document.createElement('li'); item.textContent = `${pin.number} · ${pin.name}`; pins.append(item); }
  panel.append(heading, title, label, pinsTitle, pins);
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
  if (mode !== 'wire' || !documentModel) { const match = /^pin:([^:]+):/.exec(nodeId); selectedComponentId = match?.[1] || null; selectedWireId = null; renderProperties(); draw(); return; }
  if (!wireStart) { wireStart = nodeId; setStatus('Choose another pin, or click the grid to place a junction.'); draw(); return; }
  if (wireStart === nodeId) { setStatus('Choose a different pin or junction.'); return; }
  const from = wireStart; wireStart = null; addWire(from, nodeId);
}
function drawGrid(width: number, height: number) {
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
  const designErrors = [...findSupplyShorts(documentModel), ...routed.errors];
  for (const wire of documentModel.wires) {
    const route = routed.routes.find(item => item.wireId === wire.id);
    if (!route) continue;
    const points = route.points.flatMap(point => [point.x * GRID, point.y * GRID]);
    const line = new Konva.Line({ points, stroke: selectedWireId === wire.id ? style.copper : style.wire, strokeWidth: selectedWireId === wire.id ? 3.2 : 2.1, lineCap: 'square', lineJoin: 'miter', hitStrokeWidth: 14, name: 'wire', id: wire.id });
    line.on('click tap', event => { if (mode === 'select') { event.cancelBubble = true; selectedWireId = wire.id; selectedComponentId = null; renderProperties(); draw(); setStatus('Connection selected. Use Delete to disconnect these native pins.'); } });
    layer.add(line);
  }
  for (const junction of documentModel.junctions) {
    const dot = new Konva.Circle({ x: junction.x * GRID, y: junction.y * GRID, radius: 5, fill: style.copper, stroke: style.panel, strokeWidth: 2, name: 'junction', id: junction.id });
    dot.on('click tap', event => { event.cancelBubble = true; if (mode === 'wire') handlePin(junction.id); });
    layer.add(dot);
  }
  for (const label of documentModel.labels) {
    const point = nodeXY(label.nodeId);
    if (point) layer.add(new Konva.Text({ x: point.x - Math.max(38, label.name.length * 7) - 8, y: point.y - 8, width: Math.max(38, label.name.length * 7), align: 'right', text: label.name, fontFamily: 'Consolas, monospace', fontSize: 11, fill: style.copper, listening: false }));
  }
  if (designErrors.length) {
    const warning = new Konva.Label({ x: 12, y: 12, listening: false });
    warning.add(new Konva.Tag({ fill: '#7d2727', cornerRadius: 4, opacity: 0.96 }));
    warning.add(new Konva.Text({ text: `DESIGN ERROR · ${designErrors[0]}`, padding: 8, fill: '#ffffff', fontSize: 12, fontFamily: 'Segoe UI, sans-serif' }));
    layer.add(warning);
  }
  if (wireStart) {
    const a = nodeXY(wireStart);
    if (a && pointer) layer.add(new Konva.Line({ points: [a.x, a.y, snap(pointer.x), a.y, snap(pointer.x), snap(pointer.y)], stroke: style.copper, strokeWidth: 1.6, dash: [5, 4], listening: false, name: 'wire-preview' }));
  }
}
function drawComponent(component: SchematicComponent) {
  if (!layer || !stage) return;
  const style = colors();
  const group = new Konva.Group({ x: component.x * GRID, y: component.y * GRID, rotation: component.rotation, draggable: mode === 'select', name: 'component', id: component.id });
  const selectedNow = selectedComponentId === component.id;
  const outline = selectedNow ? style.copper : style.text;
  const body = new Konva.Group();
  if (component.libId === 'Device:R') body.add(new Konva.Rect({ x: -20, y: -10, width: 40, height: 20, stroke: outline, strokeWidth: 1.8, fill: style.panel }));
  else if (component.libId === 'Device:LED') {
    body.add(new Konva.Line({ points: [-6, -8, -6, 8, 8, 0, -6, -8], stroke: outline, strokeWidth: 1.8, closed: true, fill: style.panel }));
    body.add(new Konva.Line({ points: [9, -9, 9, 9], stroke: outline, strokeWidth: 1.8 }));
    body.add(new Konva.Arrow({ points: [1, -12, 7, -18], pointerLength: 4, pointerWidth: 4, stroke: style.copper, fill: style.copper, strokeWidth: 1.2 }));
    body.add(new Konva.Arrow({ points: [8, -8, 14, -14], pointerLength: 4, pointerWidth: 4, stroke: style.copper, fill: style.copper, strokeWidth: 1.2 }));
  } else body.add(new Konva.Rect({ x: -15, y: -13, width: 30, height: 26, stroke: outline, strokeWidth: 1.8, fill: style.panel }));
  group.add(body);
  const ref = new Konva.Text({ x: -22, y: -34, width: 48, align: 'center', text: component.reference, fontFamily: 'Consolas, monospace', fontSize: 12, fill: style.text, listening: false });
  const value = new Konva.Text({ x: -38, y: 21, width: 76, align: 'center', text: component.value, fontFamily: 'Segoe UI, sans-serif', fontSize: 10, fill: style.muted, listening: false });
  group.add(ref, value);
  for (const pin of component.pins) {
    const pinNode = pinId(component.id, pin.number);
    const dot = new Konva.Circle({ x: pin.x * GRID, y: pin.y * GRID, radius: wireStart === pinNode ? 5.3 : 3.9, fill: wireStart === pinNode ? style.copper : style.wire, stroke: style.panel, strokeWidth: 1.3, name: 'pin', id: pinNode });
    dot.on('mouseenter', () => { if (stage) stage.container().style.cursor = 'crosshair'; setStatus(`${component.reference}.${pin.number} · ${pin.name}`); });
    dot.on('mouseleave', () => { if (stage) stage.container().style.cursor = mode === 'wire' ? 'crosshair' : 'default'; });
    dot.on('click tap', event => { event.cancelBubble = true; handlePin(pinNode); });
    group.add(dot);
    if (showPinNumbers || showPinNames) {
      const identity = [showPinNumbers ? pin.number : '', showPinNames ? pin.name : ''].filter(Boolean).join(' · ');
      group.add(new Konva.Text({ x: pin.x * GRID + 5, y: pin.y * GRID + 4, text: identity, fontFamily: 'Consolas, monospace', fontSize: 9, fill: style.muted, listening: false }));
    }
  }
  group.on('click tap', event => { event.cancelBubble = true; if (mode === 'select') { selectedComponentId = component.id; selectedWireId = null; renderProperties(); draw(); } });
  group.on('dragstart', () => { pushHistory(); });
  group.on('dragmove', () => setStatus(`Moving ${component.reference} · pins remain connected by their IDs.`));
  group.on('dragend', () => {
    component.x = Math.round(group.x() / GRID); component.y = Math.round(group.y() / GRID);
    group.position({ x: component.x * GRID, y: component.y * GRID });
    draw(); setStatus(`${component.reference} placed on the 50 mil grid. Connected wires follow its pins.`);
  });
  layer.add(group);
}
function draw() {
  if (!stage || !layer || !documentModel) return;
  layer.destroyChildren();
  drawGrid(stage.width(), stage.height()); drawWires();
  for (const component of documentModel.components) drawComponent(component);
  layer.batchDraw();
  updateHistoryButtons();
}
function setMode(next: 'select' | 'wire') {
  mode = next; wireStart = null;
  document.getElementById('schematic-select')?.classList.toggle('active', mode === 'select');
  document.getElementById('schematic-wire')?.classList.toggle('active', mode === 'wire');
  if (stage) stage.container().style.cursor = mode === 'wire' ? 'crosshair' : 'default';
  draw();
  setStatus(mode === 'wire' ? 'Wire mode · click a pin, then another pin. Click empty grid after the first pin to place a junction.' : 'Select mode · drag components, click pins to inspect them, or use the toolbar.');
}
function addComponent(libId: string) {
  if (!documentModel) return;
  const definition = COMPONENT_LIBRARY.find(item => item.libId === libId);
  if (!definition) return;
  const prefix = libId === 'Device:R' ? 'R' : libId === 'Device:LED' ? 'D' : 'J';
  let index = 1;
  while (documentModel.components.some(component => component.reference === `${prefix}${index}`)) index++;
  pushHistory();
  const component: SchematicComponent = { id: stableId('component'), libId, reference: `${prefix}${index}`, value: definition.name, x: 50 + index * 2, y: 30, rotation: 0, pins: definition.pins.map(pin => ({ ...pin })) };
  documentModel.components.push(component); selectedComponentId = component.id;
  renderProperties(); draw(); setStatus(`${component.reference} added. Connect its numbered pins using Wire.`);
  (document.getElementById('component-picker') as HTMLDialogElement | null)?.close();
}
function removeSelected() {
  if (selectedWireId && documentModel) {
    const selectedId = selectedWireId;
    if (!documentModel.wires.some(item => item.id === selectedId)) { selectedWireId = null; return; }
    pushHistory(); documentModel.wires = documentModel.wires.filter(item => item.id !== selectedId); selectedWireId = null;
    renderProperties(); draw(); setStatus('Connection removed. KiCad/ERC will not reflect this until a staged candidate passes native validation and you approve commit.'); return;
  }
  if (!documentModel || !selectedComponentId) return;
  const component = selected(); if (!component) return;
  const nodes = new Set(component.pins.map(pin => pinId(component.id, pin.number)));
  pushHistory();
  documentModel.components = documentModel.components.filter(item => item.id !== component.id);
  documentModel.wires = documentModel.wires.filter(wire => !nodes.has(wire.fromNodeId) && !nodes.has(wire.toNodeId));
  documentModel.labels = documentModel.labels.filter(label => !nodes.has(label.nodeId));
  selectedComponentId = null; selectedWireId = null; renderProperties(); draw(); setStatus(`${component.reference} and its attached connections were removed; KiCad remains unchanged.`);
}
function rotateSelected() {
  if (!documentModel) return;
  const component = selected(); if (!component) return;
  pushHistory(); component.rotation = ((component.rotation + 90) % 360) as SchematicComponent['rotation'];
  draw(); setStatus(`${component.reference} rotated. Pin coordinates and wire endpoints were recalculated.`);
}
function undo() {
  if (!documentModel || !history.length) return;
  redoHistory.push(JSON.stringify(documentModel)); documentModel = JSON.parse(history.pop()!) as SchematicDocument;
  selectedComponentId = selectedComponentId && documentModel.components.some(item => item.id === selectedComponentId) ? selectedComponentId : null;
  selectedWireId = selectedWireId && documentModel.wires.some(item => item.id === selectedWireId) ? selectedWireId : null;
  renderProperties(); draw(); setStatus('Undid the last schematic edit.');
}
function redo() {
  if (!documentModel || !redoHistory.length) return;
  history.push(JSON.stringify(documentModel)); documentModel = JSON.parse(redoHistory.pop()!) as SchematicDocument;
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
  stage.on('pointermove', () => { pointer = worldPointer(); if (mode === 'wire' && wireStart) draw(); });
  stage.on('click tap', event => {
    if (event.target !== stage) return;
    const point = worldPointer();
    if (mode === 'wire' && wireStart && point) { placeJunction(point); return; }
    selectedComponentId = null; renderProperties(); draw();
  });
  if (!globalKeysInstalled) {
    globalKeysInstalled = true;
    window.addEventListener('keydown', event => {
      if (event.code === 'Space' && !(event.target instanceof HTMLInputElement)) { spaceDown = true; if (stage) stage.container().style.cursor = 'grab'; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      else if (event.key === 'Escape') { wireStart = null; setMode('select'); }
      else if (event.key === 'Delete' || event.key === 'Backspace') removeSelected();
      else if (event.key.toLowerCase() === 'r' && !(event.target instanceof HTMLInputElement)) rotateSelected();
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
    const issues = [...validateSchematic(documentModel), ...findSupplyShorts(documentModel), ...routeSchematicWires(documentModel).errors];
    if (issues.length) { setStatus(issues.join(' '), true); return; }
    try { const revision = await saveModel(cloneDocument(documentModel)); setStatus(`Saved local DemonX revision ${revision}. Native KiCad checks do not include these edits until a candidate is validated and committed.`); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error), true); }
  });
  document.getElementById('schematic-stage-native')?.addEventListener('click', async () => {
    if (!documentModel || !stageCandidate) return;
    const issues = [...validateSchematic(documentModel), ...findSupplyShorts(documentModel), ...routeSchematicWires(documentModel).errors];
    if (issues.length) { setStatus(issues.join(' '), true); return; }
    try {
      const staged = await stageCandidate(cloneDocument(documentModel));
      if (staged.status === 'PASS') window.dispatchEvent(new CustomEvent('circuit:native-stage-ready', { detail: staged }));
      else window.dispatchEvent(new CustomEvent('circuit:native-stage-failed', { detail: staged }));
      setStatus(staged.message, staged.status !== 'PASS');
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error), true); }
  });
  document.getElementById('schematic-undo')?.addEventListener('click', undo);
  document.getElementById('schematic-redo')?.addEventListener('click', redo);
  document.getElementById('schematic-rotate')?.addEventListener('click', rotateSelected);
  document.getElementById('schematic-delete')?.addEventListener('click', removeSelected);
  document.getElementById('schematic-select')?.addEventListener('click', () => setMode('select'));
  document.getElementById('schematic-wire')?.addEventListener('click', () => setMode('wire'));
  document.getElementById('schematic-add')?.addEventListener('click', () => { searchText = ''; const input = document.getElementById('component-search') as HTMLInputElement | null; if (input) input.value = ''; showComponentChoices(); (document.getElementById('component-picker') as HTMLDialogElement | null)?.showModal(); });
  document.getElementById('component-search')?.addEventListener('input', event => { searchText = (event.target as HTMLInputElement).value.toLowerCase(); showComponentChoices(); });
  document.getElementById('schematic-zoom-in')?.addEventListener('click', () => zoom(1.15));
  document.getElementById('schematic-zoom-out')?.addEventListener('click', () => zoom(0.87));
  document.getElementById('schematic-fit')?.addEventListener('click', fit);
  for (const id of ['schematic-pin-numbers', 'schematic-pin-names']) document.getElementById(id)?.addEventListener('change', event => {
    const target = event.target as HTMLInputElement;
    if (id === 'schematic-pin-numbers') showPinNumbers = target.checked; else showPinNames = target.checked;
    draw();
  });
}
function showComponentChoices() {
  const list = document.getElementById('component-choices'); if (!list) return;
  list.replaceChildren();
  for (const item of COMPONENT_LIBRARY.filter(component => `${component.name} ${component.category} ${component.libId}`.toLowerCase().includes(searchText))) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'component-choice';
    const title = document.createElement('strong'); title.textContent = item.name;
    const detail = document.createElement('small'); detail.textContent = `${item.category} · ${item.libId}`;
    button.append(title, detail); button.addEventListener('click', () => addComponent(item.libId)); list.append(button);
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
  const xs = documentModel.components.map(item => item.x), ys = documentModel.components.map(item => item.y);
  const minX = Math.min(...xs) - 12, maxX = Math.max(...xs) + 12, minY = Math.min(...ys) - 12, maxY = Math.max(...ys) + 12;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(stage.width() / ((maxX - minX) * GRID), stage.height() / ((maxY - minY) * GRID))));
  stage.scale({ x: scale, y: scale }); stage.position({ x: (stage.width() - (maxX + minX) * GRID * scale) / 2, y: (stage.height() - (maxY + minY) * GRID * scale) / 2 }); draw();
}
export function mount(initialDocument: SchematicDocument, save: SaveSchematic, stageCandidateAction: StageNative) {
  const container = document.getElementById('schematic-stage');
  if (!container) throw new Error('Schematic workspace is missing its canvas.');
  const issues = validateSchematic(initialDocument);
  if (issues.length) throw new Error(`This schematic model cannot be opened safely: ${issues.join(' ')}`);
  documentModel = cloneDocument(initialDocument); saveModel = save; stageCandidate = stageCandidateAction; history = []; redoHistory = []; selectedComponentId = null; selectedWireId = null; wireStart = null; mode = 'select';
  if (stage) stage.destroy();
  stage = new Konva.Stage({ container: container as HTMLDivElement, width: container.clientWidth, height: container.clientHeight });
  stage.scale({ x: 0.85, y: 0.85 });
  stage.position({ x: container.clientWidth / 2 - 50 * GRID * 0.85, y: container.clientHeight / 2 - 40 * GRID * 0.85 });
  layer = new Konva.Layer(); stage.add(layer); installToolbar(); installInteractions(); renderProperties(); draw(); updateHistoryButtons(); updateNativeNote();
  setStatus('Imported from the native KiCad schematic. Editor changes remain sidecar revisions until native validation and explicit approval.');
}
