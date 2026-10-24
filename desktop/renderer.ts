type IdTypeMap = { 'result-dialog': HTMLDialogElement; 'yaml-dialog': HTMLDialogElement; 'replace-dialog': HTMLDialogElement; 'settings-dialog': HTMLDialogElement; 'yaml-content': HTMLTextAreaElement };
const $ = <K extends string>(id: K): K extends keyof IdTypeMap ? IdTypeMap[K] : HTMLElement => document.getElementById(id) as K extends keyof IdTypeMap ? IdTypeMap[K] : HTMLElement;
let activeProject: ProjectSummary | null = null;
let currentYaml = '';
let replacementDestination: string | undefined;
let replacementBackup: string | undefined;

function showResult(item: OperationResult) {
  $('result-kicker').textContent = item.status;
  $('result-kicker').className = `eyebrow ${item.status === 'PASS' ? 'good' : item.status === 'FAIL' ? 'bad' : ''}`;
  $('result-title').textContent = item.title;
  $('result-message').textContent = item.message;
  $('result-output').textContent = [item.output, item.reportPaths?.length ? `Files and reports:\n${item.reportPaths.join('\n')}` : ''].filter(Boolean).join('\n\n');
  $('result-dialog').showModal();
}
function updateProject(project: ProjectSummary | null) {
  activeProject = project;
  const opened = !!project;
  $('empty-project').classList.toggle('hidden', opened);
  $('project-details').classList.toggle('hidden', !opened);
  $('project-name').textContent = project?.name || 'No project open';
  $('project-id').textContent = project?.projectId || '—';
  $('project-revision').textContent = project?.revision || '—';
  $('native-status').textContent = project?.nativeStatus || '—';
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
  $('generate-esphome').toggleAttribute('disabled', !project);
  void refreshRecentProjects();
}
async function act(action: () => Promise<OperationResult>) { try { showResult(await action()); } catch (error) { showResult({ status: 'FAIL', title: 'Operation failed', message: error instanceof Error ? error.message : String(error) }); } }
async function openProject() { try { const project = await window.circuit.openProject(); if (project) updateProject(project); } catch (e) { showResult({ status: 'FAIL', title: 'Open Project', message: String(e) }); } }
async function newProject() { try { const project = await window.circuit.newProject(); if (project) updateProject(project); } catch (e) { showResult({ status: 'FAIL', title: 'New Project', message: String(e) }); } }
async function generateYaml() {
  try {
    const preview = await window.circuit.previewEsphome();
    if (!preview.yaml) return showResult(preview);
    currentYaml = preview.yaml; replacementDestination = undefined; replacementBackup = undefined;
    $('yaml-content').value = currentYaml;
    $('yaml-status').textContent = preview.message;
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
$('yaml-save').addEventListener('click', () => saveYaml(false));
$('replace-cancel').addEventListener('click', () => { $('replace-dialog').close(); showResult({ status: 'CANCELLED', title: 'Replacement cancelled', message: `Original file was not changed. Backup retained at ${replacementBackup || 'the displayed backup path'}.` }); });
$('replace-confirm').addEventListener('click', () => saveYaml(true));
$('theme-toggle').addEventListener('click', toggleTheme);
$('settings-theme-toggle').addEventListener('click', toggleTheme);
$('settings-open').addEventListener('click', () => $('settings-dialog').showModal());
window.circuit.onProjectChanged(updateProject);
updateProject(null);
async function initialize() {
  const [theme, env] = await Promise.all([window.circuit.getTheme(), window.circuit.getEnvironment()]);
  document.body.dataset.theme = theme;
  const kicad = env.kicad ? `KiCad CLI available` : 'KiCad CLI not found';
  const editor = env.kicadEditor ? 'KiCad editor available' : 'KiCad editor not found';
  const esphome = env.esphome ? `ESPHome available (${env.esphome})` : 'ESPHome not found';
  $('engine-status').textContent = `${kicad} · ${esphome}`;
  $('engine-status').classList.toggle('tools-missing', !env.kicad || !env.esphome);
  $('engine-status').title = `${editor} (${env.kicadEditor || 'not detected'})\n${kicad} (${env.kicad || 'not detected'})\n${esphome}`;
  $('settings-tools').textContent = `${editor}${env.kicadEditor ? ` (${env.kicadEditor})` : ''}. ${kicad}${env.kicad ? ` (${env.kicad})` : ''}. ${esphome}${env.esphome ? ` (${env.esphome})` : ''}. Install tools separately; Circuit does not modify system configuration.`;
  await refreshRecentProjects();
}
void initialize().catch(error => { $('engine-status').textContent = 'Tool status unavailable'; showResult({ status: 'FAIL', title: 'Startup', message: error instanceof Error ? error.message : String(error) }); });
