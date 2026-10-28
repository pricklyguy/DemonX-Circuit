#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const cliArgs = require(join(root, 'prototype', 'owner-schematic-cli-args.cjs'));

const windowsCli = 'C:\\Program Files\\KiCad\\10.0\\bin\\kicad-cli.exe';
const parsed = cliArgs.parseArgs(['C:\\owner files\\board.kicad_sch', '--kicad-cli', `"${windowsCli}"`]);
assert.equal(parsed.input, resolve('C:\\owner files\\board.kicad_sch'));
assert.equal(parsed.cliPath, windowsCli, 'quoted Windows path must remain one CLI argument without its quote wrappers');

const invalid = cliArgs.selectCli('C:\\Program Files\\KiCad\\missing\\kicad-cli.exe', 'win32', {});
assert.equal(invalid.status, 'INVALID_CLI_PATH');
assert.match(invalid.reason, /does not exist or cannot be read/);

const missing = cliArgs.selectCli(null, 'win32', {});
assert.equal(missing.status, 'MISSING_EXECUTABLE');
console.log('PASS: quoted Windows KiCad CLI path with spaces remains a single explicit argument.');
console.log('PASS: invalid explicit path and missing auto-detected executable are reported separately.');
