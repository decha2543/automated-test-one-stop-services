// @ts-check
/**
 * Unit checks for the resilient move helper (scripts/lib/move-path.mjs), used
 * by the k6 / robot result pipelines instead of a bare `mv`. Guards the two
 * behaviours that matter: a file moves (creating missing parents) and a
 * directory moves recursively. Uses only os.tmpdir + node:test — no fixtures.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { movePath } from '../lib/move-path.mjs';

let dir = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'move-path-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('moves a file and creates missing destination parents', async () => {
  const src = path.join(dir, 'summary.json');
  fs.writeFileSync(src, '{"ok":true}', 'utf8');
  const dest = path.join(dir, 'a', 'b', 'summary.json');

  await movePath(src, dest);

  assert.equal(fs.existsSync(src), false, 'source removed after move');
  assert.equal(fs.readFileSync(dest, 'utf8'), '{"ok":true}');
});

test('moves a directory tree recursively', async () => {
  const src = path.join(dir, 'round_1');
  fs.mkdirSync(path.join(src, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(src, 'report.html'), '<html></html>', 'utf8');
  fs.writeFileSync(path.join(src, 'nested', 'log.txt'), 'log', 'utf8');
  const dest = path.join(dir, 'success', 'round_1');

  await movePath(src, dest);

  assert.equal(fs.existsSync(src), false, 'source dir removed after move');
  assert.equal(fs.readFileSync(path.join(dest, 'report.html'), 'utf8'), '<html></html>');
  assert.equal(fs.readFileSync(path.join(dest, 'nested', 'log.txt'), 'utf8'), 'log');
});

test('a missing source is a clear error', async () => {
  await assert.rejects(
    () => movePath(path.join(dir, 'nope.json'), path.join(dir, 'out.json')),
    /source not found/,
  );
});
