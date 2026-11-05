'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');

test('Circuit acquires its single-instance lock before registering application startup', () => {
  assert.match(source, /const circuitSingleInstanceLock = app\.requestSingleInstanceLock\(\)/);
  assert.match(source, /if \(circuitSingleInstanceLock\) app\.on\('second-instance', focusCircuitWindow\)/);
  assert.match(source, /if \(circuitSingleInstanceLock\) \{\s*app\.whenReady\(\)\.then\(createWindow\)/);
  assert.match(source, /\} else \{\s*app\.quit\(\);\s*\}/);
});

test('second Circuit launch restores a minimized app window and focuses the existing window', () => {
  assert.match(source, /function focusCircuitWindow\(\)[\s\S]*?if \(win\.isMinimized\(\)\) win\.restore\(\)/);
  assert.match(source, /if \(!win\.isVisible\(\)\) win\.show\(\)/);
  assert.match(source, /win\.focus\(\)/);
  assert.match(source, /if \(activationPending\) focusCircuitWindow\(\)/);
});

test('activation does not add project-path handling to the second-instance callback', () => {
  const handler = source.match(/function focusCircuitWindow\(\)\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(handler, 'window activation callback should exist');
  assert.doesNotMatch(handler, /process\.argv|openProject|loadProject|schematic|pcb/i);
});
