const { app, BrowserWindow, dialog, ipcMain, nativeTheme } = require('electron');
if (process.argv.includes('--capture-screenshot')) app.commandLine.appendSwitch('disable-gpu');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const acceptanceRoot = process.env.DEMONX_CIRCUIT_ACCEPTANCE_ROOT;
if (acceptanceRoot) {
  const userData = process.env.DEMONX_CIRCUIT_USER_DATA;
  const acceptanceFixture = process.env.DEMONX_CIRCUIT_ACCEPTANCE_FIXTURE;
  let openRequests = 0;
  if (userData) app.setPath('userData', path.resolve(userData));
  const actualShowOpenDialog = dialog.showOpenDialog.bind(dialog);
  dialog.showOpenDialog = async (parent, options = {}) => {
    if (options.title === 'Choose a parent folder for the new project') return { canceled: false, filePaths: [path.resolve(acceptanceRoot)] };
    if (options.title === 'Open DemonX Circuit Project') {
      openRequests++;
      const fixture = openRequests > 1 && acceptanceFixture ? path.resolve(acceptanceFixture) : path.join(path.resolve(acceptanceRoot), 'DemonX-Circuit-Project');
      return { canceled: false, filePaths: [fixture] };
    }
    return actualShowOpenDialog(parent, options);
  };
  dialog.showMessageBox = async () => ({ response: 0 });
}

process.on('uncaughtException', error => { console.error('[Circuit main] uncaught exception', error); });
process.on('unhandledRejection', error => { console.error('[Circuit main] unhandled rejection', error); });

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, '..');
let activeProject = null;
let win;
const pendingYamlReplacements = new Map();
const preferencesFile = path.join(app.getPath('userData'), 'preferences.json');

async function readPreferences() {
  try { return JSON.parse(await fs.readFile(preferencesFile, 'utf8')); }
  catch { return {}; }
}
async function writePreferences(next) {
  await fs.mkdir(path.dirname(preferencesFile), { recursive: true });
  const temp = `${preferencesFile}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
  await fs.rename(temp, preferencesFile);
}
async function rememberProject(project) {
  const prefs = await readPreferences();
  const recent = [{ projectId: project.projectId, name: project.name, root: project.root }, ...(prefs.recent || []).filter(item => item.projectId !== project.projectId)].slice(0, 8);
  await writePreferences({ ...prefs, recent });
}

function localExecutable(name, candidates = []) {
  for (const candidate of candidates) {
    try { require('node:fs').accessSync(candidate); return candidate; } catch { /* try the next documented location */ }
  }
  return name;
}
function kicadCli() {
  const options = process.platform === 'win32'
    ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'KiCad', '10.0', 'bin', 'kicad-cli.exe')]
    : ['/usr/bin/kicad-cli', '/usr/local/bin/kicad-cli'];
  for (const candidate of options) { try { require('node:fs').accessSync(candidate); return candidate; } catch {} }
  return process.platform === 'win32' ? 'kicad-cli.exe' : 'kicad-cli';
}
function esphomeCli() { return process.platform === 'win32' ? 'esphome.exe' : 'esphome'; }
async function findOnPath(binary) {
  try { await execFileAsync(binary, ['version'], { timeout: 8000, windowsHide: true }); return binary; }
  catch (error) {
    if (error.code !== 'ENOENT') return binary;
    return null;
  }
}
async function run(binary, args, cwd, timeout = 120000, extraEnv = {}) {
  try {
    const result = await execFileAsync(binary, args, { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...extraEnv } });
    return { code: 0, stdout: result.stdout || '', stderr: result.stderr || '', output: `${result.stdout || ''}${result.stderr || ''}`.trim() };
  } catch (error) {
    return { code: typeof error.code === 'number' ? error.code : 1, stdout: error.stdout || '', stderr: error.stderr || '', output: `${error.stdout || ''}${error.stderr || error.message || ''}`.trim() };
  }
}
function result(status, title, message, extra = {}) { return { status, title, message, ...extra }; }
function safeInside(root, rel) {
  if (typeof rel !== 'string' || path.isAbsolute(rel)) throw new Error('Project manifest paths must be relative.');
  const resolved = path.resolve(root, rel);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) throw new Error('Project manifest path escapes its project folder.');
  return resolved;
}
async function summarize(root) {
  const manifestPath = path.join(root, 'project.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (manifest.format !== 'demonx-project') throw new Error('This folder does not contain a DemonX project manifest.');
  const files = manifest.native?.files || [];
  let schematic, pcb;
  const missingNative = [];
  for (const rel of files) {
    const full = safeInside(root, rel);
    try { await fs.access(full); }
    catch { missingNative.push(rel); continue; }
    if (rel.endsWith('.kicad_sch')) schematic = full;
    if (rel.endsWith('.kicad_pcb')) pcb = full;
  }
  const components = (manifest.hardware?.components || []).map(c => ({ ref: c.ref, value: c.value, kind: c.kind }));
  const libraries = [];
  if (Array.isArray(manifest.libraries)) {
    for (const entry of manifest.libraries) {
      if (!entry || typeof entry.id !== 'string' || typeof entry.path !== 'string') continue;
      const symbolDir = safeInside(root, entry.path);
      const footprintDir = entry.footprints ? safeInside(root, entry.footprints) : null;
      let count = 0;
      try { if (entry.path.endsWith('.json') || (await fs.stat(symbolDir)).isFile()) count++; else count += (await fs.readdir(symbolDir)).filter(f => f.endsWith('.kicad_sym') || f.endsWith('.json')).length; } catch {}
      try { if (footprintDir) count += (await fs.readdir(footprintDir)).filter(f => f.endsWith('.kicad_mod')).length; } catch {}
      libraries.push({ name: entry.id, path: symbolDir, count });
    }
  }
  if (!libraries.length) {
    const libraryRoot = path.join(root, 'libraries');
    try {
      for (const entry of await fs.readdir(libraryRoot, { withFileTypes: true })) {
        const dir = path.join(libraryRoot, entry.name);
        if (!entry.isDirectory()) continue;
        let count = 0;
        try { count = (await fs.readdir(dir)).filter(f => f.endsWith('.json') || f.endsWith('.kicad_sym') || f.endsWith('.kicad_mod')).length; } catch {}
        libraries.push({ name: entry.name, path: dir, count });
      }
    } catch {}
  }
  return { name: manifest.name || path.basename(root), projectId: manifest.projectId || '', revision: manifest.revision || '', root,
    nativeStatus: `${manifest.native?.status || 'No native status recorded.'}${missingNative.length ? ` Missing from this project folder: ${missingNative.join(', ')}.` : ''}`, components, libraries, files: { schematic, pcb } };
}
async function selectProject() {
  const picked = await dialog.showOpenDialog(win, { title: 'Open DemonX Circuit Project', properties: ['openDirectory'] });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const summary = await summarize(picked.filePaths[0]);
  activeProject = summary;
  await rememberProject(summary);
  win.webContents.send('project:changed', summary);
  return summary;
}
function ensureProject() { if (!activeProject) throw new Error('Open or create a project first.'); return activeProject; }
function register(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== win.webContents) throw new Error('Rejected IPC request from an untrusted renderer.');
    return handler(...args);
  });
}

register('env:get', async () => {
  const [kicad, esphome] = await Promise.all([findOnPath(kicadCli()), findOnPath(esphomeCli())]);
  const editorCandidates = process.platform === 'win32'
    ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'KiCad', '10.0', 'bin', 'kicad.exe'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'KiCad', '10.0', 'bin', 'pcbnew.exe')]
    : ['/usr/bin/pcbnew', '/usr/local/bin/pcbnew'];
  const kicadEditor = editorCandidates.find(candidate => { try { require('node:fs').accessSync(candidate); return true; } catch { return false; } }) || null;
  return { kicad, kicadEditor, esphome, version: app.getVersion() };
});
register('project:new', async () => {
  const picked = await dialog.showOpenDialog(win, { title: 'Choose a parent folder for the new project', properties: ['openDirectory', 'createDirectory'] });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const nameAnswer = await dialog.showMessageBox(win, { type: 'info', buttons: ['Create project folder', 'Cancel'], defaultId: 0,
    title: 'New Circuit Project', message: 'Create a new DemonX project in the selected folder?', detail: 'A project folder and portable project.json will be created. No schematic or PCB is generated.' });
  if (nameAnswer.response !== 0) return null;
  let base = path.join(picked.filePaths[0], 'DemonX-Circuit-Project');
  for (let suffix = 2; ; suffix++) {
    try { await fs.mkdir(base); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; base = path.join(picked.filePaths[0], `DemonX-Circuit-Project-${suffix}`); }
  }
  const manifest = { format: 'demonx-project', formatVersion: '0.1.0', projectId: `dx-${Date.now().toString(36)}`, name: 'New Circuit Project', revision: '0.1.0', libraries: [], native: { engine: 'kicad', engineVersion: '10.0.7', files: [], status: 'Native design not created.' }, hardware: { components: [], nets: [], pinMap: {} }, manufacturing: { status: 'not-created', coordinateUnits: 'mm', origin: 'KiCad auxiliary origin' } };
  await fs.mkdir(path.join(base, 'libraries'));
  await fs.writeFile(path.join(base, 'project.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  activeProject = await summarize(base);
  await rememberProject(activeProject);
  win.webContents.send('project:changed', activeProject);
  return activeProject;
});
register('project:open', selectProject);
register('project:recent', async () => (await readPreferences()).recent || []);
register('project:open-recent', async projectId => {
  const entry = ((await readPreferences()).recent || []).find(item => item.projectId === projectId);
  if (!entry) throw new Error('This recent project is no longer available. Use Open Project to locate it again.');
  const summary = await summarize(entry.root);
  activeProject = summary;
  await rememberProject(summary);
  win.webContents.send('project:changed', summary);
  return summary;
});
register('project:inspect', async () => activeProject ? summarize(activeProject.root) : null);
register('theme:get', async () => {
  const prefs = await readPreferences();
  const theme = prefs.theme === 'light' ? 'light' : 'dark';
  nativeTheme.themeSource = theme;
  return theme;
});
register('theme:set', async theme => {
  if (theme !== 'dark' && theme !== 'light') throw new Error('Unsupported theme.');
  nativeTheme.themeSource = theme;
  await writePreferences({ ...(await readPreferences()), theme });
});
register('native:open', async kind => {
  const project = ensureProject();
  if (kind !== 'schematic' && kind !== 'pcb') throw new Error('Unsupported native document.');
  const file = project.files[kind];
  if (!file) return result('NOT TESTED', `Open ${kind}`, `No ${kind} file is listed in this project.`);
  try { await fs.access(file); } catch { return result('NOT TESTED', `Open ${kind}`, `The project references a missing ${kind} file: ${file}`); }
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'KiCad', '10.0', 'bin', 'kicad.exe'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'KiCad', '10.0', 'bin', kind === 'pcb' ? 'pcbnew.exe' : 'eeschema.exe')]
    : [kind === 'pcb' ? '/usr/bin/pcbnew' : '/usr/bin/eeschema', kind === 'pcb' ? '/usr/local/bin/pcbnew' : '/usr/local/bin/eeschema'];
  let executable = candidates.find(candidate => { try { require('node:fs').accessSync(candidate); return true; } catch { return false; } });
  if (!executable) return result('NOT TESTED', `Open ${kind}`, 'KiCad desktop editor was not found. Install KiCad 10.0.7 separately; Circuit does not install it.');
  const launched = spawn(executable, [file], { detached: true, stdio: 'ignore', windowsHide: false });
  launched.unref();
  return result('PASS', `Open ${kind}`, `Started KiCad with ${path.basename(file)}.`);
});
register('circuit:check', async () => {
  const project = ensureProject();
  const cli = await findOnPath(kicadCli());
  if (!cli) return result('NOT TESTED', 'Check Circuit', 'KiCad CLI was not found. Install KiCad 10.0.7 separately.');
  const reportDir = path.join(project.root, 'reports', `check-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`);
  await fs.mkdir(reportDir, { recursive: true });
  const reports = [];
  let failed = false, tested = 0;
  for (const [kind, file] of [['ERC', project.files.schematic], ['DRC', project.files.pcb]]) {
    if (!file) continue;
    try { await fs.access(file); } catch { continue; }
    tested++;
    const report = path.join(reportDir, `${kind.toLowerCase()}.rpt`);
    const args = kind === 'ERC' ? ['sch', 'erc', '--severity-all', '--exit-code-violations', '--output', report, file] : ['pcb', 'drc', '--severity-all', '--exit-code-violations', '--output', report, file];
    const runResult = await run(cli, args, project.root);
    let text = runResult.output;
    try { text = `${text}\n${await fs.readFile(report, 'utf8')}`.trim(); } catch {}
    if (runResult.code !== 0) failed = true;
    reports.push(`${kind} exit ${runResult.code}\n${text}`);
  }
  if (!tested) return result('NOT TESTED', 'Check Circuit', 'This project has no native schematic or PCB to check.', { reportPaths: [] });
  return result(failed ? 'FAIL' : 'PASS', 'Check Circuit', `${tested} native KiCad check(s) executed with ${cli}.`, { output: reports.join('\n\n'), reportPaths: [reportDir] });
});
register('manufacturing:prepare', async () => {
  const project = ensureProject();
  if (!project.files.pcb) return result('NOT TESTED', 'Prepare Manufacturing Files', 'This project has no native PCB file.');
  const cli = await findOnPath(kicadCli());
  if (!cli) return result('NOT TESTED', 'Prepare Manufacturing Files', 'KiCad CLI was not found. Install KiCad 10.0.7 separately.');
  try { await fs.access(project.files.pcb); } catch { return result('NOT TESTED', 'Prepare Manufacturing Files', 'The project PCB file is missing.'); }
  const checkDir = path.join(project.root, 'reports', 'manufacturing-precheck'); await fs.mkdir(checkDir, { recursive: true });
  const checkReport = path.join(checkDir, 'drc.rpt');
  const drc = await run(cli, ['pcb', 'drc', '--severity-all', '--exit-code-violations', '--output', checkReport, project.files.pcb], project.root);
  if (drc.code !== 0) return result('FAIL', 'Manufacturing precheck', 'DRC failed; no manufacturing exports were produced.', { output: drc.output, reportPaths: [checkReport] });
  const date = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
  const out = path.join(project.root, 'manufacturing', `export-${date}`);
  await fs.mkdir(out, { recursive: true });
  await fs.mkdir(path.join(out, 'gerbers')); await fs.mkdir(path.join(out, 'drill')); await fs.mkdir(path.join(out, 'step'));
  const pcb = project.files.pcb;
  const commands = [
    [cli, ['pcb', 'export', 'gerbers', '--board-plot-params', '--layers', 'F.Cu,B.Cu,F.Mask,B.Mask,F.Silkscreen,Edge.Cuts', '--output', path.join(out, 'gerbers') + path.sep, pcb]],
    [cli, ['pcb', 'export', 'drill', '--format', 'excellon', '--excellon-units', 'mm', '--drill-origin', 'absolute', '--output', path.join(out, 'drill') + path.sep, pcb]],
    [cli, ['pcb', 'export', 'step', '--output', path.join(out, 'step', 'assembly.step'), pcb]]
  ];
  const outputs = [];
  for (const [binary, args] of commands) { const r = await run(binary, args, project.root); outputs.push(r.output); if (r.code !== 0) return result('FAIL', 'Manufacturing export', `KiCad export command exited ${r.code}.`, { output: outputs.join('\n'), reportPaths: [out] }); }
  const inventory = [];
  for (const folder of ['gerbers', 'drill', 'step']) for (const name of await fs.readdir(path.join(out, folder))) { const f = path.join(out, folder, name); inventory.push(`${folder}/${name}: ${(await fs.stat(f)).size} bytes`); }
  const gerberNames = await fs.readdir(path.join(out, 'gerbers'));
  const drillNames = await fs.readdir(path.join(out, 'drill'));
  const stepInfo = await fs.stat(path.join(out, 'step', 'assembly.step')).catch(() => null);
  if (!gerberNames.some(name => /F[_\.]Cu/i.test(name)) || !gerberNames.some(name => /B[_\.]Cu/i.test(name)) || !drillNames.length || !stepInfo?.size) return result('FAIL', 'Manufacturing export', 'KiCad commands exited successfully but one or more required copper, drill or STEP files are missing or empty.', { output: `${outputs.join('\n')}\n\n${inventory.join('\n')}`, reportPaths: [out, checkReport] });
  return result('PASS', 'Manufacturing export', 'KiCad DRC and exports completed. Inspect the report and files before fabrication; this is not manufacturing approval.', { output: `${outputs.join('\n')}\n\n${inventory.join('\n')}`, reportPaths: [out, checkReport] });
});
register('esphome:preview', async () => {
  const project = ensureProject();
  const manifestPath = path.join(project.root, 'project.json');
  const generator = path.join(repoRoot, 'prototype', 'generate-esphome.mjs');
  const r = await run(process.execPath, [generator, '--stdout', '--project', manifestPath], repoRoot, 120000, { ELECTRON_RUN_AS_NODE: '1' });
  if (r.code !== 0) return result('FAIL', 'Generate ESPHome YAML', r.output);
  const cli = await findOnPath(esphomeCli());
  const yaml = r.stdout;
  if (!cli) return { ...result('NOT TESTED', 'Generate ESPHome YAML', 'Preview generated from the project manifest only. ESPHome CLI is not installed; compatibility validation is NOT TESTED.'), output: r.stderr.trim(), yaml };
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'demonx-circuit-esphome-'));
  try {
    await fs.writeFile(path.join(tempDir, 'dx-preview.yaml'), yaml, { flag: 'wx' });
    const randomKey = crypto.randomBytes(32).toString('base64');
    await fs.writeFile(path.join(tempDir, 'secrets.yaml'), `wifi_ssid: "validation-placeholder"\nwifi_password: "validation-placeholder"\napi_encryption_key: "${randomKey}"\nota_password: "validation-placeholder"\nfallback_ap_password: "${randomKey.slice(0, 24)}"\n`, { flag: 'wx' });
    const validation = await run(cli, ['config', 'dx-preview.yaml'], tempDir, 120000, { HOME: tempDir, USERPROFILE: tempDir });
    const version = await run(cli, ['version'], tempDir, 15000);
    if (validation.code !== 0) return { ...result('FAIL', 'Generate ESPHome YAML', `ESPHome ${version.output || 'CLI'} rejected the preview. Validation diagnostics may contain configuration data and were not retained.`), yaml };
    return { ...result('PASS', 'Generate ESPHome YAML', `ESPHome ${version.output || 'CLI'} accepted YAML generated from project manifest only. Native connectivity was not verified.`), output: r.stderr.trim(), yaml };
  } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
});
register('esphome:save', async (yaml, replaceApproved, approvedDestination) => {
  if (typeof yaml !== 'string' || yaml.length < 20 || yaml.length > 200000) throw new Error('Invalid ESPHome preview payload.');
  let destination;
  if (replaceApproved) {
    if (typeof approvedDestination !== 'string') throw new Error('Approved replacement has no staged destination.');
    destination = path.resolve(approvedDestination);
  } else {
    const picked = await dialog.showSaveDialog(win, { title: 'Save ESPHome YAML', defaultPath: path.join(ensureProject().root, 'firmware', 'dx-esp32-sensor.yaml'), filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }] });
    if (picked.canceled || !picked.filePath) return result('CANCELLED', 'Save ESPHome YAML', 'Save cancelled.');
    destination = path.resolve(picked.filePath);
  }
  if (!['.yaml', '.yml'].includes(path.extname(destination).toLowerCase())) return result('FAIL', 'Save ESPHome YAML', 'Choose a .yaml or .yml destination.');
  let existing;
  try { existing = await fs.readFile(destination, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (existing !== undefined && !replaceApproved) {
    const backupPath = `${destination}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    await fs.copyFile(destination, backupPath, require('node:fs').constants.COPYFILE_EXCL);
    pendingYamlReplacements.set(destination, { backupPath, beforeHash: crypto.createHash('sha256').update(existing).digest('hex') });
    return { ...result('NOT TESTED', 'Review file replacement', 'A non-overwriting backup now exists. Review the diff and approve before the original file is changed.', { destination, reportPaths: [backupPath] }), existingText: existing, destination, backupPath };
  }
  if (existing !== undefined) {
    const staged = pendingYamlReplacements.get(destination);
    if (!staged) throw new Error('No reviewed replacement is staged for this file. Start the Save As flow again.');
    const currentHash = crypto.createHash('sha256').update(existing).digest('hex');
    const backupText = await fs.readFile(staged.backupPath, 'utf8');
    if (currentHash !== staged.beforeHash || crypto.createHash('sha256').update(backupText).digest('hex') !== staged.beforeHash) throw new Error('The source file or its backup changed after review; replacement refused.');
    await fs.writeFile(destination, yaml, 'utf8');
    pendingYamlReplacements.delete(destination);
    return result('PASS', 'ESPHome YAML replaced', `Replaced after approval. Backup: ${staged.backupPath}`, { destination, reportPaths: [staged.backupPath] });
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, yaml, { flag: 'wx' });
  return result('PASS', 'ESPHome YAML saved', `Created new file: ${destination}. Schema validation is a separate step.`, { destination });
});

async function createWindow() {
  const prefs = await readPreferences();
  nativeTheme.themeSource = prefs.theme === 'light' ? 'light' : 'dark';
  const preloadPath = path.join(__dirname, 'dist', 'preload.js');
  console.log(`[Circuit main] packaged=${app.isPackaged}; appPath=${app.getAppPath()}; preload=${preloadPath}; preloadExists=${require('node:fs').existsSync(preloadPath)}`);
  win = new BrowserWindow({ width: 1120, height: 720, minWidth: 860, minHeight: 600, backgroundColor: '#0f1519', title: 'DemonX Circuit', webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  win.webContents.on('console-message', (_event, ...details) => console.error('[Circuit renderer console]', ...details));
  win.webContents.on('preload-error', (_event, preload, error) => console.error('[Circuit preload error]', preload, error));
  win.webContents.on('did-fail-load', (_event, code, description, url) => console.error('[Circuit load error]', code, description, url));
  win.webContents.on('render-process-gone', (_event, details) => console.error('[Circuit renderer process gone]', details));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  await win.loadFile(path.join(__dirname, 'index.html'));
  if (process.argv.includes('--capture-screenshot')) {
    await new Promise(resolve => setTimeout(resolve, 600));
    const image = await win.webContents.capturePage();
    const output = path.join(repoRoot, 'reports', 'checkpoint-3', 'desktop-preview.png');
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, image.toPNG());
    console.log(`Captured real Electron renderer: ${output}`);
    app.quit();
  }
}
app.whenReady().then(createWindow).catch(error => { console.error('[Circuit main] window startup failed', error); app.exit(1); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
