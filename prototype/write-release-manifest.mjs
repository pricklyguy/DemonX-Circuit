import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';

const [bundleArg, zipArg, manifestArg, checksumsArg, commitArg, versionArg] = process.argv.slice(2);
if (![bundleArg, zipArg, manifestArg, checksumsArg, commitArg, versionArg].every(Boolean)) {
  throw new Error('Usage: node prototype/write-release-manifest.mjs <bundle> <zip> <manifest> <checksums> <commit> <version>');
}
const bundle = resolve(bundleArg), zip = resolve(zipArg), manifestPath = resolve(manifestArg), checksumsPath = resolve(checksumsArg);
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
async function walk(root) {
  const out = [];
  async function visit(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, item.name);
      if (item.isSymbolicLink()) throw new Error(`Symlink found in distribution: ${relative(root, full)}`);
      if (item.isDirectory()) await visit(full);
      else if (item.isFile()) out.push(full);
    }
  }
  await visit(root);
  return out.sort((a, b) => relative(root, a).split(sep).join('/').localeCompare(relative(root, b).split(sep).join('/'), 'en'));
}
const packagedFiles = await Promise.all((await walk(bundle)).map(async file => ({
  path: relative(bundle, file).split(sep).join('/'),
  bytes: (await stat(file)).size,
  sha256: await hash(file)
})));
const exe = join(bundle, 'DemonX Circuit.exe');
const manifest = {
  product: 'DemonX Circuit',
  classification: 'Development preview; not a public production release.',
  version: versionArg,
  commit: commitArg,
  buildDateUtc: new Date().toISOString(),
  package: { filename: basename(zip), bytes: (await stat(zip)).size, sha256: await hash(zip) },
  primaryExecutable: { path: 'DemonX Circuit.exe', bytes: (await stat(exe)).size, sha256: await hash(exe) },
  signing: { status: 'UNSIGNED', reason: 'No signing service or credentials were approved for this preview.' },
  files: packagedFiles
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'w' });
await writeFile(checksumsPath,
  `${manifest.package.sha256}  ${basename(zip)}\n${manifest.primaryExecutable.sha256}  DemonX Circuit.exe\n`, { flag: 'w' });
await writeFile(`${zip}.sha256`, `${manifest.package.sha256}  ${basename(zip)}\n`, { flag: 'w' });
await writeFile(join(resolve(zip, '..'), `${basename(zip, extname(zip))}.exe.sha256`), `${manifest.primaryExecutable.sha256}  DemonX Circuit.exe\n`, { flag: 'w' });
console.log(JSON.stringify({ manifestPath, checksum: manifest.package.sha256, executableSha256: manifest.primaryExecutable.sha256, packagedFiles: packagedFiles.length, signing: manifest.signing.status }, null, 2));
