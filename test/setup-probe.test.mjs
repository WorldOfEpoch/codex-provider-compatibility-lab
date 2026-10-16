import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeConnection } from '../src/probe.mjs';

const cli = fileURLToPath(new URL('../bin/lab.mjs', import.meta.url));
const run = (args, env = process.env) => new Promise(resolve => {
  execFile(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true, timeout: 10000, env },
    (error, stdout, stderr) => resolve({ status: error ? error.code : 0, stdout, stderr }));
});
async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'compatibility-client-test-'));
  const file = join(root, 'provider.json');
  t.after(async () => { await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; }); await rmdir(root); });
  return file;
}
async function endpoint(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return 'http://127.0.0.1:' + server.address().port + '/v1/chat/completions';
}
async function setup(file, url, extra = []) {
  return run(['init', '--protocol', 'chat_completions', '--endpoint', url, '--model', 'example/model', '--out', file, ...extra]);
}
function complete(content) {
  return { object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] };
}
test('setup and doctor are offline, repeatable and do not overwrite a connection', async t => {
  let calls = 0;
  const url = await endpoint(t, (req, res) => { calls++; res.end(); });
  const file = await temporary(t);
  assert.equal((await setup(file, url)).status, 0);
  const before = await readFile(file, 'utf8');
  assert.equal(JSON.parse(before).apiKeyEnv, null);
  const second = await setup(file, url);
  assert.equal(second.status, 2);
  assert.match(second.stderr, /config_exists/);
  assert.equal(await readFile(file, 'utf8'), before);
  const doctor = await run(['doctor', '--config', file]);
  assert.equal(doctor.status, 0);
  assert.equal(JSON.parse(doctor.stdout).networkUsed, false);
  assert.ok(!doctor.stdout.includes(url));
  assert.equal(calls, 0);
});
test('doctor reports missing credentials without displaying configured paths or keys', async t => {
  const file = await temporary(t);
  assert.equal((await setup(file, 'https://example.invalid/v1/chat/completions', ['--key-env', 'COMPAT_SYNTHETIC_TEST_KEY'])).status, 0);
  const env = { ...process.env }; delete env.COMPAT_SYNTHETIC_TEST_KEY;
  const result = await run(['doctor', '--config', file], env);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).credentialReady, false);
  assert.ok(!result.stdout.includes('COMPAT_SYNTHETIC_TEST_KEY'));
  assert.ok(!result.stdout.includes(file));
});

test('doctor rejects credential values that the transport cannot send', async t => {
  const file = await temporary(t);
  await setup(file, 'https://example.invalid/v1/chat/completions', ['--key-env', 'COMPAT_SYNTHETIC_TEST_KEY']);
  for (const value of [' ', 'PRIVATE_SYNTHETIC_KEY\n']) {
    const result = await run(['doctor', '--config', file], { ...process.env, COMPAT_SYNTHETIC_TEST_KEY: value });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).credentialReady, false);
    assert.ok(!result.stdout.includes('PRIVATE_SYNTHETIC_KEY'));
  }
});
test('network probe requires explicit opt-in and never auto-starts a provider', async t => {
  let calls = 0;
  const url = await endpoint(t, (req, res) => { calls++; res.end(); });
  const file = await temporary(t); await setup(file, url);
  const result = await run(['probe', '--config', file]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /network_opt_in_required/);
  assert.equal(calls, 0);
});

test('library probes require a true boolean opt-in and boolean tool selection', async t => {
  let calls = 0;
  const url = await endpoint(t, (req, res) => { calls++; res.end(); });
  const file = await temporary(t); await setup(file, url, ['--tools']);
  const config = JSON.parse(await readFile(file, 'utf8'));
  for (const network of [false, undefined, 'false', 'true', 1]) {
    await assert.rejects(probeConnection(config, { network }), { message: 'network_opt_in_required' });
  }
  for (const tools of [null, 'false', 1]) {
    await assert.rejects(probeConnection(config, { network: true, tools }), { message: 'invalid_probe_options' });
  }
  assert.equal(calls, 0);
});
test('full probe checks JSON, streaming, namespaced tool selection and result replay in four requests', async t => {
  const requests = [];
  const url = await endpoint(t, async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text); requests.push(body);
    if (body.stream) {
      res.setHeader('content-type', 'text/event-stream');
      const chunk = (delta, finish_reason = null) => ({ object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] });
      for (const item of [chunk({ role: 'assistant', content: 'compatibility' }), chunk({}, 'stop')]) res.write('data: ' + JSON.stringify(item) + '\n\n');
      res.end('data: [DONE]\n\n'); return;
    }
    res.setHeader('content-type', 'application/json');
    if (typeof body.tool_choice === 'object') {
      res.end(JSON.stringify({ object: 'chat.completion', choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
        tool_calls: [{ id: 'synthetic-call', type: 'function', function: { name: body.tool_choice.function.name, arguments: '{"value":"compatibility"}' } }] } }] }));
    } else res.end(JSON.stringify(complete('compatibility')));
  });
  const file = await temporary(t); await setup(file, url, ['--tools']);
  const result = await run(['probe', '--config', file, '--network', '--tools']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.passed, true);
  assert.equal(report.requestLimit, 4);
  assert.equal(requests.length, 4);
  assert.ok(requests.every(request => request.max_tokens === 128));
  assert.equal(requests[3].messages.at(-1).tool_call_id, 'synthetic-call');
  assert.ok(!result.stdout.includes('synthetic-call'));
  assert.ok(!result.stdout.includes(url));
});
test('probe stops on the first failure and leaves later checks explicitly unrun', async t => {
  let calls = 0;
  const url = await endpoint(t, (req, res) => { calls++; res.writeHead(429, { 'content-type': 'application/json' }); res.end('{"error":"PRIVATE_UPSTREAM_TEXT"}'); });
  const file = await temporary(t); await setup(file, url);
  const result = await run(['probe', '--config', file, '--network']);
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert.equal(calls, 1);
  assert.equal(report.results[0].code, 'provider_rate_limited');
  assert.equal(report.results[1].status, 'not_run');
  assert.ok(!result.stdout.includes('PRIVATE_'));
});

test('probe rejects extra tool arguments and calls returned despite text-only or no-tool requests', async t => {
  for (const fault of ['extra_arguments', 'text_tool_call', 'replay_tool_call']) {
    await t.test(fault, async child => {
      let calls = 0;
      const url = await endpoint(child, async (req, res) => {
        let text = ''; for await (const chunk of req) text += chunk;
        const body = JSON.parse(text); calls++;
        res.setHeader('content-type', 'application/json');
        const named = typeof body.tool_choice === 'object';
        const unexpected = (fault === 'text_tool_call' && calls === 1) || (fault === 'replay_tool_call' && body.tool_choice === 'none');
        if (named || unexpected) {
          const args = { value: 'compatibility', ...(fault === 'extra_arguments' ? { extra: 'synthetic' } : {}) };
          res.end(JSON.stringify({ object: 'chat.completion', choices: [{ index: 0, finish_reason: 'tool_calls', message: {
            role: 'assistant', content: named ? null : 'compatibility', tool_calls: [{ id: 'synthetic-call', type: 'function', function: {
              name: named ? body.tool_choice.function.name : (body.tools?.[0].function.name ?? 'unexpected'), arguments: JSON.stringify(args),
            } }],
          } }] }));
        } else res.end(JSON.stringify(complete('compatibility')));
      });
      const file = await temporary(child); await setup(file, url, ['--tools']);
      const config = JSON.parse(await readFile(file, 'utf8'));
      config.profile.streaming = false;
      const report = await probeConnection(config, { network: true, tools: true });
      assert.equal(report.passed, false);
      assert.equal(report.failure.message, 'probe_tool_mismatch');
      assert.equal(calls, fault === 'text_tool_call' ? 1 : fault === 'extra_arguments' ? 2 : 3);
      assert.ok(!JSON.stringify(report).includes('synthetic-call'));
      assert.equal(report.results.find(entry => entry.status === 'failed').name,
        fault === 'text_tool_call' ? 'text_json' : fault === 'extra_arguments' ? 'named_tool_call' : 'tool_result_replay');
    });
  }
});
test('ordinary run prints a model answer from the selected endpoint', async t => {
  const url = await endpoint(t, (req, res) => { req.resume(); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(complete('Synthetic answer'))); });
  const file = await temporary(t); await setup(file, url);
  const result = await run(['run', '--config', file, '--prompt', 'Synthetic question']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Synthetic answer\n');
});

test('file-input runs apply the default token budget and preserve explicit file or CLI limits', async t => {
  const requests = [];
  const url = await endpoint(t, async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    requests.push(JSON.parse(text));
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(complete('Synthetic answer')));
  });
  const file = await temporary(t); await setup(file, url);
  const input = await temporary(t);
  await writeFile(input, JSON.stringify({ input: 'Synthetic question' }));
  assert.equal((await run(['run', '--config', file, '--input', input])).status, 0);
  await writeFile(input, JSON.stringify({ input: 'Synthetic question', max_output_tokens: 19 }));
  assert.equal((await run(['run', '--config', file, '--input', input])).status, 0);
  assert.equal((await run(['run', '--config', file, '--input', input, '--max-tokens', '23'])).status, 0);
  assert.deepEqual(requests.map(request => request.max_tokens), [512, 19, 23]);
});
test('malformed private configuration and unknown arguments produce safe errors', async t => {
  const file = await temporary(t); await writeFile(file, '{"private":"PRIVATE_CONTENT" invalid}');
  const result = await run(['doctor', '--config', file]);
  assert.equal(result.status, 2);
  assert.ok(!result.stderr.includes(file));
  assert.ok(!result.stderr.includes('PRIVATE_CONTENT'));
  assert.equal((await run(['doctor', '--unexpected', 'PRIVATE_VALUE'])).status, 2);
});
