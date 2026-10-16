import test from 'node:test';
import assert from 'node:assert/strict';
import { scanText, auditPublication } from '../scripts/audit-publication.mjs';

test('credential-shaped examples are detected without returning the matched value', () => {
  const examples = [
    ['sk-' + 'A'.repeat(30), 'provider_key'],
    ['sk-or-v1-' + 'B'.repeat(40), 'provider_key'],
    ['ghp_' + 'C'.repeat(36), 'github_token'],
    ['github_pat_' + 'D'.repeat(40), 'github_token'],
    ['AKIA' + 'E'.repeat(16), 'cloud_access_key'],
    [['-----BEGIN', 'PRIVATE KEY-----'].join(' '), 'private_key'],
    ['https://' + 'example:password@' + 'example.invalid', 'credential_url'],
  ];
  for (const [value, code] of examples) {
    assert.ok(scanText(value).includes(code));
    assert.ok(!JSON.stringify(scanText(value)).includes(value));
  }
});
test('personal paths are detected without returning usernames or path contents', () => {
  for (const value of ['C:' + '\\Users\\' + 'synthetic\\data', '/' + 'home/' + 'synthetic/data']) {
    assert.equal(scanText(value).length, 1);
    assert.ok(!JSON.stringify(scanText(value)).includes('synthetic'));
  }
});
test('ordinary public documentation does not resemble a credential', () => {
  assert.deepEqual(scanText('API_KEY is configured privately. https://example.invalid/docs'), []);
});
test('the complete publication matches its reviewed file manifest', async () => {
  const result = await auditPublication();
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});
