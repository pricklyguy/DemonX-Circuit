#!/usr/bin/env node
// Launches the extracted portable Windows package and drives its real renderer
// through Chromium DevTools Protocol. Native file dialogs are redirected to a
// fresh temporary project root in the test process only; project creation and
// manifest I/O still run through the packaged app's normal main-process code.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const executable = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node desktop/acceptance.mjs <portable-exe> <artifact-dir>');
const artifactDir = resolve(process.argv[3] || 'reports/desktop-acceptance');
await mkdir(artifactDir, { recursive: true });
const workDir = await mkdtemp(join(tmpdir(), 'demonx-circuit-acceptance-'));
const projectRoot = join(workDir, 'DemonX Circuit Projects');
const userData = join(workDir, 'user-data');
const fixtureDir = join(dirname(executable), 'resources', 'app', 'examples', 'esp32-sensor');
const hasFixture = existsSync(join(fixtureDir, 'native', 'DX_ESP32_Sensor.kicad_pcb'));
await mkdir(projectRoot, { recursive: true });
const port = 24000 + Math.floor(Math.random() * 12000);
const report = { executable: basename(executable), checks: [], notTested: [], diagnostics: [], screenshots: [], unhandled: [] };
let child;
let socket;
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
  socket = new WebSocket(url);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', reject, { once: true });
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
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const value = await evaluate(expression, 2000); if (value) return value; } catch {}
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function click(id) {
  return clickSelector(`#${id}`);
}
async function clickSelector(selector) {
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
async function screenshot(name) {
  const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const path = join(artifactDir, name);
  await writeFile(path, Buffer.from(result.data, 'base64'));
  report.screenshots.push(path);
}
async function launch({ noNativeTools = false } = {}) {
  const runtimeEnv = { ...process.env, DEMONX_CIRCUIT_ACCEPTANCE_ROOT: projectRoot, DEMONX_CIRCUIT_USER_DATA: noNativeTools ? join(workDir, 'missing-tools-user-data') : userData,
    DEMONX_CIRCUIT_ACCEPTANCE_FIXTURE: fixtureDir,
    DEMONX_CIRCUIT_ACCEPTANCE_KICAD_DIR: join(process.env.ProgramFiles || 'C:\\Program Files', 'KiCad', '10.0') };
  if (noNativeTools) {
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
  await cdp('Page.reload', { ignoreCache: true });
  await waitUntil(`document.readyState === 'complete'`, 'packaged page load');
  const expectedTheme = await evaluate('window.circuit.getTheme()');
  await waitUntil(`document.body.dataset.theme === ${JSON.stringify(expectedTheme)}`, 'preference loaded in packaged renderer');
}

try {
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
  const created = await waitUntil(`document.getElementById('project-state')?.textContent === 'OPEN'`, 'new project creation through packaged IPC', 5000).catch(async error => ({ error: error.message, title: await evaluate("document.getElementById('result-title')?.textContent"), message: await evaluate("document.getElementById('result-message')?.textContent") }));
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
    await waitUntil(`document.getElementById('result-dialog').open`, 'new native starter ERC/DRC action');
    const starterCheck = await evaluate(`({status:document.getElementById('result-kicker').textContent,message:document.getElementById('result-message').textContent,output:document.getElementById('result-output').textContent})`);
    check('new KiCad project runs real ERC and DRC', starterCheck.status === 'PASS' && /native KiCad check/i.test(starterCheck.message) && /ERC exit 0[\s\S]*DRC exit 0/.test(starterCheck.output), JSON.stringify(starterCheck));
    await clickSelector('#result-dialog .modal-actions button');
    const firstProjectId = manifest.projectId;
    await click('new-project');
    await waitUntil(`document.getElementById('project-id')?.textContent !== ${JSON.stringify(firstProjectId)}`, 'repeated project name creates a new native project', 5000);
    const repeatedFiles = ['DemonX-Circuit-Project-2.kicad_pro', 'DemonX-Circuit-Project-2.kicad_sch', 'DemonX-Circuit-Project-2.kicad_pcb'].map(name => ({ name, exists: existsSync(join(projectRoot, 'DemonX-Circuit-Project-2', name)) }));
    check('repeated project creation preserves the existing folder and creates a native suffixed project', repeatedFiles.every(file => file.exists) && existsSync(join(createdProjectPath, 'DemonX-Circuit-Project.kicad_pcb')), JSON.stringify(repeatedFiles));
  } else fail('Open Project reopens the created project', 'Skipped because New Project did not create its expected project file.');

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
    await waitUntil(`document.getElementById('result-dialog').open`, 'Check Circuit action result');
    const checkStatus = await evaluate(`document.getElementById('result-kicker').textContent`);
    const checkText = await evaluate(`document.getElementById('result-kicker').textContent + ': ' + document.getElementById('result-message').textContent + '\\n' + document.getElementById('result-output').textContent`);
    report.checks.push({ name: 'Check Circuit native ERC/DRC action', result: checkStatus, evidence: checkText });
    if (detected.kicadCli) check('Check Circuit reports native check output', /KiCad .*check|DRC|ERC/i.test(checkText), checkText);
    else { notTested('KiCad ERC/DRC execution', 'KiCad CLI was not found on this Windows runner.'); check('Check Circuit explains missing KiCad CLI', /NOT TESTED: KiCad CLI was not found/i.test(checkText), checkText); }
    await clickSelector('#result-dialog .modal-actions button');

    await click('prepare-manufacturing');
    await waitUntil(`document.getElementById('result-dialog').open`, 'manufacturing action result');
    const manufacturingStatus = await evaluate(`document.getElementById('result-kicker').textContent`);
    const manufacturingText = await evaluate(`document.getElementById('result-kicker').textContent + ': ' + document.getElementById('result-message').textContent`);
    report.checks.push({ name: 'Manufacturing export action', result: manufacturingStatus, evidence: manufacturingText });
    if (detected.kicadCli) check('manufacturing action reports output or DRC result', /Manufacturing|DRC/i.test(manufacturingText), manufacturingText);
    else { notTested('Gerber/Excellon/STEP export action', 'KiCad CLI was not found on this Windows runner.'); check('Manufacturing action explains missing KiCad CLI', /NOT TESTED: KiCad CLI was not found/i.test(manufacturingText), manufacturingText); }
    await clickSelector('#result-dialog .modal-actions button');

    await click('generate-esphome');
    await waitUntil(`document.getElementById('yaml-dialog').open`, 'ESPHome preview dialog');
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

  const exitPromise = new Promise(resolveExit => child.once('exit', resolveExit));
  await child.kill();
  await exitPromise;
  socket?.close(); socket = undefined;
  await launch();
  const persistedTheme = await evaluate('document.body.dataset.theme || "dark"');
  check('theme preference persists across packaged-app restart', persistedTheme === switchedTheme, `Restarted theme=${persistedTheme}; selected=${switchedTheme}`);
  const persistedTools = await evaluate('window.circuit.getNativeTools()');
  check('selected KiCad installation persists across packaged-app restart', persistedTools.kicadInstallDir === selectedNativeTools.kicadInstallDir && persistedTools.kicadVersion === '10.0.7', JSON.stringify(persistedTools));
  const persistedRecent = await evaluate('window.circuit.getRecentProjects()');
  const recentId = hasFixture ? 'dx-esp32-bme280-relay-demo' : manifest?.projectId;
  check('recent project persists across restart', Array.isArray(persistedRecent) && persistedRecent.some(p => p.projectId === recentId), JSON.stringify(persistedRecent));
  await screenshot(`desktop-${persistedTheme}-restarted.png`);

  const normalExit = new Promise(resolveExit => child.once('exit', resolveExit));
  await child.kill(); await normalExit; socket?.close(); socket = undefined;
  await launch({ noNativeTools: true });
  const missingTools = await evaluate('window.circuit.getNativeTools()');
  check('missing KiCad is detected with an isolated empty search path', missingTools.kicadCli === null && missingTools.kicadVersion === null, JSON.stringify(missingTools));
  await click('new-project');
  await waitUntil(`document.getElementById('result-dialog').open`, 'helpful error on New Project without KiCad');
  const missingProjectMessage = await evaluate(`document.getElementById('result-message').textContent`);
  check('New Project explains the missing KiCad requirement', /requires a runnable KiCad CLI|Install KiCad 10\.0\.7/i.test(missingProjectMessage), missingProjectMessage);
  check('missing KiCad does not leave a metadata-only project folder', !existsSync(join(projectRoot, 'DemonX-Circuit-Project')), 'The project directory was not created when KiCad was unavailable.');

  if (report.unhandled.length) fail('zero renderer/preload exceptions', JSON.stringify(report.unhandled));
  else pass('zero renderer/preload exceptions', 'No CDP Runtime exceptions were observed during startup or tested clicks.');
} catch (error) {
  report.fatal = error instanceof Error ? error.stack : String(error);
  report.diagnostics.push({ kind: 'acceptance-runner-failure', text: report.fatal });
} finally {
  socket?.close();
  if (child && child.exitCode === null) { const exitPromise = new Promise(resolveExit => child.once('exit', resolveExit)); child.kill(); await exitPromise; }
  report.endedAt = new Date().toISOString();
  const reportPath = join(artifactDir, 'acceptance-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await rm(workDir, { recursive: true, force: true });
  if (report.fatal || report.checks.some(c => c.result === 'FAIL')) process.exitCode = 1;
}
