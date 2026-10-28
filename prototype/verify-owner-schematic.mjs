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
const cliArgs = require(join(root, 'prototype', 'owner-schematic-cli-args.cjs'));
const EXPECTED_NETS = [['D1.1', 'R1.1'], ['D1.2', 'J1.2'], ['J1.1', 'R1.2']];

function sortGroups(groups) {
  return groups.map(group => [...group].sort()).sort((a, b) => a.join('|').localeCompare(b.join('|')));
}

function printHelp() {
  console.log('Read-only owner schematic verification');
  console.log('Usage: node prototype/verify-owner-schematic.mjs <owner-file.kicad_sch> [--kicad-cli <path>] [--report <report.json>]');
  console.log('Imports the supplied file, checks R1=510 and expected net groups, computes renderer routes, and runs native netlist/ERC when KiCad 10.0.7 is found. Reports are written outside the source unless --report is specified.');
}

async function main() {
  const args = cliArgs.parseArgs(process.argv.slice(2));
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

  const cliSelection = cliArgs.selectCli(args.cliPath);
  if (cliSelection.status !== 'FOUND') {
    const invalid = cliSelection.status === 'INVALID_CLI_PATH';
    report.checks.nativeKiCad = { result: invalid ? 'FAIL' : 'NOT TESTED', status: cliSelection.status, explicitPath: args.cliPath, reason: cliSelection.reason };
    report.classifications.nativeKiCadErcError = `${invalid ? 'FAIL' : 'NOT TESTED'}: ${cliSelection.status}: ${cliSelection.reason}`;
  } else {
    const cliPath = cliSelection.path;
    const temp = await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), 'demonx-owner-schematic-check-')));
    const netlistPath = join(temp, 'native.net');
    const ercPath = join(temp, 'native-erc.rpt');
    try {
      const resolvedCli = await realpath(cliPath);
      let version;
      try {
        version = await execFile(resolvedCli, ['version'], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
      } catch (error) {
        throw Object.assign(error, { nativeStage: 'VERSION_PROBE_FAILED', nativeCommand: [resolvedCli, 'version'] });
      }
      const versionText = (version.stdout || version.stderr).trim();
      report.checks.nativeKiCad = { cli: resolvedCli, version: versionText };
      if (!/\b10\.0\.7\b/.test(versionText)) {
        report.checks.nativeKiCad.result = 'NOT TESTED';
        report.checks.nativeKiCad.status = 'INCORRECT_VERSION';
        report.checks.nativeKiCad.reason = 'This verifier is qualified for KiCad CLI 10.0.7 only.';
        report.checks.nativeNetlist = { result: 'NOT TESTED', reason: 'KiCad CLI version is not the qualified 10.0.7 version.' };
        report.checks.nativeSemanticAgreement = { result: 'NOT TESTED', reason: 'Native netlist was not generated.' };
        report.checks.nativeErc = { result: 'NOT TESTED', reason: 'KiCad CLI version is not the qualified 10.0.7 version.' };
        report.classifications.nativeKiCadErcError = 'NOT TESTED: KiCad CLI version mismatch';
      } else {
      const netlistArgs = ['sch', 'export', 'netlist', '--format', 'kicadxml', '--output', netlistPath, sourcePath];
      let netlistRun;
      try { netlistRun = await execFile(resolvedCli, netlistArgs, { windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 }); }
      catch (error) { throw Object.assign(error, { nativeStage: 'NETLIST_EXECUTION_FAILED', nativeCommand: [resolvedCli, ...netlistArgs] }); }
      const nativeGroups = sortGroups(adapter.parseKicadNetlist(await readFile(netlistPath, 'utf8')));
      const nativeMatches = JSON.stringify(nativeGroups) === JSON.stringify(sortGroups(EXPECTED_NETS));
      report.checks.nativeNetlist = { result: nativeMatches ? 'PASS' : 'FAIL', exitCode: 0, groups: nativeGroups, expected: sortGroups(EXPECTED_NETS), stdout: netlistRun.stdout.trim(), stderr: netlistRun.stderr.trim() };
      report.checks.nativeSemanticAgreement = { result: JSON.stringify(nativeGroups) === JSON.stringify(semanticNets) ? 'PASS' : 'FAIL', nativeGroups, semanticGroups: semanticNets };
      const ercArgs = ['sch', 'erc', '--severity-all', '--exit-code-violations', '--output', ercPath, sourcePath];
      const ercRun = await execFile(resolvedCli, ercArgs, { windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 }).catch(error => ({ exitCode: error.code ?? 1, stdout: error.stdout || '', stderr: error.stderr || error.message, processError: true }));
      const ercReport = existsSync(ercPath) ? await readFile(ercPath, 'utf8') : '';
      const ercExitCode = ercRun.exitCode ?? 0;
      report.checks.nativeErc = { result: ercExitCode === 0 ? 'PASS' : 'FAIL', status: ercRun.processError ? 'NATIVE_EXECUTION_FAILED' : 'ERC_VIOLATIONS_OR_FAILURE', command: [resolvedCli, ...ercArgs], exitCode: ercExitCode, report: ercReport, stdout: ercRun.stdout.trim(), stderr: ercRun.stderr.trim() };
      report.classifications.nativeKiCadErcError = ercExitCode === 0 ? 'PASS: KiCad ERC exit code 0 on the exact source SHA-256' : ercRun.processError ? `FAIL: native ERC execution failed (exit ${ercExitCode}) on the exact source SHA-256` : `FAIL: KiCad ERC returned exit code ${ercExitCode} on the exact source SHA-256`;
      report.checks.nativeKiCad.result = report.checks.nativeNetlist.result === 'PASS' && report.checks.nativeSemanticAgreement.result === 'PASS' && report.checks.nativeErc.result === 'PASS' ? 'PASS' : 'FAIL';
      }
    } catch (error) {
      report.checks.nativeKiCad = { ...(report.checks.nativeKiCad || {}), result: error.nativeStage === 'VERSION_PROBE_FAILED' ? 'FAIL' : 'FAIL', status: error.nativeStage || 'NATIVE_EXECUTION_FAILED', command: error.nativeCommand || null, exitCode: typeof error.code === 'number' ? error.code : null, stdout: error.stdout || '', stderr: error.stderr || '', error: error.message };
      report.classifications.nativeKiCadErcError = `FAIL: ${error.nativeStage || 'NATIVE_EXECUTION_FAILED'}: ${error.message}`;
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
