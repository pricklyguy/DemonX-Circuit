import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';

const bundle = resolve(process.argv[2] || '');
const electronSource = resolve(process.argv[3] || '');
if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node prototype/verify-windows-package.mjs <bundle-dir> <electron-dist-dir>');
const appRoot = join(bundle, 'resources', 'app');
const errors = [];
const executableExts = new Set(['.exe', '.dll', '.node', '.com', '.bat', '.cmd', '.ps1', '.vbs', '.scr', '.sys', '.msi']);

async function filesUnder(root) {
  const files = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isSymbolicLink()) { errors.push(`Symlink is not permitted in portable package: ${relative(root, file)}`); continue; }
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  await visit(root);
  return files.sort((a, b) => relative(root, a).localeCompare(relative(root, b), 'en'));
}
async function sha256(file) { return createHash('sha256').update(await readFile(file)).digest('hex'); }
async function compareTrees(source, packaged, renamedExe = false) {
  const expected = await filesUnder(source);
  const actual = await filesUnder(packaged);
  const expectedMap = new Map(expected.map(file => [relative(source, file).split(sep).join('/'), file]));
  if (renamedExe) {
    const electronExe = expectedMap.get('electron.exe');
    if (electronExe) expectedMap.set('DemonX Circuit.exe', electronExe);
  }
  const actualNames = new Set(actual.map(file => relative(packaged, file).split(sep).join('/')));
  for (const name of expectedMap.keys()) if (!actualNames.has(name) && !(renamedExe && name === 'electron.exe')) errors.push(`Missing packaged runtime file: ${name}`);
  for (const file of actual) {
    const name = relative(packaged, file).split(sep).join('/');
    const original = expectedMap.get(name);
    if (!original) { errors.push(`Unexpected file in Electron runtime: ${name}`); continue; }
    if (await sha256(file) !== await sha256(original)) errors.push(`Runtime file hash differs from pinned Electron source: ${name}`);
  }
}

await compareTrees(electronSource, bundle, true);
const appFiles = await filesUnder(appRoot);
const executableFiles = [];
for (const file of [...await filesUnder(bundle), ...appFiles]) {
  const extension = extname(file).toLowerCase();
  if (!executableExts.has(extension)) continue;
  const normalized = relative(bundle, file).split(sep).join('/');
  executableFiles.push({ path: normalized, bytes: (await stat(file)).size, sha256: await sha256(file) });
  if (normalized.startsWith('resources/app/')) errors.push(`Executable-like file is not allowed in application resources: ${normalized}`);
}
if (executableFiles.filter(file => file.path.endsWith('.exe')).length !== 2) errors.push('Expected only the Electron runtime executable and its user-facing renamed copy.');
if (!(await stat(join(appRoot, 'examples', 'native-smoke', 'DX_LED_Smoke', 'DX_LED_Smoke.kicad_pro')).catch(() => null))) errors.push('KiCad 10.0.7 native starter project template is missing.');
if (!(await stat(join(appRoot, 'desktop', 'assets', 'DemonX Circuit.png')).catch(() => null))) errors.push('Official DemonX Circuit branding asset is missing.');

const result = { status: errors.length ? 'FAIL' : 'PASS', bundle, electronSource, executableFiles, errors };
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
