import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/inspect.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/example-request.json', import.meta.url));
const run = file => spawnSync(process.execPath, [cli, file], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
test('documented example succeeds without printing its content', () => {
  const result = run(fixture);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).history.issues.length, 0);
  assert.ok(!result.stdout.includes('Synthetic example only'));
});
test('malformed or oversized inputs fail without exposing file content or paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'compatibility-lab-test-'));
  const path = join(root, 'PRIVATE_FILENAME.json');
  try {
    await writeFile(path, '{"private":"PRIVATE_CONTENT" invalid}');
    let result = run(path);
    assert.equal(result.status, 2);
    assert.ok(!result.stderr.includes('PRIVATE_'));
    await writeFile(path, ' '.repeat(8 * 1024 * 1024 + 1));
    result = run(path);
    assert.equal(result.status, 2);
    assert.ok(!result.stderr.includes('PRIVATE_'));
  } finally { await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; }); await rmdir(root); }
});
test('missing files fail with a generic diagnostic', () => {
  const result = run(join(tmpdir(), 'PRIVATE_MISSING_COMPATIBILITY_EXAMPLE.json'));
  assert.equal(result.status, 2);
  assert.ok(!result.stderr.includes('PRIVATE_'));
});
