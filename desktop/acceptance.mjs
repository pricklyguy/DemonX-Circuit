#!/usr/bin/env node
// Launches the extracted portable Windows package and drives its real renderer
// through Chromium DevTools Protocol. Native file dialogs are redirected to a
// fresh temporary project root in the test process only; project creation and
// manifest I/O still run through the packaged app's normal main-process code.
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const executable = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node desktop/acceptance.mjs <portable-exe> <artifact-dir>');
const require = createRequire(import.meta.url);
const packageAdapter = require(join(dirname(executable), 'resources', 'app', 'desktop', 'kicad-schematic-adapter.cjs'));
const artifactDir = resolve(process.argv[3] || 'reports/desktop-acceptance');
await mkdir(artifactDir, { recursive: true });
const workDir = await mkdtemp(join(tmpdir(), 'demonx-circuit-acceptance-'));
const projectRoot = join(workDir, 'DemonX Circuit Projects');
const missingToolsProjectRoot = join(workDir, 'No KiCad Available');
const userData = join(workDir, 'user-data');
const fixtureDir = join(dirname(executable), 'resources', 'app', 'examples', 'esp32-sensor');
const hasFixture = existsSync(join(fixtureDir, 'native', 'DX_ESP32_Sensor.kicad_pcb'));
await mkdir(projectRoot, { recursive: true });
const port = 24000 + Math.floor(Math.random() * 12000);
const report = { executable: basename(executable), checks: [], notTested: [], diagnostics: [], screenshots: [], unhandled: [] };
let child;
let socket;
let acceptanceStage = 'initialization';
const acceptanceWatchdog = setTimeout(async () => {
  const error = `Packaged Windows acceptance exceeded 15 minutes; last stage: ${acceptanceStage}`;
  report.fatal = error;
  report.diagnostics.push({ kind: 'acceptance-watchdog', text: error });
  report.endedAt = new Date().toISOString();
  try { await writeFile(join(artifactDir, 'acceptance-report.json'), JSON.stringify(report, null, 2)); } catch {}
  console.error(error);
  process.exit(124);
}, 15 * 60 * 1000);
function markStage(stage) {
  acceptanceStage = stage;
  console.log(`[acceptance] ${new Date().toISOString()} ${stage}`);
}
let nextId = 1;
const pending = new Map();

function pass(name, evidence) { report.checks.push({ name, result: 'PASS', evidence }); }
function fail(name, evidence) { report.checks.push({ name, result: 'FAIL', evidence }); }
function check(name, condition, evidence) { condition ? pass(name, evidence) : fail(name, evidence); }
function notTested(name, reason) { report.notTested.push({ name, result: 'NOT TESTED', reason }); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function getTarget() {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`Packaged app exited early with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const pages = (await response.json()).filter(t => t.type === 'page' && t.webSocketDebuggerUrl);
        const page = pages.find(t => t.url.includes('desktop/index.html')) || pages.find(t => t.url.startsWith('file:'));
        if (page) return page;
      }
    } catch {}
    await sleep(250);
  }
  throw new Error('Packaged Electron did not expose a renderer debugging target.');
}
async function connect(url) {
  markStage('connect-to-packaged-renderer-cdp');
  socket = new WebSocket(url);
  await new Promise((resolveOpen, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out connecting to packaged renderer CDP.')), 15000);
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', reject, { once: true });
    socket.addEventListener('open', () => clearTimeout(timer), { once: true });
    socket.addEventListener('error', () => clearTimeout(timer), { once: true });
  });
  socket.addEventListener('message', async event => {
    const raw = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(raw);
    if (message.id && pending.has(message.id)) {
      const { resolve: finish, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else finish(message.result || {});
    } else if (message.method) {
      if (message.method === 'Runtime.exceptionThrown') report.unhandled.push({ kind: 'renderer-exception', detail: message.params.exceptionDetails?.text || message.params.exceptionDetails?.exception?.description || 'unknown renderer exception' });
      if (message.method === 'Log.entryAdded' && ['error', 'warning'].includes(message.params.entry.level)) report.diagnostics.push({ kind: 'renderer-log', level: message.params.entry.level, text: message.params.entry.text });
      if (message.method === 'Network.loadingFailed') report.diagnostics.push({ kind: 'resource-load-failed', text: message.params.errorText, blockedReason: message.params.blockedReason || null });
    }
  });
}
function cdp(method, params = {}, timeout = 10000) {
  const id = nextId++;
  return new Promise((resolveReply, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out waiting for CDP ${method}`)); }, timeout);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolveReply(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression, timeout = 10000) {
  const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout);
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Renderer evaluation failed');
  return response.result?.value;
}
async function waitUntil(expression, description, timeout = 10000) {
  markStage(`wait: ${description}`);
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const value = await evaluate(expression, 2000); if (value) { markStage(`passed: ${description}`); return value; } } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function click(id) {
  return clickSelector(`#${id}`);
}
async function clickSelector(selector) {
  markStage(`click: ${selector}`);
  const rect = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({block:'center',inline:'nearest'}); const r = e.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2; const hit=document.elementFromPoint(x,y); window.__acceptanceClick = null; document.addEventListener('click',ev=>window.__acceptanceClick={id:ev.target?.id||null,tag:ev.target?.tagName||null,x,y}, {capture:true,once:true}); return {x,y,disabled:!!e.disabled,box:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},insideViewport:x>=0&&y>=0&&x<innerWidth&&y<innerHeight,hit:hit?.id||hit?.tagName||null,hitBelongsToControl:!!hit&&(hit===e||e.contains(hit))}; })()`);
  if (!rect) throw new Error(`Missing visible control ${selector}`);
  if (rect.disabled) throw new Error(`Control ${selector} is disabled`);
  if (!rect.box.width || !rect.box.height) throw new Error(`Control ${selector} is not visible: ${JSON.stringify(rect)}`);
  if (!rect.insideViewport || !rect.hitBelongsToControl) throw new Error(`Control ${selector} cannot receive a center click in the packaged viewport: ${JSON.stringify(rect)}`);
  await cdp('Page.bringToFront');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(50);
  const clicked = await evaluate('window.__acceptanceClick');
  if (!clicked) throw new Error(`Mouse click was not dispatched to the page for ${selector}: ${JSON.stringify(rect)}`);
  report.diagnostics.push({ kind: 'mouse-click', selector, ...rect, dispatched: clicked });
}
async function clickCanvasAt(x, y) {
  await cdp('Page.bringToFront');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(100);
}
async function dragCanvas(from, to) {
  await cdp('Page.bringToFront');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 5; step++) {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * step / 5, y: from.y + (to.y - from.y) * step / 5, button: 'left', buttons: 1 });
    await sleep(25);
  }
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(100);
}
async function replaceTextInput(selector, text) {
  await clickSelector(selector);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', code: 'ControlLeft', modifiers: 2, windowsVirtualKeyCode: 17 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', modifiers: 0, windowsVirtualKeyCode: 17 });
  await cdp('Input.insertText', { text });
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await sleep(150);
}
async function componentCanvasPoint(reference) {
  const point = await evaluate(`(async() => { const m=await window.circuit.loadSchematicModel(),c=m.components.find(item=>item.reference===${JSON.stringify(reference)}),e=document.getElementById('schematic-stage'); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(),s=.85; const x=r.left+e.clientWidth/2-50*20*s+c.x*20*s,y=r.top+e.clientHeight/2-40*20*s+c.y*20*s; return {x,y,insideViewport:x>=0&&x<innerWidth&&y>=0&&y<innerHeight}; })()`);
  if (!point?.insideViewport) throw new Error(`Schematic canvas or ${reference} is outside the packaged viewport: ${JSON.stringify(point)}`);
  return point;
}
async function pinCanvasPoint(reference, number) {
  const point = await evaluate(`(async() => { const m=await window.circuit.loadSchematicModel(),c=m.components.find(item=>item.reference===${JSON.stringify(reference)}),p=c?.pins.find(item=>item.number===${JSON.stringify(number)}),e=document.getElementById('schematic-stage'); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(),s=.85; let x=p.x,y=p.y; for(let i=0;i<c.rotation/90;i++) [x,y]=[-y,x]; const sx=r.left+e.clientWidth/2-50*20*s+(c.x+x)*20*s,sy=r.top+e.clientHeight/2-40*20*s+(c.y+y)*20*s; return {x:sx,y:sy,insideViewport:sx>=0&&sx<innerWidth&&sy>=0&&sy<innerHeight}; })()`);
  if (!point?.insideViewport) throw new Error(`Schematic canvas or ${reference}.${number} is outside the packaged viewport: ${JSON.stringify(point)}`);
  return point;
}
async function wireCanvasPoint(index) {
  const point = await evaluate(`(async() => { const m=await window.circuit.loadSchematicModel(),w=m.wires[${index}],node=id=>{const q=/^pin:([^:]+):(.+)$/.exec(id),c=m.components.find(v=>v.id===q?.[1]),p=c?.pins.find(v=>v.number===q?.[2]);if(c&&p){let x=p.x,y=p.y;for(let i=0;i<c.rotation/90;i++)[x,y]=[-y,x];return{x:c.x+x,y:c.y+y};}const j=m.junctions.find(v=>v.id===id);return j?{x:j.x,y:j.y}:null;},a=node(w.fromNodeId),b=node(w.toNodeId),mid=Math.round((a.x+b.x)/2);let worldX,worldY;if(a.y!==b.y){worldX=mid;worldY=(a.y+b.y)/2;}else{worldX=(a.x+b.x)/2;worldY=a.y;}const e=document.getElementById('schematic-stage');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),s=.85,x=r.left+e.clientWidth/2-50*20*s+worldX*20*s,y=r.top+e.clientHeight/2-40*20*s+worldY*20*s;return{x,y,insideViewport:x>=0&&x<innerWidth&&y>=0&&y<innerHeight};})()`);
  if (!point?.insideViewport) throw new Error(`Schematic canvas or wire ${index} is outside the packaged viewport: ${JSON.stringify(point)}`);
  return point;
}
async function wireBetweenCanvasPoint(referenceA, numberA, referenceB, numberB) {
  const point = await evaluate(`(async() => { const m=await window.circuit.loadSchematicModel(),id=(r,n)=>{const c=m.components.find(v=>v.reference===r);return c&&'pin:'+c.id+':'+n;},aId=id(${JSON.stringify(referenceA)},${JSON.stringify(numberA)}),bId=id(${JSON.stringify(referenceB)},${JSON.stringify(numberB)}),i=m.wires.findIndex(w=>(w.fromNodeId===aId&&w.toNodeId===bId)||(w.fromNodeId===bId&&w.toNodeId===aId)); if(i<0) throw new Error('No imported wire connects the requested pins.'); const w=m.wires[i],node=id=>{const q=/^pin:([^:]+):(.+)$/.exec(id),c=m.components.find(v=>v.id===q?.[1]),p=c?.pins.find(v=>v.number===q?.[2]);if(c&&p){let x=p.x,y=p.y;for(let n=0;n<c.rotation/90;n++)[x,y]=[-y,x];return{x:c.x+x,y:c.y+y};}const j=m.junctions.find(v=>v.id===id);return j?{x:j.x,y:j.y}:null;},a=node(w.fromNodeId),b=node(w.toNodeId),mid=Math.round((a.x+b.x)/2);let wx,wy;if(a.y!==b.y){wx=mid;wy=(a.y+b.y)/2;}else{wx=(a.x+b.x)/2;wy=a.y;}const e=document.getElementById('schematic-stage');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),s=.85,x=r.left+e.clientWidth/2-50*20*s+wx*20*s,y=r.top+e.clientHeight/2-40*20*s+wy*20*s;return{x,y,insideViewport:x>=0&&x<innerWidth&&y>=0&&y<innerHeight};})()`);
  if (!point?.insideViewport) throw new Error(`Schematic canvas or wire ${referenceA}.${numberA}–${referenceB}.${numberB} is outside the packaged viewport: ${JSON.stringify(point)}`);
  return point;
}
async function saveEditorRevision(description) {
  const previous = await evaluate(`document.getElementById('schematic-status').textContent`);
  await click('schematic-save');
  await waitUntil(`document.getElementById('schematic-status').textContent !== ${JSON.stringify(previous)}`, description, 10000);
}
async function stopPackagedApp(context) {
  if (!child || child.exitCode !== null) return;
  markStage(`stop-packaged-app: ${context}`);
  const processToStop = child;
  const exited = new Promise(resolveExit => processToStop.once('exit', () => resolveExit(true)));
  if (process.platform === 'win32') {
    // Electron starts renderer/GPU subprocesses that can inherit stdout and
    // stderr handles. Killing only the portable launcher leaves those handles
    // open and keeps this acceptance Node process alive forever.
    const killer = spawn('taskkill.exe', ['/PID', String(processToStop.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await new Promise(resolveKill => {
      killer.once('error', resolveKill);
      killer.once('exit', resolveKill);
    });
  } else processToStop.kill('SIGTERM');
  const didExit = await Promise.race([exited, sleep(15000).then(() => false)]);
  if (!didExit) throw new Error(`Packaged app did not exit within 15 seconds (${context}).`);
  processToStop.stdout?.destroy();
  processToStop.stderr?.destroy();
}
async function screenshot(name) {
  const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const path = join(artifactDir, name);
  await writeFile(path, Buffer.from(result.data, 'base64'));
  report.screenshots.push(path);
}
async function launch({ noNativeTools = false } = {}) {
  const runtimeEnv = { ...process.env, DEMONX_CIRCUIT_ACCEPTANCE_ROOT: noNativeTools ? missingToolsProjectRoot : projectRoot, DEMONX_CIRCUIT_USER_DATA: noNativeTools ? join(workDir, 'missing-tools-user-data') : userData,
    DEMONX_CIRCUIT_ACCEPTANCE_FIXTURE: fixtureDir,
    DEMONX_CIRCUIT_ACCEPTANCE_KICAD_DIR: join(process.env.ProgramFiles || 'C:\\Program Files', 'KiCad', '10.0') };
  if (noNativeTools) {
    runtimeEnv.DEMONX_CIRCUIT_ACCEPTANCE_NO_NATIVE_TOOLS = '1';
    const emptyPrograms = join(workDir, 'no-native-tool-search');
    runtimeEnv.ProgramFiles = emptyPrograms;
    runtimeEnv['ProgramFiles(x86)'] = emptyPrograms;
    runtimeEnv.LOCALAPPDATA = join(emptyPrograms, 'LocalAppData');
    runtimeEnv.PATH = join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  }
  child = spawn(executable, [`--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=${port}`, '--circuit-acceptance'], {
    cwd: dirname(executable), windowsHide: true,
    env: runtimeEnv
  });
  child.stdout.on('data', b => report.diagnostics.push({ kind: 'main-stdout', text: String(b).trim() }));
  child.stderr.on('data', b => {
    const text = String(b).trim();
    report.diagnostics.push({ kind: 'main-stderr', text });
    if (/\[Circuit preload error\]|uncaught exception|unhandled rejection|window startup failed/i.test(text)) report.unhandled.push({ kind: 'main-or-preload-exception', detail: text });
  });
  const target = await getTarget();
  await connect(target.webSocketDebuggerUrl);
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Log.enable'); await cdp('Network.enable');
  await waitUntil(`location.pathname.endsWith('/desktop/index.html') && document.readyState === 'complete'`, 'packaged page load');
  const expectedTheme = await evaluate('window.circuit.getTheme()');
  await waitUntil(`document.body.dataset.theme === ${JSON.stringify(expectedTheme)}`, 'preference loaded in packaged renderer');
}

try {
  markStage('launch-first-packaged-instance');
  await launch();
  const appPath = await evaluate('location.pathname');
  const preload = await evaluate(`({bridge:typeof window.circuit, script:[...document.scripts].map(s=>s.getAttribute('src')), title:document.title})`);
  report.diagnostics.push({ kind: 'renderer-startup', appPath, ...preload });
  check('packaged renderer and preload bridge', preload.bridge === 'object', JSON.stringify(preload));
  const detected = await evaluate('window.circuit.getNativeTools()');
  report.diagnostics.push({ kind: 'installed-native-tools', ...detected });
  check('native tool detection reflects installed tools', (typeof detected.kicadCli === 'string' || detected.kicadCli === null) && (typeof detected.kicadEditor === 'string' || detected.kicadEditor === null) && (typeof detected.esphome === 'string' || detected.esphome === null), JSON.stringify(detected));
  await waitUntil(`document.getElementById('kicad-availability').textContent === ${JSON.stringify(detected.kicadVersion ? `KiCad ${detected.kicadVersion}` : 'NOT FOUND')} && document.getElementById('esphome-availability').textContent === ${JSON.stringify(detected.esphomeVersion ? `ESPHome ${detected.esphomeVersion}` : 'NOT FOUND')}`, 'tool availability shown in dashboard');
  const toolUi = await evaluate(`({summary:document.getElementById('engine-status').textContent,kicad:document.getElementById('kicad-availability').textContent,esphome:document.getElementById('esphome-availability').textContent})`);
  check('dashboard shows KiCad and ESPHome availability', toolUi.kicad === (detected.kicadVersion ? `KiCad ${detected.kicadVersion}` : 'NOT FOUND') && toolUi.esphome === (detected.esphomeVersion ? `ESPHome ${detected.esphomeVersion}` : 'NOT FOUND'), JSON.stringify(toolUi));
  const initialTheme = await evaluate('document.body.dataset.theme');
  check('packaged app starts in its stored theme', initialTheme === 'dark' || initialTheme === 'light', `Initial theme=${initialTheme}`);
  const wordmark = await evaluate(`(() => { const image = document.querySelector('.brand-wordmark'); return image && {src:image.getAttribute('src'),complete:image.complete,width:image.naturalWidth,height:image.naturalHeight,alt:image.alt}; })()`);
  check('official Circuit wordmark loads in packaged renderer', wordmark?.src === './assets/DemonX Circuit.png' && wordmark.complete && wordmark.width === 2172 && wordmark.height === 724 && wordmark.alt === 'DemonX Circuit', JSON.stringify(wordmark));
  const appMark = await evaluate(`(() => { const image = document.querySelector('.brand-mark'); return image && {src:image.getAttribute('src'),complete:image.complete,width:image.naturalWidth,height:image.naturalHeight,alt:image.alt}; })()`);
  check('official Circuit DX artwork loads in packaged renderer', appMark?.src === './assets/DemonX_Glowing_Board_256.png' && appMark.complete && appMark.width === 256 && appMark.height === 256 && appMark.alt === 'DemonX Circuit icon', JSON.stringify(appMark));
  const packagedAssets = ['DemonX Circuit.png', 'DemonX_Glowing_Board.ico', 'DemonX_Glowing_Board_256.png', 'DemonX_Glowing_Board_512.png'].map(name => ({ name, exists: existsSync(join(dirname(executable), 'resources', 'app', 'desktop', 'assets', name)) }));
  check('official window icon assets are packaged for Windows and Linux', packagedAssets.every(asset => asset.exists), JSON.stringify(packagedAssets));
  await screenshot(`desktop-${initialTheme}.png`);

  await click('theme-toggle');
  const switchedTheme = initialTheme === 'light' ? 'dark' : 'light';
  const themeAfterClick = await waitUntil(`document.body.dataset.theme === ${JSON.stringify(switchedTheme)}`, 'theme change after clicking rail control', 3000).catch(async error => ({ error: error.message, theme: await evaluate('document.body.dataset.theme') }));
  check('theme button responds and saves preference', themeAfterClick === true, JSON.stringify(themeAfterClick));
  await click('settings-open');
  const settingsOpen = await evaluate(`document.getElementById('settings-dialog').open`);
  check('settings control opens settings', settingsOpen === true, `settings dialog open=${settingsOpen}`);
  await click('select-kicad');
  const selectedNativeTools = await evaluate('window.circuit.getNativeTools()');
  check('Native Tools settings select and validate installed KiCad', selectedNativeTools.kicadVersion === '10.0.7' && selectedNativeTools.kicadCli && selectedNativeTools.eeschema && selectedNativeTools.pcbnew && selectedNativeTools.kicadInstallDir?.includes('KiCad'), JSON.stringify(selectedNativeTools));
  await click('settings-theme-toggle');
  const settingsTheme = await waitUntil(`document.body.dataset.theme === ${JSON.stringify(initialTheme)}`, 'theme control in settings', 3000).catch(async error => ({ error: error.message, theme: await evaluate('document.body.dataset.theme') }));
  check('settings theme control responds', settingsTheme === true, JSON.stringify(settingsTheme));
  await click('settings-theme-toggle');
  await waitUntil(`document.body.dataset.theme === ${JSON.stringify(switchedTheme)}`, 'restore selected theme', 3000);
  await clickSelector('#settings-dialog .modal-actions button');
  await screenshot(`desktop-${switchedTheme}.png`);

  await click('new-project');
  const created = await waitUntil(`document.getElementById('project-state')?.textContent === 'OPEN'`, 'new project creation, including native ERC/DRC, through packaged IPC', 120000).catch(async error => ({ error: error.message, title: await evaluate("document.getElementById('result-title')?.textContent"), message: await evaluate("document.getElementById('result-message')?.textContent") }));
  let manifest = null;
  const createdProjectPath = join(projectRoot, 'DemonX-Circuit-Project');
  try { manifest = JSON.parse(await readFile(join(createdProjectPath, 'project.json'), 'utf8')); } catch {}
  const nativeFiles = ['.kicad_pro', '.kicad_sch', '.kicad_pcb', 'sym-lib-table', 'fp-lib-table'].map(suffix => ({ suffix, exists: existsSync(join(createdProjectPath, suffix.startsWith('.') ? `DemonX-Circuit-Project${suffix}` : suffix)) }));
  check('New Project creates native KiCad files and project library configuration under a path containing spaces', manifest?.format === 'demonx-project' && nativeFiles.every(file => file.exists), JSON.stringify({ created, projectId: manifest?.projectId, root: createdProjectPath, nativeFiles }));

  if (manifest) {
    await click('open-project');
    const reopened = await waitUntil(`document.getElementById('project-id')?.textContent === ${JSON.stringify(manifest.projectId)}`, 'opening the created project through packaged IPC', 5000).catch(async error => ({ error: error.message, title: await evaluate("document.getElementById('result-title')?.textContent"), message: await evaluate("document.getElementById('result-message')?.textContent") }));
    check('Open Project reopens the created project', reopened === true, `projectId=${manifest.projectId}; condition=${reopened}`);
    await waitUntil(`document.querySelector('#recent-projects .recent-item')`, 'recent project list refresh');
    await clickSelector('#recent-projects .recent-item');
    const recentOpened = await waitUntil(`document.getElementById('project-id')?.textContent === ${JSON.stringify(manifest.projectId)}`, 'opening a recent project', 3000);
    check('recent project entry reopens project', recentOpened === true, `projectId=${manifest.projectId}; condition=${recentOpened}`);
    await click('check-circuit');
    await waitUntil(`document.getElementById('result-dialog').open`, 'new native starter ERC/DRC action', 120000);
    const starterCheck = await evaluate(`({status:document.getElementById('result-kicker').textContent,message:document.getElementById('result-message').textContent,output:document.getElementById('result-output').textContent})`);
    check('new KiCad project runs real ERC and DRC', starterCheck.status === 'PASS' && /native KiCad check/i.test(starterCheck.message) && /ERC exit 0[\s\S]*DRC exit 0/.test(starterCheck.output), JSON.stringify(starterCheck));
    await clickSelector('#result-dialog .modal-actions button');
    const firstProjectId = manifest.projectId;
    await click('new-project');
    await waitUntil(`document.getElementById('project-id')?.textContent !== ${JSON.stringify(firstProjectId)}`, 'repeated project name creates a new native project', 120000);
    const repeatedFiles = ['DemonX-Circuit-Project-2.kicad_pro', 'DemonX-Circuit-Project-2.kicad_sch', 'DemonX-Circuit-Project-2.kicad_pcb'].map(name => ({ name, exists: existsSync(join(projectRoot, 'DemonX-Circuit-Project-2', name)) }));
    check('repeated project creation preserves the existing folder and creates a native suffixed project', repeatedFiles.every(file => file.exists) && existsSync(join(createdProjectPath, 'DemonX-Circuit-Project.kicad_pcb')), JSON.stringify(repeatedFiles));

    // Exercise the editor in the extracted package with real CDP mouse input.
    // This is the DemonX sidecar model editor; native KiCad schematic export
    // remains explicitly out of scope for this checkpoint.
    const editorProjectPath = join(projectRoot, 'DemonX-Circuit-Project-2');
    const nativeSchematicPath = join(editorProjectPath, 'DemonX-Circuit-Project-2.kicad_sch');
    const nativeSchematicBefore = await readFile(nativeSchematicPath);
    await click('open-circuit-schematic');
    await waitUntil(`!document.getElementById('schematic-workspace').classList.contains('hidden')`, 'open packaged DemonX schematic workspace');
    let editorModel = await evaluate('window.circuit.loadSchematicModel()');
    check('new native project opens its saved DemonX schematic sidecar', !!editorModel && editorModel.components.length === 3 && editorModel.wires.length === 3, JSON.stringify({ components: editorModel?.components?.length, wires: editorModel?.wires?.length }));
    await screenshot('schematic-editor-initial.png');

    await click('schematic-add');
    await waitUntil(`document.getElementById('component-picker').open`, 'open component search dialog');
    await clickSelector('.component-choice');
    await saveEditorRevision('save newly placed component revision');
    editorModel = await evaluate('window.circuit.loadSchematicModel()');
    check('component picker adds a real library component', editorModel?.components?.length === 4 && editorModel.components.some(c => c.reference === 'J2'), JSON.stringify(editorModel?.components?.map(c => c.reference)));
    await click('schematic-undo');
    await saveEditorRevision('save undo revision');
    const afterUndo = await evaluate('window.circuit.loadSchematicModel()');
    check('undo removes component addition', afterUndo?.components?.length === 3 && !afterUndo.components.some(c => c.reference === 'J2'), JSON.stringify(afterUndo?.components?.map(c => c.reference)));
    await click('schematic-redo');
    await saveEditorRevision('save redo revision');
    editorModel = await evaluate('window.circuit.loadSchematicModel()');
    check('redo restores component addition', editorModel?.components?.length === 4 && editorModel.components.some(c => c.reference === 'J2'), JSON.stringify(editorModel?.components?.map(c => c.reference)));

    const componentCenter = await evaluate(`(async() => { const c=(await window.circuit.loadSchematicModel()).components.find(item=>item.reference==='J2'); const e=document.getElementById('schematic-stage'),r=e.getBoundingClientRect(),s=.85; return {x:r.left+e.clientWidth/2-50*20*s+c.x*20*s,y:r.top+e.clientHeight/2-40*20*s+c.y*20*s}; })()`);
    await clickCanvasAt(componentCenter.x, componentCenter.y);
    await click('schematic-rotate');
    await saveEditorRevision('save rotation revision');
    let rotatedModel = await evaluate('window.circuit.loadSchematicModel()');
    check('mouse selection and Rotate action update component orientation', rotatedModel?.components?.find(c => c.reference === 'J2')?.rotation === 90, JSON.stringify(rotatedModel?.components?.find(c => c.reference === 'J2')));
    await click('schematic-undo');
    await saveEditorRevision('save rotation undo revision');
    const undoneRotation = await evaluate('window.circuit.loadSchematicModel()');
    check('undo restores prior component orientation', undoneRotation?.components?.find(c => c.reference === 'J2')?.rotation === 0, JSON.stringify(undoneRotation?.components?.find(c => c.reference === 'J2')));
    await click('schematic-redo');
    await saveEditorRevision('save rotation redo revision');
    const redoneRotation = await evaluate('window.circuit.loadSchematicModel()');
    check('redo restores rotated component orientation', redoneRotation?.components?.find(c => c.reference === 'J2')?.rotation === 90, JSON.stringify(redoneRotation?.components?.find(c => c.reference === 'J2')));
    await click('schematic-delete');
    await saveEditorRevision('save delete revision');
    const deletedComponent = await evaluate('window.circuit.loadSchematicModel()');
    check('Delete removes selected component', deletedComponent?.components?.length === 3 && !deletedComponent.components.some(c => c.reference === 'J2'), JSON.stringify(deletedComponent?.components?.map(c => c.reference)));
    await click('schematic-undo');
    await saveEditorRevision('save delete undo revision');
    editorModel = await evaluate('window.circuit.loadSchematicModel()');
    check('undo restores deleted component', editorModel?.components?.length === 4 && editorModel.components.some(c => c.reference === 'J2'), JSON.stringify(editorModel?.components?.map(c => c.reference)));
    const resetJ2 = await evaluate(`(async() => { const c=(await window.circuit.loadSchematicModel()).components.find(item=>item.reference==='J2'); const e=document.getElementById('schematic-stage'),r=e.getBoundingClientRect(),s=.85; return {x:r.left+e.clientWidth/2-50*20*s+c.x*20*s,y:r.top+e.clientHeight/2-40*20*s+c.y*20*s}; })()`);
    await clickCanvasAt(resetJ2.x, resetJ2.y);
    for (let i = 0; i < 3; i++) await click('schematic-rotate');
    await saveEditorRevision('save orientation reset revision');
    editorModel = await evaluate('window.circuit.loadSchematicModel()');
    check('rotation returns to supported zero-degree orientation', editorModel?.components?.find(c => c.reference === 'J2')?.rotation === 0, JSON.stringify(editorModel?.components?.find(c => c.reference === 'J2')));
    const beforeDrag = editorModel.components.find(c => c.reference === 'J2');
    const dragStart = await evaluate(`(async() => { const c=(await window.circuit.loadSchematicModel()).components.find(item=>item.reference==='J2'); const e=document.getElementById('schematic-stage'),r=e.getBoundingClientRect(),s=.85; return {x:r.left+e.clientWidth/2-50*20*s+c.x*20*s,y:r.top+e.clientHeight/2-40*20*s+c.y*20*s}; })()`);
    await dragCanvas(dragStart, { x: dragStart.x + 34, y: dragStart.y });
    await saveEditorRevision('save dragged component revision');
    editorModel = await evaluate('window.circuit.loadSchematicModel()');
    check('drag placement snaps to model grid and retains component identity', editorModel?.components?.find(c => c.reference === 'J2')?.x === beforeDrag.x + 2 && editorModel?.components?.find(c => c.reference === 'J2')?.id === beforeDrag.id, JSON.stringify({ before: beforeDrag, after: editorModel?.components?.find(c => c.reference === 'J2') }));

    await click('schematic-wire');
    const wireTargets = await evaluate(`(async() => {
      const m = await window.circuit.loadSchematicModel(); const container = document.getElementById('schematic-stage'); const rect = container.getBoundingClientRect();
      const width = container.clientWidth, height = container.clientHeight, scale = 0.85;
      const find = (ref, number) => { const c = m.components.find(item => item.reference === ref), p = c?.pins.find(item => item.number === number); if (!c || !p) return null;
        let x=p.x,y=p.y; for(let i=0;i<c.rotation/90;i++) [x,y]=[-y,x];
        return {x:rect.left+width/2-50*20*scale+(c.x+x)*20*scale,y:rect.top+height/2-40*20*scale+(c.y+y)*20*scale}; };
      return { from:find('J1','1'), to:find('J2','1'), wires:m.wires.length, viewport:{w:innerWidth,h:innerHeight} };
    })()`);
    if (wireTargets?.from && wireTargets?.to && wireTargets.from.x >= 0 && wireTargets.to.x < wireTargets.viewport.w && wireTargets.from.y >= 0 && wireTargets.to.y < wireTargets.viewport.h) {
      await clickCanvasAt(wireTargets.from.x, wireTargets.from.y);
      await clickCanvasAt(wireTargets.to.x, wireTargets.to.y);
      await saveEditorRevision('save pin-to-pin wire revision');
      const wiredModel = await evaluate('window.circuit.loadSchematicModel()');
      const j1Id = wiredModel?.components?.find(c => c.reference === 'J1')?.id;
      const j2Id = wiredModel?.components?.find(c => c.reference === 'J2')?.id;
      check('pin connection creates a merged semantic net', wiredModel?.wires?.length === wireTargets.wires + 1 && wiredModel.wires.some(w => new Set([w.fromNodeId, w.toNodeId]).has(`pin:${j1Id}:1`) && new Set([w.fromNodeId, w.toNodeId]).has(`pin:${j2Id}:1`)), JSON.stringify(wiredModel?.wires?.at(-1)));
    } else fail('wire tool connects actual snapped component pins', `Calculated target pins were outside the packaged canvas: ${JSON.stringify(wireTargets)}`);

    await click('schematic-save');
    await waitUntil(`document.getElementById('schematic-status').textContent.includes('Saved local DemonX revision')`, 'save editor changes to append-only revision');
    let savedModel = await evaluate('window.circuit.loadSchematicModel()');
    const revisions = await import('node:fs/promises').then(fs => fs.readdir(join(editorProjectPath, 'schematic-circuit', 'revisions'))).catch(() => []);
    check('schematic save writes a new local revision and preserves the native KiCad file', revisions.length >= 2 && (await readFile(nativeSchematicPath)).equals(nativeSchematicBefore), JSON.stringify({ revisions, nativeSchematicUnchanged: (await readFile(nativeSchematicPath)).equals(nativeSchematicBefore) }));
    await click('schematic-back');
    await waitUntil(`document.getElementById('schematic-workspace').classList.contains('hidden')`, 'return to project dashboard');
    await click('open-circuit-schematic');
    await waitUntil(`!document.getElementById('schematic-workspace').classList.contains('hidden')`, 'reopen DemonX schematic workspace');
    const reopenedModel = await evaluate('window.circuit.loadSchematicModel()');
    check('save/reopen preserves edited semantic connectivity', JSON.stringify(savedModel) === JSON.stringify(reopenedModel) && reopenedModel?.components?.length === 4 && reopenedModel?.wires?.length === 4, JSON.stringify({ components: reopenedModel?.components?.length, wires: reopenedModel?.wires?.length }));
    await screenshot('schematic-editor-reopened.png');
    await click('schematic-back');
  } else fail('Open Project reopens the created project', 'Skipped because New Project did not create its expected project file.');

  // Native round-trip acceptance uses a fresh, real LED/resistor project so
  // the earlier editor interaction test remains isolated and unchanged.
  const beforeRoundtripProjectId = await evaluate(`document.getElementById('project-id').textContent`);
  await click('new-project');
  const roundtripCreated = await waitUntil(`document.getElementById('project-id')?.textContent !== ${JSON.stringify(beforeRoundtripProjectId)}`, 'create a clean native round-trip project', 120000).catch(async error => ({ error: error.message, state: await evaluate(`document.getElementById('project-id')?.textContent`) }));
  const roundtripRoot = join(projectRoot, 'DemonX-Circuit-Project-3');
  const roundtripManifest = await readFile(join(roundtripRoot, 'project.json'), 'utf8').then(JSON.parse).catch(() => null);
  const roundtripSchematic = join(roundtripRoot, 'DemonX-Circuit-Project-3.kicad_sch');
  const nativeOriginal = await readFile(roundtripSchematic).catch(() => null);
  const nativeOriginalHash = nativeOriginal && packageAdapter.digest(nativeOriginal);
  const importedProject = await evaluate('window.circuit.inspectProject()');
  check('new LED reference project imports native KiCad components and records the source revision', !!roundtripManifest && importedProject?.nativeSyncStatus === 'IN_SYNC' && importedProject.components.some(component => component.ref === 'R1'), JSON.stringify({ created: roundtripCreated, status: importedProject?.nativeSyncStatus, nativeSha256: importedProject?.nativeSchematicSha256, root: roundtripRoot }));
  let roundtripEditorOpened = false;
  if (roundtripManifest && nativeOriginal) {
    await click('open-circuit-schematic');
    roundtripEditorOpened = await waitUntil(`!document.getElementById('schematic-workspace').classList.contains('hidden')`, 'open native-imported LED schematic in DemonX', 5000).then(() => true).catch(() => false);
    const importedModel = await evaluate('window.circuit.loadSchematicModel()');
    check('packaged editor imports native references, values, coordinates, orientations, pins, labels and wires', roundtripEditorOpened && importedModel?.components?.map(c => [c.reference, c.value, c.x, c.y, c.rotation]).some(c => c.join('|') === 'R1|330|50|40|0') && importedModel.components.length === 3 && importedModel.wires.length === 3 && packageAdapter.netGroups(importedModel).length === 3, JSON.stringify({ components: importedModel?.components?.map(c => [c.reference, c.value, c.x, c.y, c.rotation]), nets: importedModel && packageAdapter.netGroups(importedModel) }));
    const unsupportedText = nativeOriginal.toString('utf8').trimEnd();
    const rootClose = unsupportedText.lastIndexOf(')');
    const unsupportedNative = Buffer.from(`${unsupportedText.slice(0, rootClose)} (no_connect (at 1 2) (uuid "00000000-0000-4000-8000-000000000000")) ${unsupportedText.slice(rootClose)}`);
    let unsupportedRefused = false;
    try { packageAdapter.importKiCadSchematic(unsupportedNative.toString('utf8')); } catch (error) { unsupportedRefused = /no_connect/.test(error.message); }
    check('packaged adapter refuses unsupported native electrical constructs without changing source', unsupportedRefused && (await readFile(roundtripSchematic)).equals(nativeOriginal), `no_connect refused=${unsupportedRefused}; source SHA-256=${packageAdapter.digest(await readFile(roundtripSchematic))}`);

    let r1Point = await componentCanvasPoint('R1');
    await clickCanvasAt(r1Point.x, r1Point.y);
    await replaceTextInput('#schematic-value', '470');
    await saveEditorRevision('save imported component value edit');
    let editModel = await evaluate('window.circuit.loadSchematicModel()');
    check('packaged editor edits a native component value through mouse and keyboard input', editModel?.components?.find(c => c.reference === 'R1')?.value === '470', JSON.stringify(editModel?.components?.find(c => c.reference === 'R1')));
    r1Point = await componentCanvasPoint('R1');
    await dragCanvas(r1Point, { x: r1Point.x + 34, y: r1Point.y + 34 });
    await saveEditorRevision('save imported component move');
    editModel = await evaluate('window.circuit.loadSchematicModel()');
    check('packaged editor moves imported native component and retains its stable reference', editModel?.components?.find(c => c.reference === 'R1')?.x === 52 && editModel?.components?.find(c => c.reference === 'R1')?.y === 42, JSON.stringify(editModel?.components?.find(c => c.reference === 'R1')));
    r1Point = await componentCanvasPoint('R1'); await clickCanvasAt(r1Point.x, r1Point.y); await click('schematic-rotate');
    await saveEditorRevision('save imported component rotation');
    editModel = await evaluate('window.circuit.loadSchematicModel()');
    check('packaged editor rotates imported native component', editModel?.components?.find(c => c.reference === 'R1')?.rotation === 90, JSON.stringify(editModel?.components?.find(c => c.reference === 'R1')));

    await click('schematic-select');
    const semanticWireExists = (refA, pinA, refB, pinB) => { const idA = `pin:${editModel?.components?.find(c => c.reference === refA)?.id}:${pinA}`, idB = `pin:${editModel?.components?.find(c => c.reference === refB)?.id}:${pinB}`; return editModel?.wires?.some(w => (w.fromNodeId === idA && w.toNodeId === idB) || (w.fromNodeId === idB && w.toNodeId === idA)); };
    let disconnectPoint = await wireBetweenCanvasPoint('J1', '1', 'R1', '1'); await clickCanvasAt(disconnectPoint.x, disconnectPoint.y); await click('schematic-delete');
    await saveEditorRevision('save first imported pin disconnection');
    editModel = await evaluate('window.circuit.loadSchematicModel()');
    check('packaged editor disconnects the selected imported native pin connection', editModel?.wires?.length === 2 && !semanticWireExists('J1', '1', 'R1', '1') && semanticWireExists('R1', '2', 'D1', '1') && semanticWireExists('D1', '2', 'J1', '2'), JSON.stringify({ wires: editModel?.wires, deletedWireAbsent: !semanticWireExists('J1', '1', 'R1', '1') }));
    disconnectPoint = await wireBetweenCanvasPoint('R1', '2', 'D1', '1'); await clickCanvasAt(disconnectPoint.x, disconnectPoint.y); await click('schematic-delete');
    await saveEditorRevision('save second imported pin disconnection');
    editModel = await evaluate('window.circuit.loadSchematicModel()');
    check('packaged editor disconnects the second imported pin connection', editModel?.wires?.length === 1 && !semanticWireExists('R1', '2', 'D1', '1') && semanticWireExists('D1', '2', 'J1', '2'), JSON.stringify({ wires: editModel?.wires, deletedWireAbsent: !semanticWireExists('R1', '2', 'D1', '1') }));
    check('deliberately disconnected passive pins alter the semantic topology', editModel?.wires?.length === 1 && packageAdapter.netGroups(editModel).length === 5 && packageAdapter.netGroups(editModel).filter(group => group.length === 1).length === 4, JSON.stringify({ wires: editModel?.wires, nets: editModel && packageAdapter.netGroups(editModel) }));
    await click('schematic-stage-native'); await waitUntil(`document.getElementById('result-dialog').open`, 'native ERC evaluates deliberately disconnected passive pin candidate', 120000);
    const invalidResult = await evaluate(`({status:document.getElementById('result-kicker').textContent,message:document.getElementById('result-message').textContent,output:document.getElementById('result-output').textContent})`);
    const stagedDir = join(roundtripRoot, 'schematic-circuit', 'staged');
    const allStageRecords = await readdir(stagedDir).then(async names => Promise.all(names.filter(name => name.endsWith('.json')).map(name => readFile(join(stagedDir, name), 'utf8').then(JSON.parse)))).catch(() => []);
    const openPinStage = allStageRecords.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1);
    const openPinSourcePreserved = packageAdapter.digest(await readFile(roundtripSchematic)) === nativeOriginalHash;
    check('KiCad ERC rejects the deliberately disconnected passive-pin candidate and preserves the source', invalidResult.status === 'FAIL' && !!openPinStage && !openPinStage.validated && openPinStage.validation.erc.exitCode !== 0 && openPinStage.validation.candidateNetlist?.matches === true && /Found [1-9]\d* violations/.test(invalidResult.output) && openPinSourcePreserved, JSON.stringify({ status: invalidResult.status, ercExitCode: openPinStage?.validation?.erc?.exitCode, candidateNetlist: openPinStage?.validation?.candidateNetlist, sourcePreserved: openPinSourcePreserved, output: invalidResult.output }));
    await screenshot('schematic-native-erc-open-passive-pin-rejected.png');
    await clickSelector('#result-dialog .modal-actions button');
    await click('schematic-wire');
    let point = await pinCanvasPoint('J1', '1'); await clickCanvasAt(point.x, point.y);
    point = await pinCanvasPoint('R1', '2'); await clickCanvasAt(point.x, point.y);
    point = await pinCanvasPoint('R1', '1'); await clickCanvasAt(point.x, point.y);
    point = await pinCanvasPoint('D1', '1'); await clickCanvasAt(point.x, point.y);
    await saveEditorRevision('save imported pin reconnection');
    editModel = await evaluate('window.circuit.loadSchematicModel()');
    const expectedRewiredNets = [['D1.1', 'R1.1'], ['D1.2', 'J1.2'], ['J1.1', 'R1.2']];
    check('packaged editor reconnects actual pins with a meaningful netlist topology change', editModel?.wires?.length === 3 && JSON.stringify(packageAdapter.netGroups(editModel)) === JSON.stringify(expectedRewiredNets), JSON.stringify({ wires: editModel?.wires?.length, nets: editModel && packageAdapter.netGroups(editModel) }));
    await screenshot('schematic-native-edited.png');

    await click('schematic-stage-native');
    await waitUntil(`document.getElementById('result-dialog').open`, 'native candidate netlist and ERC result', 120000);
    const stageStatus = await evaluate(`document.getElementById('result-kicker').textContent`);
    const stageOutput = await evaluate(`document.getElementById('result-message').textContent + String.fromCharCode(10) + document.getElementById('result-output').textContent`);
    const stagedRecords = await readdir(stagedDir).then(async names => Promise.all(names.filter(name => name.endsWith('.json')).map(name => readFile(join(stagedDir, name), 'utf8').then(JSON.parse)))).catch(() => []);
    const validStage = stagedRecords.filter(record => record.validated).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).at(-1);
    check('Validate & Stage exports native candidate, compares original/candidate netlists and passes actual ERC', stageStatus === 'PASS' && !!validStage && validStage.validation.originalNetlist?.matches && validStage.validation.candidateNetlist?.matches && validStage.validation.erc.exitCode === 0 && /ERC exit code: 0|Candidate ERC exit: 0/.test(stageOutput), stageOutput);
    check('staging keeps native source unchanged and stores exact source/candidate hashes', !!validStage && packageAdapter.digest(await readFile(roundtripSchematic)) === nativeOriginalHash && validStage.sourceSha256 === nativeOriginalHash && validStage.candidateSha256 !== nativeOriginalHash, JSON.stringify({ source: nativeOriginalHash, current: packageAdapter.digest(await readFile(roundtripSchematic)), candidate: validStage?.candidateSha256 }));
    await screenshot('schematic-native-staged.png');
    await clickSelector('#result-dialog .modal-actions button');

    await click('schematic-back'); await click('check-circuit');
    await waitUntil(`document.getElementById('result-dialog').open`, 'refuse stale native checks while DemonX changes are unsynchronized');
    const staleCheck = await evaluate(`({status:document.getElementById('result-kicker').textContent,message:document.getElementById('result-message').textContent,output:document.getElementById('result-output').textContent})`);
    check('native ERC is not presented as verification while the editor and KiCad differ', staleCheck.status === 'NOT TESTED' && /unsynchronized/i.test(staleCheck.message + staleCheck.output), JSON.stringify(staleCheck));
    await clickSelector('#result-dialog .modal-actions button');
    await click('open-circuit-schematic'); await waitUntil(`!document.getElementById('schematic-workspace').classList.contains('hidden')`, 'reopen editor for native candidate review');
    await click('schematic-open-stage'); await waitUntil(`document.getElementById('result-dialog').open`, 'open staged candidate in KiCad graphical editor', 30000);
    const guiOpen = await evaluate(`({status:document.getElementById('result-kicker').textContent,message:document.getElementById('result-message').textContent})`);
    let editorWindows = [], editorWindowProbeError = null;
    try {
      const windowsJson = execFileSync('powershell.exe', ['-NoProfile', '-Command', "Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes; $deadline = (Get-Date).AddSeconds(20); $windows = @(); do { $windows = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'kicad|eeschema' } | Select-Object ProcessName,Id,MainWindowHandle,MainWindowTitle); if (@($windows | Where-Object { $_.MainWindowTitle -match 'candidate' }).Count -gt 0) { break }; Start-Sleep -Milliseconds 250 } while ((Get-Date) -lt $deadline); $details = @(foreach ($window in $windows) { $texts = @(); if ($window.MainWindowHandle -ne 0) { try { $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.MainWindowHandle); $nodes = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition); foreach ($node in $nodes) { $name = $node.Current.Name; if ($name) { $texts += $name } } } catch { $texts += ('UIA error: ' + $_.Exception.Message) } }; [pscustomobject]@{ ProcessName = $window.ProcessName; Id = $window.Id; MainWindowHandle = $window.MainWindowHandle; MainWindowTitle = $window.MainWindowTitle; AccessibleTexts = $texts } }); ConvertTo-Json -InputObject @($details) -Depth 5 -Compress"], { encoding: 'utf8', timeout: 25000 }).trim();
      const parsedWindows = windowsJson ? JSON.parse(windowsJson) : [];
      editorWindows = Array.isArray(parsedWindows) ? parsedWindows : parsedWindows ? [parsedWindows] : [];
    } catch (error) { editorWindowProbeError = error.message; }
    const candidateWindow = editorWindows.find(window => /candidate/i.test(window.MainWindowTitle || '')) || null;
    check('staged candidate document appears in a KiCad schematic editor window', guiOpen.status === 'PASS' && /KiCad .*staged candidate/i.test(guiOpen.message) && !!candidateWindow, JSON.stringify({ ...guiOpen, candidateWindow, visibleEeschemaWindows: editorWindows, probeError: editorWindowProbeError }));
    await clickSelector('#result-dialog .modal-actions button');

    await click('schematic-commit-native');
    const approval = await evaluate(`({open:document.getElementById('native-commit-dialog').open,details:document.getElementById('native-commit-details').textContent})`);
    check('native commit requires explicit approval with source and candidate hashes', approval.open && approval.details.includes(validStage.sourceSha256) && approval.details.includes(validStage.candidateSha256), JSON.stringify(approval));
    await click('native-commit-approve'); await waitUntil(`document.getElementById('result-dialog').open`, 'approved native schematic commit', 30000);
    const commitResult = await evaluate(`({status:document.getElementById('result-kicker').textContent,message:document.getElementById('result-message').textContent,output:document.getElementById('result-output').textContent})`);
    const committedNative = await readFile(roundtripSchematic);
    const backups = await readdir(join(roundtripRoot, 'schematic-circuit', 'native-backups')).catch(() => []);
    const originalBackup = backups[0] ? await readFile(join(roundtripRoot, 'schematic-circuit', 'native-backups', backups[0])) : null;
    check('approved commit replaces native schematic only after validation and retains exact rollback backup', commitResult.status === 'PASS' && packageAdapter.digest(committedNative) === validStage.candidateSha256 && originalBackup?.equals(nativeOriginal), JSON.stringify({ ...commitResult, candidateHash: validStage.candidateSha256, backupName: backups[0], backupMatchesOriginal: originalBackup?.equals(nativeOriginal) }));
    await clickSelector('#result-dialog .modal-actions button');

    await click('open-circuit-schematic'); await waitUntil(`!document.getElementById('schematic-workspace').classList.contains('hidden')`, 'reimport committed native schematic into DemonX');
    const reimportedCommitted = await evaluate(`(async()=>({model:await window.circuit.loadSchematicModel(),project:await window.circuit.inspectProject()}))()`);
    check('committed KiCad schematic reimports to the same edited semantic model', reimportedCommitted.project?.nativeSyncStatus === 'IN_SYNC' && reimportedCommitted.model?.nativeSync?.sourceSha256 === validStage.candidateSha256 && reimportedCommitted.model?.components?.find(c=>c.reference==='R1')?.value === '470' && reimportedCommitted.model?.components?.find(c=>c.reference==='R1')?.rotation === 90 && JSON.stringify(packageAdapter.netGroups(reimportedCommitted.model)) === JSON.stringify(expectedRewiredNets), JSON.stringify({ status: reimportedCommitted.project?.nativeSyncStatus, nativeSha256: reimportedCommitted.model?.nativeSync?.sourceSha256, nets: reimportedCommitted.model && packageAdapter.netGroups(reimportedCommitted.model) }));
    await screenshot('schematic-native-reimported.png');

    await click('schematic-rollback-native');
    const rollbackDialog = await evaluate(`document.getElementById('native-commit-dialog').open`);
    check('rollback action requests separate explicit approval', rollbackDialog === true, `dialog open=${rollbackDialog}`);
    await click('native-commit-approve'); await waitUntil(`document.getElementById('result-dialog').open`, 'approved native schematic rollback', 30000);
    const rollbackResult = await evaluate(`({status:document.getElementById('result-kicker').textContent,message:document.getElementById('result-message').textContent})`);
    check('rollback restores the exact original KiCad schematic', rollbackResult.status === 'PASS' && packageAdapter.digest(await readFile(roundtripSchematic)) === nativeOriginalHash, JSON.stringify({ ...rollbackResult, restoredSha256: packageAdapter.digest(await readFile(roundtripSchematic)), expectedSha256: nativeOriginalHash }));
    await clickSelector('#result-dialog .modal-actions button');
  } else {
    for (const name of ['native schematic import', 'native candidate editing', 'native netlist/ERC round-trip', 'native GUI reopen', 'native commit/rollback']) notTested(name, 'Native round-trip project did not create with KiCad on this packaged runner.');
  }

  const fixtureId = 'dx-esp32-bme280-relay-demo';
  let fixtureOpened = false;
  if (hasFixture) {
    check('packaged ESP32 fixture includes the verified KiCad netlist used for firmware mapping', existsSync(join(fixtureDir, 'native', 'verified-netlist.json')), join(fixtureDir, 'native', 'verified-netlist.json'));
    await click('open-project');
    fixtureOpened = await waitUntil(`document.getElementById('project-id')?.textContent === ${JSON.stringify(fixtureId)}`, 'open packaged ESP32 native fixture', 5000).catch(async error => ({ error: error.message, id: await evaluate("document.getElementById('project-id')?.textContent") }));
    check('opens packaged ESP32 fixture project', fixtureOpened === true, `projectId=${fixtureId}; condition=${fixtureOpened}`);
  } else notTested('fixture-backed native project actions', 'This package does not include the verified native fixture files. The Windows workflow package includes them.');

  if (fixtureOpened === true) {
    await click('open-schematic');
    await waitUntil(`document.getElementById('result-dialog').open`, 'native schematic action result');
    const schematicStatus = await evaluate(`document.getElementById('result-kicker').textContent`);
    const schematicText = await evaluate(`document.getElementById('result-kicker').textContent + ': ' + document.getElementById('result-message').textContent`);
    report.checks.push({ name: 'Open Schematic native editor action', result: schematicStatus, evidence: schematicText });
    if (detected.eeschema) check('Open Schematic starts the KiCad editor', schematicStatus === 'PASS' && /KiCad/i.test(schematicText), schematicText);
    else notTested('Open Schematic in KiCad', 'KiCad Schematic Editor was not found on this Windows runner.');
    await clickSelector('#result-dialog .modal-actions button');

    await click('open-pcb');
    await waitUntil(`document.getElementById('result-dialog').open`, 'native PCB action result');
    const openStatus = await evaluate(`document.getElementById('result-kicker').textContent`);
    const openText = await evaluate(`document.getElementById('result-kicker').textContent + ': ' + document.getElementById('result-message').textContent`);
    report.checks.push({ name: 'Open PCB native editor action', result: openStatus, evidence: openText });
    if (detected.pcbnew) check('Open PCB starts the KiCad editor', openStatus === 'PASS' && /KiCad/i.test(openText), openText);
    else { notTested('Open PCB in KiCad', 'KiCad desktop editor was not found on this Windows runner.'); check('Open PCB explains missing editor', /NOT TESTED:.*KiCad desktop editor was not found/i.test(openText), openText); }
    await clickSelector('#result-dialog .modal-actions button');

    await click('check-circuit');
    await waitUntil(`document.getElementById('result-dialog').open`, 'Check Circuit action result', 120000);
    const checkStatus = await evaluate(`document.getElementById('result-kicker').textContent`);
    const checkText = await evaluate(`document.getElementById('result-kicker').textContent + ': ' + document.getElementById('result-message').textContent + '\\n' + document.getElementById('result-output').textContent`);
    report.checks.push({ name: 'Check Circuit native ERC/DRC action', result: checkStatus, evidence: checkText });
    if (detected.kicadCli) check('Check Circuit passes actual fixture ERC and DRC', checkStatus === 'PASS' && /ERC exit 0[\s\S]*DRC exit 0/.test(checkText), checkText);
    else { notTested('KiCad ERC/DRC execution', 'KiCad CLI was not found on this Windows runner.'); check('Check Circuit explains missing KiCad CLI', /NOT TESTED: KiCad CLI was not found/i.test(checkText), checkText); }
    await clickSelector('#result-dialog .modal-actions button');

    await click('prepare-manufacturing');
    await waitUntil(`document.getElementById('result-dialog').open`, 'manufacturing action result', 120000);
    const manufacturingStatus = await evaluate(`document.getElementById('result-kicker').textContent`);
    const manufacturingText = await evaluate(`document.getElementById('result-kicker').textContent + ': ' + document.getElementById('result-message').textContent`);
    const manufacturingOutput = await evaluate(`document.getElementById('result-output').textContent`);
    report.checks.push({ name: 'Manufacturing export action', result: manufacturingStatus, evidence: manufacturingText });
    if (detected.kicadCli) check('manufacturing exports include copper, drill, and STEP files', manufacturingStatus === 'PASS' && /gerbers\/.*F[_\.]Cu/i.test(manufacturingOutput) && /drill\/.*\.(drl|xln)/i.test(manufacturingOutput) && /step\/assembly\.step/i.test(manufacturingOutput), `${manufacturingText}\n${manufacturingOutput}`);
    else { notTested('Gerber/Excellon/STEP export action', 'KiCad CLI was not found on this Windows runner.'); check('Manufacturing action explains missing KiCad CLI', /NOT TESTED: KiCad CLI was not found/i.test(manufacturingText), manufacturingText); }
    await clickSelector('#result-dialog .modal-actions button');

    await click('generate-esphome');
    await waitUntil(`document.getElementById('yaml-dialog').open`, 'ESPHome preview and validation dialog', 120000);
    const yamlCheck = await evaluate(`({hasEsp32:document.getElementById('yaml-content').value.includes('esp32:'), hasVariant:document.getElementById('yaml-content').value.includes('variant: esp32s3'), hasSda:document.getElementById('yaml-content').value.includes('i2c_sda: GPIO8'), hasRelay:document.getElementById('yaml-content').value.includes('relay_gpio: GPIO10'), status:document.getElementById('yaml-status').textContent})`);
    const yamlStatus = await evaluate(`document.getElementById('yaml-status').dataset.status`);
    report.checks.push({ name: 'ESPHome generation/validation result', result: yamlStatus, evidence: yamlCheck.status });
    check('ESPHome preview generated from fixture pin map', yamlCheck.hasEsp32 && yamlCheck.hasVariant && yamlCheck.hasSda && yamlCheck.hasRelay, JSON.stringify(yamlCheck));
    if (detected.esphome) check('ESPHome validates packaged preview with the detected CLI', yamlStatus === 'PASS' && /ESPHome .*accepted YAML/i.test(yamlCheck.status), yamlCheck.status);
    if (!detected.esphome) { notTested('ESPHome compatibility validation', 'ESPHome CLI was not installed on this Windows runner.'); check('missing ESPHome status is clear', yamlStatus === 'NOT TESTED' && /not installed|not found|not available/i.test(yamlCheck.status), yamlCheck.status); }
    await click('yaml-cancel');
  } else {
    if (hasFixture) for (const name of ['Open PCB reports detected engine result or helpful missing-tool status', 'Check Circuit executes or identifies missing KiCad CLI', 'manufacturing action executes or identifies missing KiCad CLI', 'ESPHome preview generated for fixture']) fail(name, 'Skipped because packaged ESP32 fixture did not open.');
    else for (const name of ['Open PCB engine availability action', 'Check Circuit KiCad CLI action', 'Manufacturing KiCad CLI action', 'ESPHome fixture preview']) notTested(name, 'Requires the packaged ESP32 native fixture.');
  }

  await stopPackagedApp('settings/reopen test complete');
  socket?.close(); socket = undefined;
  markStage('launch-for-persistence-check');
  await launch();
  const persistedTheme = await evaluate('document.body.dataset.theme || "dark"');
  check('theme preference persists across packaged-app restart', persistedTheme === switchedTheme, `Restarted theme=${persistedTheme}; selected=${switchedTheme}`);
  const persistedTools = await evaluate('window.circuit.getNativeTools()');
  check('selected KiCad installation persists across packaged-app restart', persistedTools.kicadInstallDir === selectedNativeTools.kicadInstallDir && persistedTools.kicadVersion === '10.0.7', JSON.stringify(persistedTools));
  const persistedRecent = await evaluate('window.circuit.getRecentProjects()');
  const recentId = hasFixture ? 'dx-esp32-bme280-relay-demo' : manifest?.projectId;
  check('recent project persists across restart', Array.isArray(persistedRecent) && persistedRecent.some(p => p.projectId === recentId), JSON.stringify(persistedRecent));
  await screenshot(`desktop-${persistedTheme}-restarted.png`);

  await stopPackagedApp('persistence test complete'); socket?.close(); socket = undefined;
  markStage('launch-with-native-tool-discovery-disabled');
  await launch({ noNativeTools: true });
  const missingTools = await evaluate('window.circuit.getNativeTools()');
  check('missing KiCad is detected with an isolated empty search path', missingTools.kicadCli === null && missingTools.kicadVersion === null, JSON.stringify(missingTools));
  await click('new-project');
  await waitUntil(`document.getElementById('result-dialog').open`, 'helpful error on New Project without KiCad');
  const missingProjectMessage = await evaluate(`document.getElementById('result-message').textContent`);
  check('New Project explains the missing KiCad requirement', /requires a runnable KiCad CLI|Install KiCad 10\.0\.7/i.test(missingProjectMessage), missingProjectMessage);
  check('missing KiCad does not leave a metadata-only project folder', !existsSync(join(missingToolsProjectRoot, 'DemonX-Circuit-Project')), 'The isolated no-tool location stayed empty after New Project was rejected.');

  if (report.unhandled.length) fail('zero renderer/preload exceptions', JSON.stringify(report.unhandled));
  else pass('zero renderer/preload exceptions', 'No CDP Runtime exceptions were observed during startup or tested clicks.');
} catch (error) {
  report.fatal = error instanceof Error ? error.stack : String(error);
  report.diagnostics.push({ kind: 'acceptance-runner-failure', text: report.fatal });
} finally {
  socket?.close();
  if (child && child.exitCode === null) {
    try { await stopPackagedApp('acceptance cleanup'); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.diagnostics.push({ kind: 'packaged-app-cleanup', text: message });
      fail('packaged app exits after acceptance', message);
    }
  }
  report.endedAt = new Date().toISOString();
  const reportPath = join(artifactDir, 'acceptance-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  // Do not recursively delete the Electron profile/project while the packaged
  // Windows runtime may still have transient handles open. On hosted runners
  // the entire workspace is discarded with the VM; local acceptance runs can
  // remove this explicitly after reviewing the report.
  console.log(`[acceptance] temporary acceptance data retained at ${workDir}`);
  clearTimeout(acceptanceWatchdog);
  // Do not let a leaked Electron helper process hold the harness open after
  // the report has been durably written and the main process tree was stopped.
  process.exit(report.fatal || report.checks.some(c => c.result === 'FAIL') ? 1 : 0);
}
