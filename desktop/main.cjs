const { app, BrowserWindow, dialog, ipcMain, nativeTheme } = require('electron');
if (process.argv.includes('--capture-screenshot')) app.commandLine.appendSwitch('disable-gpu');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { validateSchematic } = require('./dist/schematic-model.js');

const acceptanceRoot = process.env.DEMONX_CIRCUIT_ACCEPTANCE_ROOT;
if (acceptanceRoot) {
  const userData = process.env.DEMONX_CIRCUIT_USER_DATA;
  const acceptanceFixture = process.env.DEMONX_CIRCUIT_ACCEPTANCE_FIXTURE;
  let openRequests = 0;
  if (userData) app.setPath('userData', path.resolve(userData));
  const actualShowOpenDialog = dialog.showOpenDialog.bind(dialog);
  dialog.showOpenDialog = async (parent, options = {}) => {
    if (options.title === 'Choose a parent folder for the new project') return { canceled: false, filePaths: [path.resolve(acceptanceRoot)] };
    if (options.title === 'Select KiCad 10.0.7 installation folder' && process.env.DEMONX_CIRCUIT_ACCEPTANCE_KICAD_DIR) return { canceled: false, filePaths: [path.resolve(process.env.DEMONX_CIRCUIT_ACCEPTANCE_KICAD_DIR)] };
    if (options.title === 'Select ESPHome CLI executable') return { canceled: true, filePaths: [] };
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
const SUPPORTED_KICAD_VERSION = '10.0.7';

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
function exists(file) { try { require('node:fs').accessSync(file); return true; } catch { return false; } }
function installationCandidates() {
  if (acceptanceRoot && process.env.DEMONX_CIRCUIT_ACCEPTANCE_NO_NATIVE_TOOLS === '1') return [];
  if (process.platform === 'win32') return [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'KiCad', '10.0'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'KiCad', '10.0'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'KiCad', '10.0')
  ].filter(Boolean);
  return ['/usr', '/usr/local'];
}
function toolsFromRoot(root) {
  if (!root) return null;
  const bin = path.basename(root).toLowerCase() === 'bin' ? root : path.join(root, 'bin');
  const exe = process.platform === 'win32' ? '.exe' : '';
  const cli = path.join(bin, `kicad-cli${exe}`);
  const manager = path.join(bin, `kicad${exe}`);
  const eeschema = path.join(bin, `eeschema${exe}`);
  const pcbnew = path.join(bin, `pcbnew${exe}`);
  return exists(cli) ? { root: path.basename(root).toLowerCase() === 'bin' ? path.dirname(root) : root, cli, manager: exists(manager) ? manager : null, eeschema: exists(eeschema) ? eeschema : null, pcbnew: exists(pcbnew) ? pcbnew : null } : null;
}
async function probeExecutable(binary, args = ['version']) {
  if (!binary) return { path: null, version: null, error: 'Not configured or not found.' };
  try {
    const response = await execFileAsync(binary, args, { timeout: 12000, windowsHide: true, maxBuffer: 1024 * 1024 });
    const output = `${response.stdout || ''}${response.stderr || ''}`.trim();
    return { path: binary, version: output.split(/\r?\n/)[0] || 'unknown', error: null };
  } catch (error) {
    if (error.code === 'ENOENT') return { path: null, version: null, error: 'Executable was not found.' };
    return { path: binary, version: null, error: `${error.message || 'Version probe failed.'}${error.stdout ? ` ${error.stdout.trim()}` : ''}`.trim() };
  }
}
async function selectedToolPaths() {
  const prefs = await readPreferences();
  for (const root of [prefs.nativeTools?.kicadInstallDir, ...installationCandidates()].filter(Boolean)) {
    const detected = toolsFromRoot(root);
    if (detected) return detected;
  }
  return null;
}
async function getNativeTools() {
  const prefs = await readPreferences();
  const kicadPaths = await selectedToolPaths();
  const kicadProbe = await probeExecutable(kicadPaths?.cli || (process.platform === 'win32' ? 'kicad-cli.exe' : 'kicad-cli'));
  const esphomePath = prefs.nativeTools?.esphomeExecutable || (process.platform === 'win32' ? 'esphome.exe' : 'esphome');
  const esphomeProbe = await probeExecutable(esphomePath);
  const cliVersion = kicadProbe.version?.match(/\b\d+\.\d+\.\d+\b/)?.[0] || null;
  const editorPath = kicadPaths?.manager || kicadPaths?.eeschema || null;
  const compatible = cliVersion === SUPPORTED_KICAD_VERSION;
  return {
    kicadInstallDir: kicadPaths?.root || prefs.nativeTools?.kicadInstallDir || null,
    kicadCli: kicadProbe.path, kicadVersion: cliVersion, kicadCliError: kicadProbe.error,
    kicadEditor: editorPath, kicadEditorVersion: editorPath ? cliVersion : null,
    eeschema: kicadPaths?.eeschema || null, pcbnew: kicadPaths?.pcbnew || null,
    compatible, compatibilityMessage: cliVersion && !compatible ? `KiCad ${SUPPORTED_KICAD_VERSION} is the verified version. Detected ${cliVersion}; native file compatibility is not verified.` : null,
    esphome: esphomeProbe.path, esphomeVersion: esphomeProbe.version, esphomeError: esphomeProbe.error,
    version: app.getVersion()
  };
}
async function findOnPath(binary) {
  const detected = await probeExecutable(binary);
  return detected.path;
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
    nativeStatus: `${manifest.native?.status || 'No native status recorded.'}${missingNative.length ? ` Missing from this project folder: ${missingNative.join(', ')}.` : ''}`, components, libraries,
    capabilities: { esphome: manifest.firmware?.target === 'esphome' && !!manifest.hardware?.controller?.esphomeVariant && !!manifest.hardware?.pinMap },
    files: { schematic, pcb } };
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
  return getNativeTools();
});
register('native-tools:select-kicad', async () => {
  const picked = await dialog.showOpenDialog(win, { title: 'Select KiCad 10.0.7 installation folder', properties: ['openDirectory'] });
  if (picked.canceled || !picked.filePaths[0]) return getNativeTools();
  const root = path.resolve(picked.filePaths[0]);
  const paths = toolsFromRoot(root);
  if (!paths) throw new Error('The selected folder does not contain KiCad CLI in its bin directory. Select the KiCad installation root or its bin folder.');
  const probe = await probeExecutable(paths.cli);
  if (probe.error || !probe.version) throw new Error(`KiCad CLI could not be run: ${probe.error || 'unknown version'}`);
  await writePreferences({ ...(await readPreferences()), nativeTools: { ...(await readPreferences()).nativeTools, kicadInstallDir: paths.root } });
  return getNativeTools();
});
register('native-tools:select-esphome', async () => {
  const picked = await dialog.showOpenDialog(win, { title: 'Select ESPHome CLI executable', properties: ['openFile'], filters: process.platform === 'win32' ? [{ name: 'Executable', extensions: ['exe'] }] : [] });
  if (picked.canceled || !picked.filePaths[0]) return getNativeTools();
  const executable = path.resolve(picked.filePaths[0]);
  const probe = await probeExecutable(executable);
  if (probe.error || !probe.version) throw new Error(`ESPHome CLI could not be run: ${probe.error || 'unknown version'}`);
  const prefs = await readPreferences();
  await writePreferences({ ...prefs, nativeTools: { ...(prefs.nativeTools || {}), esphomeExecutable: executable } });
  return getNativeTools();
});
register('project:new', async () => {
  const tools = await getNativeTools();
  if (!tools.kicadCli || !tools.kicadVersion) throw new Error(`New Project requires a runnable KiCad CLI. ${tools.kicadCliError || 'Install KiCad 10.0.7 separately or select its installation in Settings.'}`);
  if (!tools.compatible) throw new Error(tools.compatibilityMessage || `This preview is validated with KiCad ${SUPPORTED_KICAD_VERSION}.`);
  const picked = await dialog.showOpenDialog(win, { title: 'Choose a parent folder for the new project', properties: ['openDirectory', 'createDirectory'] });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const nameAnswer = await dialog.showMessageBox(win, { type: 'info', buttons: ['Create project folder', 'Cancel'], defaultId: 0,
    title: 'New Circuit Project', message: 'Create a KiCad starter project in the selected folder?', detail: 'The starter includes an editable LED/resistor schematic and board. You can replace or edit it in KiCad.' });
  if (nameAnswer.response !== 0) return null;
  let base = path.join(picked.filePaths[0], 'DemonX-Circuit-Project');
  for (let suffix = 2; ; suffix++) {
    try { await fs.mkdir(base); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; base = path.join(picked.filePaths[0], `DemonX-Circuit-Project-${suffix}`); }
  }
  const projectName = path.basename(base);
  const fixtureDir = path.join(repoRoot, 'examples', 'native-smoke', 'DX_LED_Smoke');
  for (const extension of ['kicad_pro', 'kicad_sch', 'kicad_pcb']) {
    const source = path.join(fixtureDir, `DX_LED_Smoke.${extension}`);
    const destination = path.join(base, `${projectName}.${extension}`);
    try { await fs.copyFile(source, destination, require('node:fs').constants.COPYFILE_EXCL); }
    catch (error) { await fs.rm(base, { recursive: true, force: true }); throw new Error(`Verified KiCad starter template is unavailable (${path.basename(source)}): ${error.message}.`); }
  }
  const projectFile = path.join(base, `${projectName}.kicad_pro`);
  const projectSettings = JSON.parse(await fs.readFile(projectFile, 'utf8'));
  if (projectSettings.meta) projectSettings.meta.filename = `${projectName}.kicad_pro`;
  await fs.writeFile(projectFile, `${JSON.stringify(projectSettings, null, 2)}\n`);
  await fs.mkdir(path.join(base, 'libraries', 'DemonX_Project.pretty'), { recursive: true });
  await fs.mkdir(path.join(base, 'reports'), { recursive: true });
  await fs.mkdir(path.join(base, 'manufacturing'), { recursive: true });
  const schematicRevisionDir = path.join(base, 'schematic-circuit', 'revisions');
  await fs.mkdir(schematicRevisionDir, { recursive: true });
  const editableSchematic = path.join(repoRoot, 'examples', 'native-smoke', 'led-resistor.dxcircuit.json');
  try { await fs.copyFile(editableSchematic, path.join(schematicRevisionDir, '000001-starter.json'), require('node:fs').constants.COPYFILE_EXCL); }
  catch (error) { await fs.rm(base, { recursive: true, force: true }); throw new Error(`DemonX schematic starter model is unavailable (${path.basename(editableSchematic)}): ${error.message}.`); }
  const installTemplate = path.join(tools.kicadInstallDir, 'share', 'kicad', 'template');
  for (const table of ['sym-lib-table', 'fp-lib-table']) {
    const tableSource = path.join(installTemplate, table);
    try {
      const contents = await fs.readFile(tableSource, 'utf8');
      const localEntry = table === 'sym-lib-table'
        ? '\n  (lib (name "DemonX_Project")(type "KiCad")(uri "${KIPRJMOD}/libraries/DemonX_Project.kicad_sym")(options "")(descr "Project-owned symbols"))\n'
        : '\n  (lib (name "DemonX_Project")(type "KiCad")(uri "${KIPRJMOD}/libraries/DemonX_Project.pretty")(options "")(descr "Project-owned footprints"))\n';
      await fs.writeFile(path.join(base, table), contents.replace(/\)\s*$/, `${localEntry})\n`), { flag: 'wx' });
    } catch (error) { await fs.rm(base, { recursive: true, force: true }); throw new Error(`KiCad project library configuration is unavailable (${table}). ${error.message}`); }
  }
  const symbolLib = path.join(base, 'libraries', 'DemonX_Project.kicad_sym');
  await fs.writeFile(symbolLib, '(kicad_symbol_lib (version 20231120) (generator "kicad_symbol_editor"))\n', { flag: 'wx' });
  const initialCheckDir = path.join(base, 'reports', 'project-created');
  await fs.mkdir(initialCheckDir, { recursive: true });
  const initialChecks = [
    ['ERC', ['sch', 'erc', '--severity-all', '--exit-code-violations', '--output', path.join(initialCheckDir, 'erc.rpt'), path.join(base, `${projectName}.kicad_sch`)]],
    ['DRC', ['pcb', 'drc', '--severity-all', '--exit-code-violations', '--output', path.join(initialCheckDir, 'drc.rpt'), path.join(base, `${projectName}.kicad_pcb`)]]
  ];
  for (const [kind, args] of initialChecks) {
    const check = await run(tools.kicadCli, args, base);
    if (check.code !== 0) {
      await fs.rm(base, { recursive: true, force: true });
      throw new Error(`KiCad ${tools.kicadVersion} rejected the starter project during ${kind} (exit ${check.code}). ${check.output}`);
    }
  }
  const projectId = `dx-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const manifest = { format: 'demonx-project', formatVersion: '0.2.0', projectId, name: projectName, revision: '0.1.0', editableSchematic: { format: 'demonx-schematic', revisions: 'schematic-circuit/revisions' }, libraries: [{ id: 'DemonX_Project', path: 'libraries/DemonX_Project.kicad_sym', footprints: 'libraries/DemonX_Project.pretty' }], native: { engine: 'kicad', engineVersion: tools.kicadVersion, files: [`${projectName}.kicad_pro`, `${projectName}.kicad_sch`, `${projectName}.kicad_pcb`, 'sym-lib-table', 'fp-lib-table'], status: 'Native LED/resistor starter project created and ERC/DRC checked by KiCad 10.0.7.' }, hardware: { components: [{ ref: 'J1', value: '5V INPUT', kind: 'connector' }, { ref: 'R1', value: '330', kind: 'resistor' }, { ref: 'D1', value: 'RED LED', kind: 'LED' }], nets: [{ name: '5V_IN' }, { name: 'GND' }], pinMap: {} }, manufacturing: { status: 'not-created', coordinateUnits: 'mm', origin: 'KiCad auxiliary origin' } };
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
register('schematic-model:load', async () => {
  const project = ensureProject();
  const directory = safeInside(project.root, 'schematic-circuit/revisions');
  let entries;
  try { entries = await fs.readdir(directory); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const revisions = entries.filter(name => /^\d{6}-.+\.json$/i.test(name)).sort();
  if (!revisions.length) return null;
  const file = safeInside(project.root, `schematic-circuit/revisions/${revisions[revisions.length - 1]}`);
  const text = await fs.readFile(file, 'utf8');
  if (Buffer.byteLength(text, 'utf8') > 2 * 1024 * 1024) throw new Error('The latest DemonX schematic revision is larger than the 2 MB safety limit.');
  return JSON.parse(text);
});
register('schematic-model:save', async model => {
  const project = ensureProject();
  if (!model || typeof model !== 'object' || Array.isArray(model) || model.format !== 'demonx-schematic' || model.formatVersion !== 1 || model.gridMm !== 1.27 || !Array.isArray(model.components) || !Array.isArray(model.junctions) || !Array.isArray(model.wires) || !Array.isArray(model.labels)) throw new Error('Rejected malformed or unsupported DemonX schematic data.');
  if (model.components.length > 1000 || model.junctions.length > 10000 || model.wires.length > 20000 || model.labels.length > 10000) throw new Error('Schematic exceeds the local editor safety limits.');
  const validationIssues = validateSchematic(model);
  if (validationIssues.length) throw new Error(`Schematic validation failed; no revision was saved. ${validationIssues.join(' ')}`);
  const serialized = `${JSON.stringify(model, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > 2 * 1024 * 1024) throw new Error('Schematic exceeds the 2 MB local editor safety limit.');
  const directory = safeInside(project.root, 'schematic-circuit/revisions');
  await fs.mkdir(directory, { recursive: true });
  const entries = await fs.readdir(directory);
  const digest = crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 12);
  let revisionNumber = entries.reduce((highest, name) => { const match = /^(\d{6})-.+\.json$/i.exec(name); return match ? Math.max(highest, Number(match[1])) : highest; }, 0) + 1, revision, destination;
  for (;;) {
    revision = `${String(revisionNumber).padStart(6, '0')}-${digest}`;
    destination = path.join(directory, `${revision}.json`);
    try { await fs.writeFile(destination, serialized, { flag: 'wx' }); break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; revisionNumber++; }
  }
  return { revision, path: destination, message: 'Saved as a new immutable project revision. Existing schematic revisions were preserved.' };
});
register('native-tools:get', getNativeTools);
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
  const tools = await getNativeTools();
  const executable = kind === 'pcb' ? tools.pcbnew : tools.eeschema;
  if (!executable) return result('NOT TESTED', `Open ${kind}`, 'KiCad desktop editor was not found. Install KiCad 10.0.7 separately; Circuit does not install it.');
  const args = [file];
  return new Promise(resolve => {
    const launched = spawn(executable, args, { cwd: project.root, detached: true, stdio: 'ignore', windowsHide: false, shell: false });
    launched.once('error', error => resolve(result('FAIL', `Open ${kind}`, `KiCad could not be started: ${error.message}`)));
    launched.once('spawn', () => { launched.unref(); resolve(result('PASS', `Open ${kind}`, `Started KiCad ${tools.kicadVersion || ''} with ${path.basename(file)}.`)); });
  });
});
register('circuit:check', async () => {
  const project = ensureProject();
  const cli = (await getNativeTools()).kicadCli;
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
  const cli = (await getNativeTools()).kicadCli;
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
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const args = [generator, '--stdout', '--project', manifestPath];
  let verifiedNetlist = null;
  if (typeof manifest.native?.verifiedNetlist === 'string') {
    const candidate = safeInside(project.root, manifest.native.verifiedNetlist);
    try { await fs.access(candidate); verifiedNetlist = candidate; } catch {}
  }
  if (verifiedNetlist) args.push('--verified-netlist', verifiedNetlist);
  const r = await run(process.execPath, args, repoRoot, 120000, { ELECTRON_RUN_AS_NODE: '1' });
  if (r.code !== 0) return result('FAIL', 'Generate ESPHome YAML', r.output);
  const cli = (await getNativeTools()).esphome;
  const yaml = r.stdout;
  const sourceLabel = verifiedNetlist ? 'verified KiCad netlist and project pin map' : 'project manifest only; native connectivity was not verified';
  if (!cli) return { ...result('NOT TESTED', 'Generate ESPHome YAML', `Preview generated from ${sourceLabel}. ESPHome CLI is not installed; compatibility validation is NOT TESTED.`), output: r.stderr.trim(), yaml };
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'demonx-circuit-esphome-'));
  try {
    await fs.writeFile(path.join(tempDir, 'dx-preview.yaml'), yaml, { flag: 'wx' });
    const randomKey = crypto.randomBytes(32).toString('base64');
    await fs.writeFile(path.join(tempDir, 'secrets.yaml'), `wifi_ssid: "validation-placeholder"\nwifi_password: "validation-placeholder"\napi_encryption_key: "${randomKey}"\nota_password: "validation-placeholder"\nfallback_ap_password: "${randomKey.slice(0, 24)}"\n`, { flag: 'wx' });
    const validation = await run(cli, ['config', 'dx-preview.yaml'], tempDir, 120000, { HOME: tempDir, USERPROFILE: tempDir });
    const version = await run(cli, ['version'], tempDir, 15000);
    if (validation.code !== 0) return { ...result('FAIL', 'Generate ESPHome YAML', `ESPHome ${version.output || 'CLI'} rejected the preview generated from ${sourceLabel}. Validation diagnostics may contain configuration data and were not retained.`), yaml };
    return { ...result('PASS', 'Generate ESPHome YAML', `ESPHome ${version.output || 'CLI'} accepted YAML generated from ${sourceLabel}.`), output: r.stderr.trim(), yaml };
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
  const iconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'DemonX_Glowing_Board.ico' : 'DemonX_Glowing_Board_512.png');
  win = new BrowserWindow({ width: 1120, height: 720, minWidth: 860, minHeight: 600, backgroundColor: '#0f1519', title: 'DemonX Circuit', icon: iconPath, webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
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
