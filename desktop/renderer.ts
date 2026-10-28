import { mount as mountSchematicEditor } from './schematic-editor';

type IdTypeMap = { 'result-dialog': HTMLDialogElement; 'yaml-dialog': HTMLDialogElement; 'replace-dialog': HTMLDialogElement; 'settings-dialog': HTMLDialogElement; 'native-commit-dialog': HTMLDialogElement; 'yaml-content': HTMLTextAreaElement };
const $ = <K extends string>(id: K): K extends keyof IdTypeMap ? IdTypeMap[K] : HTMLElement => document.getElementById(id) as K extends keyof IdTypeMap ? IdTypeMap[K] : HTMLElement;
let activeProject: ProjectSummary | null = null;
let currentYaml = '';
let replacementDestination: string | undefined;
let replacementBackup: string | undefined;
let stagedNative: (OperationResult & { stageId?: string; sourceSha256?: string; candidateSha256?: string }) | null = null;
let committedStageId: string | null = null;

function renderNativeTools(env: Awaited<ReturnType<typeof window.circuit.getNativeTools>>) {
  const kicadAvailable = !!env.kicadCli && env.kicadVersion === '10.0.7';
  const esphomeAvailable = !!env.esphome && !!env.esphomeVersion;
  $('engine-status').textContent = kicadAvailable && esphomeAvailable ? 'Native tools ready' : !kicadAvailable && !esphomeAvailable ? 'Set up native tools' : 'Some native tools missing';
  $('engine-status').classList.toggle('tools-missing', !kicadAvailable || !esphomeAvailable);
  $('kicad-availability').textContent = env.kicadVersion ? `KiCad ${env.kicadVersion}` : 'NOT FOUND';
  $('kicad-availability').className = `tag ${kicadAvailable ? 'available' : 'unavailable'}`;
  $('esphome-availability').textContent = env.esphomeVersion ? `ESPHome ${env.esphomeVersion}` : 'NOT FOUND';
  $('esphome-availability').className = `tag ${esphomeAvailable ? 'available' : 'unavailable'}`;
  const editor = env.kicadEditor ? `${env.kicadEditorVersion || 'KiCad'} editor available (${env.kicadEditor})` : 'KiCad editor not found';
  const kicad = env.kicadCli ? `KiCad CLI ${env.kicadVersion || 'version unknown'} (${env.kicadCli})` : `KiCad CLI not found${env.kicadCliError ? `: ${env.kicadCliError}` : ''}`;
  const esphome = env.esphome ? `ESPHome ${env.esphomeVersion || 'version unknown'} (${env.esphome})` : `ESPHome not found${env.esphomeError ? `: ${env.esphomeError}` : ''}`;
  $('engine-status').title = `${editor}\n${kicad}${env.compatibilityMessage ? `\n${env.compatibilityMessage}` : ''}\n${esphome}`;
  $('settings-tools').textContent = `${editor}. ${kicad}. ${esphome}.${env.compatibilityMessage ? ` ${env.compatibilityMessage}` : ''}`;
}

function showResult(item: OperationResult) {
  $('result-kicker').textContent = item.status;
  $('result-kicker').className = `eyebrow ${item.status === 'PASS' ? 'good' : item.status === 'FAIL' ? 'bad' : ''}`;
  $('result-title').textContent = item.title;
  $('result-message').textContent = item.message;
  $('result-output').textContent = [item.output, item.reportPaths?.length ? `Files and reports:\n${item.reportPaths.join('\n')}` : ''].filter(Boolean).join('\n\n');
  $('result-dialog').showModal();
}
function updateProject(project: ProjectSummary | null) {
  if (activeProject?.projectId !== project?.projectId) { stagedNative = null; committedStageId = null; }
  activeProject = project;
  const opened = !!project;
  $('empty-project').classList.toggle('hidden', opened);
  $('project-details').classList.toggle('hidden', !opened);
  $('project-name').textContent = project?.name || 'No project open';
  $('project-id').textContent = project?.projectId || '—';
  $('project-revision').textContent = project?.revision || '—';
  $('native-status').textContent = project ? `${project.nativeStatus} · ${project.nativeSyncStatus}${project.nativeSchematicSha256 ? ` · SHA-256 ${project.nativeSchematicSha256.slice(0, 12)}` : ''}` : '—';
  $('project-state').textContent = opened ? 'OPEN' : 'READY';
  $('project-state').className = `tag ${opened ? 'good-tag' : 'neutral'}`;
  $('welcome-title').textContent = opened ? `Your workspace is ready, ${project.name}.` : 'Bring your circuit idea to life.';
  $('welcome-subtitle').textContent = opened ? 'Open your native design, check the circuit, or prepare firmware.' : 'Create a local project or open one you already own. Your native files stay on this computer.';
  const componentList = $('component-list');
  componentList.replaceChildren();
  const components = project?.components || [];
  $('component-count').textContent = String(components.length);
  $('library-summary').textContent = project?.libraries.length ? `${project.libraries.length} project library folder(s) detected.` : 'Personal libraries travel with your project.';
  if (!opened) { componentList.innerHTML = '<div class="list-empty">Open a project to view its components.</div>'; }
  else if (!components.length) { componentList.innerHTML = '<div class="list-empty">No components recorded yet.</div>'; }
  else for (const component of components) {
    const row = document.createElement('div'); row.className = 'component-row';
    const ref = document.createElement('span'); ref.className = 'ref'; ref.textContent = component.ref;
    const name = document.createElement('span'); name.className = 'component-name'; name.textContent = component.value;
    const kind = document.createElement('span'); kind.className = 'component-kind'; kind.textContent = component.kind || 'component';
    row.append(ref, name, kind); componentList.append(row);
  }
  $('open-schematic').toggleAttribute('disabled', !project?.files.schematic);
  $('open-pcb').toggleAttribute('disabled', !project?.files.pcb);
  $('check-circuit').toggleAttribute('disabled', !opened || (!project.files.schematic && !project.files.pcb));
  $('prepare-manufacturing').toggleAttribute('disabled', !project?.files.pcb);
  $('generate-esphome').toggleAttribute('disabled', !project?.capabilities.esphome);
  $('open-circuit-schematic').toggleAttribute('disabled', !project?.files.schematic);
  void refreshRecentProjects();
}
async function act(action: () => Promise<OperationResult>) { try { showResult(await action()); } catch (error) { showResult({ status: 'FAIL', title: 'Operation failed', message: error instanceof Error ? error.message : String(error) }); } }
async function openProject() { try { const project = await window.circuit.openProject(); if (project) updateProject(project); } catch (e) { showResult({ status: 'FAIL', title: 'Open Project', message: String(e) }); } }
async function newProject() { try { const project = await window.circuit.newProject(); if (project) updateProject(project); } catch (e) { const message = e instanceof Error ? e.message : String(e); showResult({ status: /KiCad CLI|KiCad 10\.0\.7/i.test(message) ? 'NOT TESTED' : 'FAIL', title: 'New Project', message }); } }
async function generateYaml() {
  try {
    const preview = await window.circuit.previewEsphome();
    if (!preview.yaml) return showResult(preview);
    currentYaml = preview.yaml; replacementDestination = undefined; replacementBackup = undefined;
    $('yaml-content').value = currentYaml;
    $('yaml-status').textContent = preview.message;
    $('yaml-status').dataset.status = preview.status;
    $('yaml-dialog').showModal();
  } catch (e) { showResult({ status: 'FAIL', title: 'Generate ESPHome YAML', message: String(e) }); }
}
async function saveYaml(approved = false) {
  try {
    const r = await window.circuit.saveEsphome($('yaml-content').value, approved, approved ? replacementDestination : undefined);
    if (r.existingText !== undefined) {
      $('yaml-dialog').close(); replacementDestination = r.destination; replacementBackup = r.backupPath;
      $('existing-yaml').textContent = r.existingText;
      $('proposed-yaml').textContent = $('yaml-content').value;
      $('yaml-diff').textContent = makeDiff(r.existingText, $('yaml-content').value);
      $('replace-message').textContent = `Review existing vs proposed. Non-overwriting backup created: ${r.backupPath}. The original file remains unchanged until you approve.`;
      $('replace-dialog').showModal(); return;
    }
    $('yaml-dialog').close(); $('replace-dialog').close(); showResult(r);
  } catch (e) { showResult({ status: 'FAIL', title: 'Save ESPHome YAML', message: e instanceof Error ? e.message : String(e) }); }
}
function makeDiff(before: string, after: string): string {
  const a = before.split(/\r?\n/), b = after.split(/\r?\n/);
  if (a.length * b.length > 2_000_000) return 'Diff omitted because the input is too large. Both complete files are shown above.';
  const rows = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) rows[i][j] = a[i] === b[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { out.push(`  ${a[i]}`); i++; j++; }
    else if (i < a.length && (j >= b.length || rows[i + 1][j] >= rows[i][j + 1])) out.push(`- ${a[i++]}`);
    else out.push(`+ ${b[j++]}`);
  }
  return out.join('\n');
}

async function refreshRecentProjects() {
  try {
    const recent = await window.circuit.getRecentProjects();
    const list = $('recent-projects'); list.replaceChildren();
    if (!recent.length) { const empty = document.createElement('div'); empty.className = 'list-empty'; empty.textContent = 'Recently opened projects will appear here.'; list.append(empty); return; }
    for (const item of recent) {
      const button = document.createElement('button'); button.className = 'recent-item'; button.type = 'button';
      const name = document.createElement('strong'); name.textContent = item.name;
      const location = document.createElement('small'); location.textContent = item.root;
      button.append(name, location); button.addEventListener('click', async () => { try { updateProject(await window.circuit.openRecentProject(item.projectId)); } catch (error) { showResult({ status: 'FAIL', title: 'Open recent project', message: error instanceof Error ? error.message : String(error) }); } });
      list.append(button);
    }
  } catch (error) { showResult({ status: 'FAIL', title: 'Recent projects', message: error instanceof Error ? error.message : String(error) }); }
}
async function toggleTheme() {
  try { const theme = document.body.dataset.theme === 'light' ? 'dark' : 'light'; await window.circuit.setTheme(theme); document.body.dataset.theme = theme; }
  catch (error) { showResult({ status: 'FAIL', title: 'Theme preference', message: error instanceof Error ? error.message : String(error) }); }
}
$('open-project').addEventListener('click', openProject);
$('new-project').addEventListener('click', newProject);
$('open-schematic').addEventListener('click', () => act(() => window.circuit.openNative('schematic')));
$('open-pcb').addEventListener('click', () => act(() => window.circuit.openNative('pcb')));
$('check-circuit').addEventListener('click', () => act(() => window.circuit.checkCircuit()));
$('prepare-manufacturing').addEventListener('click', () => act(() => window.circuit.prepareManufacturing()));
$('generate-esphome').addEventListener('click', generateYaml);
$('open-circuit-schematic').addEventListener('click', async () => {
  try {
    if (!activeProject) throw new Error('Open or create a project first.');
    const model = await window.circuit.loadSchematicModel();
    if (!model) return showResult({ status: 'NOT TESTED', title: 'Open Circuit Schematic', message: 'This project has no supported native schematic to import. The KiCad file remains available with Open Schematic in KiCad; no conversion was attempted.' });
    $('welcome').classList.add('hidden'); $('workspace-grid').classList.add('hidden'); $('schematic-workspace').classList.remove('hidden');
    $('schematic-open-stage').toggleAttribute('disabled', !stagedNative?.stageId);
    $('schematic-commit-native').toggleAttribute('disabled', !stagedNative?.stageId);
    $('schematic-rollback-native').toggleAttribute('disabled', !committedStageId);
    mountSchematicEditor(model as import('./schematic-model').SchematicDocument, async next => {
      const saved = await window.circuit.saveSchematicModel(next);
      return saved.revision;
    }, async next => window.circuit.stageNativeSchematic(next));
  } catch (error) { showResult({ status: 'FAIL', title: 'Open Circuit Schematic', message: error instanceof Error ? error.message : String(error) }); }
});
window.addEventListener('circuit:native-stage-ready', event => {
  const staged = (event as CustomEvent<OperationResult & { stageId?: string; sourceSha256?: string; candidateSha256?: string }>).detail;
  stagedNative = staged;
  $('schematic-open-stage').toggleAttribute('disabled', !staged.stageId);
  $('schematic-commit-native').toggleAttribute('disabled', !staged.stageId);
  showResult(staged);
});
window.addEventListener('circuit:native-stage-failed', event => showResult((event as CustomEvent<OperationResult>).detail));
$('schematic-open-stage').addEventListener('click', () => act(() => {
  if (!stagedNative?.stageId) throw new Error('Validate a native candidate before opening it.');
  return window.circuit.openStagedSchematic(stagedNative.stageId);
}));
$('schematic-commit-native').addEventListener('click', () => {
  if (!stagedNative?.stageId || !stagedNative.sourceSha256 || !stagedNative.candidateSha256) return;
  $('native-commit-message').textContent = 'The candidate passed native netlist comparison and ERC. Review both hashes. Approving creates a non-overwriting source backup, then replaces the native schematic.';
  $('native-commit-details').textContent = `Stage: ${stagedNative.stageId}\nOriginal SHA-256: ${stagedNative.sourceSha256}\nCandidate SHA-256: ${stagedNative.candidateSha256}\nValidation: PASS`;
  $('native-commit-approve').textContent = 'Approve & Commit';
  $('native-commit-dialog').showModal();
});
$('native-commit-cancel').addEventListener('click', () => $('native-commit-dialog').close());
$('native-commit-approve').addEventListener('click', async () => {
  $('native-commit-dialog').close();
  const id = stagedNative?.stageId || committedStageId;
  if (!id) return;
  const result = committedStageId === id
    ? await window.circuit.rollbackNativeSchematic(id, true)
    : await window.circuit.commitNativeSchematic(id, true);
  showResult(result);
  if (result.status === 'PASS' && committedStageId !== id) {
    committedStageId = id; $('schematic-rollback-native').toggleAttribute('disabled', false);
    $('schematic-back').click(); const fresh = await window.circuit.inspectProject(); if (fresh) updateProject(fresh);
  } else if (result.status === 'PASS' && committedStageId === id) {
    committedStageId = null; stagedNative = null; $('schematic-rollback-native').toggleAttribute('disabled', true);
    $('schematic-back').click(); const fresh = await window.circuit.inspectProject(); if (fresh) updateProject(fresh);
  }
});
$('schematic-rollback-native').addEventListener('click', () => {
  if (!committedStageId) return;
  $('native-commit-message').textContent = 'This restores the imported source backup only if the committed schematic has not changed since approval. The current committed file will also be retained as a backup.';
  $('native-commit-details').textContent = `Stage: ${committedStageId}\nRollback: the staged commit’s verified original backup`;
  $('native-commit-approve').textContent = 'Approve Rollback';
  $('native-commit-dialog').showModal();
});
$('yaml-save').addEventListener('click', () => saveYaml(false));
$('replace-cancel').addEventListener('click', () => { $('replace-dialog').close(); showResult({ status: 'CANCELLED', title: 'Replacement cancelled', message: `Original file was not changed. Backup retained at ${replacementBackup || 'the displayed backup path'}.` }); });
$('replace-confirm').addEventListener('click', () => saveYaml(true));
$('theme-toggle').addEventListener('click', toggleTheme);
$('settings-theme-toggle').addEventListener('click', toggleTheme);
$('settings-open').addEventListener('click', () => $('settings-dialog').showModal());
$('select-kicad').addEventListener('click', async () => {
  try { renderNativeTools(await window.circuit.selectKiCadInstall()); }
  catch (error) { showResult({ status: 'FAIL', title: 'KiCad setup', message: error instanceof Error ? error.message : String(error) }); }
});
$('select-esphome').addEventListener('click', async () => {
  try { renderNativeTools(await window.circuit.selectEsphomeExecutable()); }
  catch (error) { showResult({ status: 'FAIL', title: 'ESPHome setup', message: error instanceof Error ? error.message : String(error) }); }
});
window.circuit.onProjectChanged(updateProject);
updateProject(null);
async function initialize() {
  const [theme, env] = await Promise.all([window.circuit.getTheme(), window.circuit.getEnvironment()]);
  document.body.dataset.theme = theme;
  renderNativeTools(env);
  if (env.development) {
    const treeState = env.development.tree === 'clean' ? '' : ' + WORKTREE CHANGES';
    $('dev-build-id').textContent = ` · DEV ${env.development.branch}@${env.development.commit.slice(0, 8)}${treeState} · log: ${env.development.logPath || 'console'}`;
  }
  await refreshRecentProjects();
}
let devUpdatePending = false;
window.circuit.onDevRendererUpdate(() => {
  devUpdatePending = true;
  const banner = $('dev-reload-banner');
  if (document.body.dataset.schematicDirty === 'true' || !$('schematic-workspace').classList.contains('hidden')) banner.classList.remove('hidden');
  else window.setTimeout(() => { if (devUpdatePending && document.body.dataset.schematicDirty !== 'true') window.location.reload(); }, 350);
});
$('dev-reload-now').addEventListener('click', () => {
  if (document.body.dataset.schematicDirty === 'true') {
    showResult({ status: 'NOT TESTED', title: 'Save before reloading', message: 'The schematic has unsaved edits. Save a DemonX revision first; the development reload will remain deferred.' });
    return;
  }
  window.location.reload();
});
window.addEventListener('circuit:schematic-dirty', event => {
  const dirty = (event as CustomEvent<boolean>).detail;
  document.body.dataset.schematicDirty = String(dirty);
  if (dirty && devUpdatePending) $('dev-reload-banner').classList.remove('hidden');
});
void initialize().catch(error => { $('engine-status').textContent = 'Tool status unavailable'; showResult({ status: 'FAIL', title: 'Startup', message: error instanceof Error ? error.message : String(error) }); });
