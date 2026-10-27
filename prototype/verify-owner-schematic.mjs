#!/usr/bin/env node
// Read-only verification of an owner-provided KiCad schematic. Native CLI
// outputs are written to an isolated temporary directory; the source is never
// rewritten or copied into the repository.
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const model = require(join(root, 'desktop', 'dist', 'schematic-model.js'));
const adapter = require(join(root, 'desktop', 'kicad-schematic-adapter.cjs'));
const EXPECTED_NETS = [['D1.1', 'R1.1'], ['D1.2', 'J1.2'], ['J1.1', 'R1.2']];

function sortGroups(groups) {
  return groups.map(group => [...group].sort()).sort((a, b) => a.join('|').localeCompare(b.join('|')));
}

function findKiCadCli(explicitPath) {
  const candidates = explicitPath ? [resolve(explicitPath)] : process.platform === 'win32'
    ? ['ProgramFiles', 'ProgramFiles(x86)'].filter(key => process.env[key]).map(key => join(process.env[key], 'KiCad', '10.0', 'bin', 'kicad-cli.exe'))
    : ['/usr/bin/kicad-cli', '/usr/local/bin/kicad-cli'];
  return candidates.find(candidate => existsSync(candidate)) || null;
}

function parseArgs(args) {
  let input = null;
  let reportPath = null;
  let cliPath = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--report') reportPath = args[++i];
    else if (arg === '--kicad-cli') cliPath = args[++i];
    else if (arg === '--help' || arg === '-h') return { help: true };
    else if (!input) input = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!input || (reportPath === undefined) || (cliPath === undefined)) throw new Error('Usage: node prototype/verify-owner-schematic.mjs <owner-file.kicad_sch> [--kicad-cli <path>] [--report <report.json>]');
  return { input: resolve(input), reportPath: reportPath ? resolve(reportPath) : null, cliPath };
}

function printHelp() {
  console.log('Read-only owner schematic verification');
  console.log('Usage: node prototype/verify-owner-schematic.mjs <owner-file.kicad_sch> [--kicad-cli <path>] [--report <report.json>]');
  console.log('Imports the supplied file, checks R1=510 and expected net groups, computes renderer routes, and runs native netlist/ERC when KiCad 10.0.7 is found. Reports are written outside the source unless --report is specified.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return 0; }
  const sourcePath = await realpath(args.input);
  const originalBytes = await readFile(sourcePath);
  const sourceHash = createHash('sha256').update(originalBytes).digest('hex');
  const sourceText = originalBytes.toString('utf8');
  const report = {
    utility: 'DemonX Circuit owner schematic verifier',
    source: { path: sourcePath, file: basename(sourcePath), sha256: sourceHash, modifiedByUtility: false },
    expectedNets: EXPECTED_NETS,
    classifications: {
      electricalConnectivityError: 'NOT TESTED',
      visualRoutingFailure: 'NOT TESTED',
      unsupportedNativeFormat: 'NOT TESTED',
      nativeKiCadErcError: 'NOT TESTED',
      staleNativeVerificationOrUnsynchronizedRevision: 'NOT TESTED'
    },
    checks: {}
  };
  let imported;
  try {
    imported = adapter.importKiCadSchematic(sourceText);
    report.checks.nativeImport = { result: 'PASS', format: imported.nativeSync?.sourceFormat || 'KiCad schematic' };
    report.classifications.unsupportedNativeFormat = 'PASS: supported by constrained DemonX KiCad importer';
  } catch (error) {
    report.checks.nativeImport = { result: 'FAIL', error: error.message };
    report.classifications.unsupportedNativeFormat = `FAIL: ${error.message}`;
    report.classifications.electricalConnectivityError = 'NOT TESTED: import failed';
    report.classifications.visualRoutingFailure = 'NOT TESTED: import failed';
    report.classifications.nativeKiCadErcError = 'NOT TESTED: import failed';
    report.classifications.staleNativeVerificationOrUnsynchronizedRevision = 'NOT TESTED: import failed';
    return await finish(report, args.reportPath, sourcePath, sourceHash, 2);
  }

  const resistor = imported.components.find(component => component.reference === 'R1');
  report.checks.referenceValue = { result: resistor?.value === '510' ? 'PASS' : 'FAIL', reference: 'R1', actual: resistor?.value ?? null, expected: '510' };
  const semanticNets = sortGroups(adapter.netGroups(imported));
  const semanticMatches = JSON.stringify(semanticNets) === JSON.stringify(sortGroups(EXPECTED_NETS));
  const semanticShorts = model.findSupplyShorts(imported);
  report.checks.semanticConnectivity = { result: semanticMatches && semanticShorts.length === 0 ? 'PASS' : 'FAIL', groups: semanticNets, expected: sortGroups(EXPECTED_NETS), supplyShorts: semanticShorts };
  report.classifications.electricalConnectivityError = report.checks.semanticConnectivity.result === 'PASS' ? 'PASS: expected pin-to-net groups are separate; no labeled supply short detected' : 'FAIL: semantic pin groups differ or a labeled supply short was detected';

  const routing = model.routeSchematicWires(imported);
  report.checks.displayRouting = { result: routing.errors.length === 0 ? 'PASS' : 'FAIL', routeCount: routing.routes.length, errors: routing.errors, routes: routing.routes };
  report.classifications.visualRoutingFailure = routing.errors.length === 0 ? 'PASS: routed display geometry has no cross-net contacts detected by the router' : 'FAIL: display routing reports geometry collisions or cannot find a route';
  report.designRevision = { sourceSha256: sourceHash, nativeSync: imported.nativeSync || null, validationBoundToSourceHash: sourceHash };

  const cliPath = findKiCadCli(args.cliPath);
  if (!cliPath) {
    report.checks.nativeKiCad = { result: 'NOT TESTED', reason: 'KiCad CLI 10.0.7 was not found in the standard install location; pass --kicad-cli to select it explicitly.' };
    report.classifications.nativeKiCadErcError = 'NOT TESTED: KiCad CLI unavailable';
  } else {
    const temp = await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), 'demonx-owner-schematic-check-')));
    const netlistPath = join(temp, 'native.net');
    const ercPath = join(temp, 'native-erc.rpt');
    try {
      const resolvedCli = await realpath(cliPath);
      const version = await execFile(resolvedCli, ['version'], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
      const versionText = (version.stdout || version.stderr).trim();
      report.checks.nativeKiCad = { cli: resolvedCli, version: versionText };
      if (!/\b10\.0\.7\b/.test(versionText)) {
        report.checks.nativeKiCad.result = 'NOT TESTED';
        report.checks.nativeKiCad.reason = 'This verifier is qualified for KiCad CLI 10.0.7 only.';
        report.checks.nativeNetlist = { result: 'NOT TESTED', reason: 'KiCad CLI version is not the qualified 10.0.7 version.' };
        report.checks.nativeSemanticAgreement = { result: 'NOT TESTED', reason: 'Native netlist was not generated.' };
        report.checks.nativeErc = { result: 'NOT TESTED', reason: 'KiCad CLI version is not the qualified 10.0.7 version.' };
        report.classifications.nativeKiCadErcError = 'NOT TESTED: KiCad CLI version mismatch';
      } else {
      const netlistRun = await execFile(resolvedCli, ['sch', 'export', 'netlist', '--format', 'kicadxml', '--output', netlistPath, sourcePath], { windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
      const nativeGroups = sortGroups(adapter.parseKicadNetlist(await readFile(netlistPath, 'utf8')));
      const nativeMatches = JSON.stringify(nativeGroups) === JSON.stringify(sortGroups(EXPECTED_NETS));
      report.checks.nativeNetlist = { result: nativeMatches ? 'PASS' : 'FAIL', exitCode: 0, groups: nativeGroups, expected: sortGroups(EXPECTED_NETS), stdout: netlistRun.stdout.trim(), stderr: netlistRun.stderr.trim() };
      report.checks.nativeSemanticAgreement = { result: JSON.stringify(nativeGroups) === JSON.stringify(semanticNets) ? 'PASS' : 'FAIL', nativeGroups, semanticGroups: semanticNets };
      const ercRun = await execFile(resolvedCli, ['sch', 'erc', '--severity-all', '--exit-code-violations', '--output', ercPath, sourcePath], { windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 }).catch(error => ({ exitCode: error.code ?? 1, stdout: error.stdout || '', stderr: error.stderr || error.message }));
      const ercReport = existsSync(ercPath) ? await readFile(ercPath, 'utf8') : '';
      const ercExitCode = ercRun.exitCode ?? 0;
      report.checks.nativeErc = { result: ercExitCode === 0 ? 'PASS' : 'FAIL', exitCode: ercExitCode, report: ercReport, stdout: ercRun.stdout.trim(), stderr: ercRun.stderr.trim() };
      report.classifications.nativeKiCadErcError = ercExitCode === 0 ? 'PASS: KiCad ERC exit code 0 on the exact source SHA-256' : 'FAIL: KiCad ERC returned a nonzero exit code on the exact source SHA-256';
      report.checks.nativeKiCad.result = report.checks.nativeNetlist.result === 'PASS' && report.checks.nativeSemanticAgreement.result === 'PASS' && report.checks.nativeErc.result === 'PASS' ? 'PASS' : 'FAIL';
      }
    } catch (error) {
      report.checks.nativeKiCad = { ...(report.checks.nativeKiCad || {}), result: 'FAIL', error: error.message };
      report.classifications.nativeKiCadErcError = `FAIL/INCONCLUSIVE: native check execution failed: ${error.message}`;
    } finally {
      const fs = await import('node:fs/promises');
      await fs.rm(temp, { recursive: true, force: true });
    }
  }
  report.classifications.staleNativeVerificationOrUnsynchronizedRevision = `PASS: this report is freshly bound to source SHA-256 ${sourceHash}; existing editor sidecar synchronization is NOT ASSESSED`;
  const code = report.checks.referenceValue.result === 'PASS' && report.checks.semanticConnectivity.result === 'PASS' && report.checks.displayRouting.result === 'PASS' && report.checks.nativeKiCad?.result === 'PASS' ? 0 : 1;
  return await finish(report, args.reportPath, sourcePath, sourceHash, code);
}

async function finish(report, reportPath, sourcePath, initialHash, code) {
  const finalHash = createHash('sha256').update(await readFile(sourcePath)).digest('hex');
  report.source.modifiedByUtility = finalHash !== initialHash;
  report.source.sha256After = finalHash;
  if (report.source.modifiedByUtility) {
    report.source.protection = 'FAIL: source hash changed while verifier ran';
    code = 2;
  } else report.source.protection = 'PASS: source bytes remained unchanged';
  if (reportPath) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    report.reportPath = reportPath;
  }
  console.log(JSON.stringify(report, null, 2));
  return code;
}

main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(`Verification could not start: ${error.message}`);
  console.error('Usage: node prototype/verify-owner-schematic.mjs <owner-file.kicad_sch> [--kicad-cli <path>] [--report <report.json>]');
  process.exitCode = 2;
});
