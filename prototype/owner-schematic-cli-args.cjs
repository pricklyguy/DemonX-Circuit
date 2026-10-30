'use strict';

const path = require('node:path');
const fs = require('node:fs');

function unquote(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed[0] === '"' && trimmed.at(-1) === '"') || (trimmed[0] === "'" && trimmed.at(-1) === "'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseArgs(argv) {
  let input = null;
  let reportPath = null;
  let cliPath = null;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--report') {
      if (!argv[index + 1]) throw new Error('Missing value for --report.');
      reportPath = unquote(argv[++index]);
    } else if (arg === '--kicad-cli') {
      if (!argv[index + 1]) throw new Error('Missing value for --kicad-cli.');
      cliPath = unquote(argv[++index]);
    } else if (arg === '--help' || arg === '-h') return { help: true };
    else if (!input) input = unquote(arg);
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!input) throw new Error('Usage: node prototype/verify-owner-schematic.mjs <owner-file.kicad_sch> [--kicad-cli <path>] [--report <report.json>]');
  return {
    input: path.resolve(input),
    reportPath: reportPath ? path.resolve(reportPath) : null,
    cliPath
  };
}

function selectCli(explicitPath, platform = process.platform, env = process.env) {
  if (explicitPath !== null && explicitPath !== undefined) {
    const clean = unquote(explicitPath);
    if (!clean) return { status: 'INVALID_CLI_PATH', path: null, reason: 'The --kicad-cli path is empty.' };
    const candidate = path.resolve(clean);
    try {
      if (!fs.statSync(candidate).isFile()) return { status: 'INVALID_CLI_PATH', path: candidate, reason: 'The selected path is not a regular file.' };
      return { status: 'FOUND', path: candidate };
    } catch (error) {
      return { status: 'INVALID_CLI_PATH', path: candidate, reason: `The explicitly selected KiCad CLI does not exist or cannot be read (${error.code || error.message}).` };
    }
  }
  const candidates = platform === 'win32'
    ? ['ProgramFiles', 'ProgramFiles(x86)'].filter(key => env[key]).map(key => path.join(env[key], 'KiCad', '10.0', 'bin', 'kicad-cli.exe'))
    : ['/usr/bin/kicad-cli', '/usr/local/bin/kicad-cli'];
  for (const candidate of candidates) {
    try { if (fs.statSync(candidate).isFile()) return { status: 'FOUND', path: candidate }; } catch { /* inspect remaining supported paths */ }
  }
  return { status: 'MISSING_EXECUTABLE', path: null, reason: 'KiCad CLI was not found in supported standard locations.' };
}

module.exports = { parseArgs, selectCli, unquote };
