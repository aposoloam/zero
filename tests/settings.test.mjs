import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, diff, DEFAULTS } from '../public/js/settings.js';
import { score } from '../public/js/palette.js';

test('empty settings resolve to the defaults', () => {
  assert.deepEqual(resolve({}).settings, DEFAULTS);
  assert.deepEqual(diff(resolve({}).settings), {});
});

test('valid values apply, invalid ones are ignored with a warning', () => {
  const { settings, warnings } = resolve({ theme: 'phosphor', fontSize: 99, colors: { accent: '#ff5500', bg: 'red' }, panes: ['debts', 'nope'], bogus: 1 });
  assert.equal(settings.theme, 'phosphor');
  assert.equal(settings.fontSize, DEFAULTS.fontSize);
  assert.deepEqual(settings.colors, { accent: '#ff5500' });
  assert.deepEqual(settings.panes, ['debts']);
  assert.equal(warnings.length, 4);
});

test('fonts that could inject css are refused', () => {
  assert.equal(resolve({ font: "x'; } body { display:none" }).settings.font, DEFAULTS.font);
  assert.equal(resolve({ font: 'Berkeley Mono' }).settings.font, 'Berkeley Mono');
});

test('only changed settings are written to settings.json', () => {
  assert.deepEqual(diff(resolve({ theme: 'ink', columns: 1 }).settings), { theme: 'ink', columns: 1 });
});

test('palette fuzzy match ranks word starts', () => {
  assert.ok(score('thph', 'theme: phosphor') > 0);
  assert.equal(score('xyz', 'theme: ink'), 0);
  assert.ok(score('imp', 'import a file') > score('imp', 'theme: simple'));
});
