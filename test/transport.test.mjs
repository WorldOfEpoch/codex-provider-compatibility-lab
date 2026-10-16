import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { generate, validateConnection, transportErrorCodes } from '../src/transport.mjs';

const profile = {
  id: 'synthetic-provider', model: 'synthetic-model', wireApi: 'responses', namespaces: 'flatten',
  conversationState: 'stateless', functionTools: true, streaming: true, images: false, maxInlineImageBytes: 0,
};
const request = { input: 'Synthetic prompt only' };
const tools = [{ type: 'namespace', name: 'catalog', tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }] }];
const responseBody = (text = 'Hello') => ({
  object: 'response', status: 'completed', output: [{
    type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text }],
  }],
});
const chatBody = (text = 'Hello') => ({
  object: 'chat.completion', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }],
});
const event = value => `data: ${JSON.stringify(value)}\n\n`;
const chatChunk = (delta = {}, finish = null) => ({
  object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }],
});
const completed = (text = 'Hello') => event({ type: 'response.completed', response: responseBody(text) });
const textDelta = (delta = 'Hello') => event({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta });
const sendJson = (res, body) => { res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
const sendStream = (res, body) => { res.setHeader('content-type', 'text/event-stream'); res.end(body); };

// All requests in this file go to an ephemeral loopback server; no provider or account is used.
async function mockServer(t, handler) {
  const requests = [];
  const failures = [];
  const server = createServer((req, res) => {
    (async () => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const record = { headers: req.headers, method: req.method, path: req.url, body: JSON.parse(Buffer.concat(chunks).toString()) };
      requests.push(record);
      await handler(req, res, record);
    })().catch(error => { failures.push(error); res.destroy(); });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    assert.deepEqual(failures, []);
  });
  return {
    requests,
    config(wireApi = 'responses', extra = {}) {
      return {
        schemaVersion: 1, endpoint: `http://127.0.0.1:${server.address().port}/v1/${wireApi === 'responses' ? 'responses' : 'chat/completions'}`,
        apiKeyEnv: null, profile: { ...profile, wireApi }, timeoutMs: 2000, maxResponseBytes: 2 * 1024 * 1024, ...extra,
      };
    },
  };
}

function withEnvironment(t, name, value) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
}

test('connection validation is explicit, detached and accepts literal loopback only for HTTP', () => {
  const valid = { schemaVersion: 1, endpoint: 'https://provider.example/v1/responses', apiKeyEnv: null, profile, timeoutMs: 100, maxResponseBytes: 4096 };
  assert.deepEqual(validateConnection(valid), valid);
  assert.notEqual(validateConnection(valid).profile, profile);
  for (const endpoint of ['http://127.0.0.1:8080/responses', 'http://127.2.3.4/responses', 'http://[::1]:8080/responses']) {
    assert.equal(validateConnection({ ...valid, endpoint }).endpoint, endpoint);
  }
  for (const endpoint of ['http://localhost/responses', 'http://127.1/responses', 'http://2130706433/responses', 'http://0x7f000001/responses', 'http://127.000.0.1/responses', 'http://0.0.0.0/responses', 'http://192.0.2.1/responses', 'file:///responses']) {
    assert.throws(() => validateConnection({ ...valid, endpoint }), { message: 'insecure_endpoint' });
  }
  for (const endpoint of ['https://' + 'user:PRIVATE_VALUE@provider.example/responses', 'https://@provider.example/responses', 'https:provider.example/responses', 'https://provider.example/responses?key=PRIVATE_VALUE', 'https://provider.example/responses#fragment', ' https://provider.example/responses', 'https://provider.example\\responses']) {
    assert.throws(() => validateConnection({ ...valid, endpoint }), { message: 'invalid_endpoint' });
  }
  assert.throws(() => validateConnection({ ...valid, endpoint: 'https://provider.example/v1/chat/completions' }), { message: 'endpoint_protocol_mismatch' });
  for (const extra of [{ schemaVersion: 2 }, { timeoutMs: 0 }, { timeoutMs: 300001 }, { maxResponseBytes: 0 }, { maxResponseBytes: 67108865 }, { apiKeyEnv: 'BAD-NAME' }, { apiKey: 'PRIVATE_VALUE' }]) {
    assert.throws(() => validateConnection({ ...valid, ...extra }), { message: 'invalid_connection_config' });
  }
});

test('Responses JSON requests restore namespaced calls, preserve reasoning, and keep diagnostics content-free', async t => {
  withEnvironment(t, 'COMPAT_TEST_API_KEY', 'SYNTHETIC_PRIVATE_KEY');
  const mock = await mockServer(t, (req, res, record) => {
    const body = responseBody('Synthetic reply');
    body.output.push({ type: 'reasoning', summary: [], encrypted_content: 'opaque-synthetic-history' });
    body.output.push({ type: 'function_call', call_id: 'call-one', name: record.body.tools[0].name, arguments: '{"id":"example"}' });
    sendJson(res, body);
  });
  const input = { ...request, tools };
  const config = mock.config('responses', { apiKeyEnv: 'COMPAT_TEST_API_KEY' });
  const before = structuredClone({ input, config });
  const result = await generate(input, config);
  assert.equal(result.outputText, 'Synthetic reply');
  assert.equal(result.output[1].encrypted_content, 'opaque-synthetic-history');
  assert.deepEqual(result.output[2], { type: 'function_call', call_id: 'call-one', name: 'lookup', namespace: 'catalog', arguments: '{"id":"example"}' });
  assert.equal(mock.requests.length, 1);
  assert.equal(mock.requests[0].headers.authorization, 'Bearer SYNTHETIC_PRIVATE_KEY');
  assert.equal(mock.requests[0].body.model, profile.model);
  assert.equal(mock.requests[0].body.store, false);
  assert.deepEqual({ input, config }, before);
  assert.ok(!JSON.stringify(result.diagnostics).includes('Synthetic'));
  assert.ok(!JSON.stringify(result.diagnostics).includes('PRIVATE'));
  assert.equal(result.diagnostics.streamed, false);
});

test('Chat Completions JSON uses the explicit wire protocol and restores tool identities', async t => {
  const mock = await mockServer(t, (req, res, record) => sendJson(res, {
    object: 'chat.completion', choices: [{ index: 0, finish_reason: 'tool_calls', message: {
      role: 'assistant', content: null, tool_calls: [{ id: 'call-one', type: 'function', function: { name: record.body.tools[0].function.name, arguments: '{}' } }],
    } }],
  }));
  const result = await generate({ ...request, tools }, mock.config('chat_completions'));
  assert.deepEqual(mock.requests[0].body.messages, [{ role: 'user', content: request.input }]);
  assert.equal(mock.requests[0].body.input, undefined);
  assert.equal(mock.requests[0].headers.authorization, undefined);
  assert.equal(result.output[0].namespace, 'catalog');
  assert.equal(result.output[0].name, 'lookup');
});

test('missing and invalid environment credentials stop before networking without exposing values', async t => {
  const mock = await mockServer(t, (req, res) => sendJson(res, responseBody()));
  withEnvironment(t, 'COMPAT_TEST_MISSING_KEY', undefined);
  await assert.rejects(generate(request, mock.config('responses', { apiKeyEnv: 'COMPAT_TEST_MISSING_KEY' })), { message: 'api_key_env_missing' });
  withEnvironment(t, 'COMPAT_TEST_BAD_KEY', 'PRIVATE_VALUE\r\n');
  await assert.rejects(generate(request, mock.config('responses', { apiKeyEnv: 'COMPAT_TEST_BAD_KEY' })), { message: 'api_key_env_invalid' });
  assert.equal(mock.requests.length, 0);
});

test('redirects are not followed and errors never include provider bodies', async t => {
  const mock = await mockServer(t, (req, res) => {
    res.writeHead(307, { location: '/redirect-target?PRIVATE_VALUE', 'content-type': 'application/json' });
    res.end('{"error":"PRIVATE_PROVIDER_BODY"}');
  });
  await assert.rejects(generate(request, mock.config()), { message: 'provider_redirect_rejected' });
  assert.equal(mock.requests.length, 1);
});

test('rate limits, authentication failures and server failures each make exactly one attempt', async t => {
  for (const [status, code] of [[429, 'provider_rate_limited'], [401, 'provider_auth_failed'], [403, 'provider_auth_failed'], [500, 'provider_unavailable'], [503, 'provider_unavailable'], [400, 'provider_http_error']]) {
    await t.test(String(status), async child => {
      const mock = await mockServer(child, (req, res) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end('{"error":"PRIVATE_PROVIDER_BODY"}'); });
      await assert.rejects(generate(request, mock.config()), { message: code });
      assert.equal(mock.requests.length, 1);
    });
  }
});

test('the declared streaming mode requires the matching response content type', async t => {
  for (const stream of [false, true]) {
    await t.test(String(stream), async child => {
      const mock = await mockServer(child, (req, res) => { res.setHeader('content-type', 'text/html'); res.end('PRIVATE_PROVIDER_BODY'); });
      await assert.rejects(generate({ ...request, stream }, mock.config()), { message: 'unexpected_content_type' });
    });
  }
});

test('decoded response limits reject both plain and compressed oversized JSON', async t => {
  for (const compressed of [false, true]) {
    await t.test(String(compressed), async child => {
      const payload = Buffer.from(JSON.stringify(responseBody('x'.repeat(20000))));
      const mock = await mockServer(child, (req, res) => {
        res.setHeader('content-type', 'application/json');
        if (compressed) res.setHeader('content-encoding', 'gzip');
        res.end(compressed ? gzipSync(payload) : payload);
      });
      await assert.rejects(generate(request, mock.config('responses', { maxResponseBytes: 1024 })), { message: 'response_too_large' });
    });
  }
});

test('JSON requires valid UTF-8, JSON and a completed supported response', async t => {
  const cases = [
    [Buffer.from('{"PRIVATE_BODY":'), 'invalid_response_json'],
    [Buffer.from([0xff, 0xfe]), 'invalid_response_json'],
    [JSON.stringify({ ...responseBody(), status: 'incomplete' }), 'incomplete_response'],
    [JSON.stringify({ ...responseBody(), output: [{ type: 'web_search_call' }] }), 'unsupported_response_output'],
    [JSON.stringify({ ...responseBody(), output: [{ type: 'function_call', name: 'lookup', arguments: '{}' }] }), 'invalid_response_tool_call'],
    [JSON.stringify({ ...responseBody(), output: [{ type: 'reasoning', summary: null }] }), 'invalid_response_reasoning'],
  ];
  for (const [body, code] of cases) {
    await t.test(code, async child => {
      const mock = await mockServer(child, (req, res) => { res.setHeader('content-type', 'application/json'); res.end(body); });
      await assert.rejects(generate(request, mock.config()), { message: code });
    });
  }
});

test('Responses SSE handles byte splits, Unicode, comments and a real completed response', async t => {
  const reply = 'Café 🐇';
  const wire = Buffer.from(': hello\r\n\r\n' + textDelta('Café ') + textDelta('🐇') + completed(reply) + 'data: [DONE]\n\n');
  const mock = await mockServer(t, async (req, res) => {
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    for (const byte of wire) { if (res.destroyed) break; res.write(Buffer.from([byte])); await new Promise(setImmediate); }
    res.end();
  });
  const seen = [];
  const result = await generate({ ...request, stream: true }, mock.config('responses', { timeoutMs: 5000 }), { onText: text => seen.push(text) });
  assert.equal(seen.join(''), reply);
  assert.equal(result.outputText, reply);
  assert.equal(result.diagnostics.receivedBytes, wire.byteLength);
  assert.equal(result.diagnostics.streamed, true);
});

test('Responses completion without text deltas remains usable and reasoning is not displayed', async t => {
  const body = responseBody('Complete text');
  body.output.unshift({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'Opaque reasoning' }] });
  const mock = await mockServer(t, (req, res) => sendStream(res, event({ type: 'response.completed', response: body })));
  const seen = [];
  const result = await generate({ ...request, stream: true }, mock.config(), { onText: text => seen.push(text) });
  assert.equal(result.outputText, 'Complete text');
  assert.equal(result.output[0].type, 'reasoning');
  assert.deepEqual(seen, ['Complete text']);
});

test('Chat Completions SSE assembles text and permits a usage-only final chunk', async t => {
  const wire = event(chatChunk({ role: 'assistant', content: '' })) + event(chatChunk({ content: 'Hello ' })) + event(chatChunk({ content: 'world' }, 'stop')) +
    event({ object: 'chat.completion.chunk', choices: [], usage: { total_tokens: 3 } }) + 'data: [DONE]\n\n';
  const mock = await mockServer(t, (req, res) => sendStream(res, wire));
  const seen = [];
  const result = await generate({ ...request, stream: true }, mock.config('chat_completions'), { onText: async text => { seen.push(text); } });
  assert.equal(result.outputText, 'Hello world');
  assert.equal(seen.join(''), result.outputText);
});

test('Chat Completions SSE assembles fragmented function names and arguments without executing them', async t => {
  const mock = await mockServer(t, (req, res, record) => {
    const name = record.body.tools[0].function.name;
    sendStream(res,
      event(chatChunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call-one', type: 'function', function: { name: name.slice(0, 9), arguments: '{"id":' } }] })) +
      event(chatChunk({ tool_calls: [{ index: 0, function: { name: name.slice(9), arguments: '"example"}' } }] })) +
      event(chatChunk({}, 'tool_calls')) + 'data: [DONE]\n\n');
  });
  const result = await generate({ ...request, tools, stream: true }, mock.config('chat_completions'));
  assert.equal(result.outputText, '');
  assert.deepEqual(result.output, [{ type: 'function_call', call_id: 'call-one', namespace: 'catalog', name: 'lookup', arguments: '{"id":"example"}' }]);
});

test('Responses tool argument deltas must agree with the completed tool call', async t => {
  for (const mismatch of [false, true]) {
    await t.test(String(mismatch), async child => {
      const mock = await mockServer(child, (req, res, record) => sendStream(res,
        event({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '{' }) +
        event({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '}' }) +
        event({ type: 'response.completed', response: { object: 'response', status: 'completed', output: [{ type: 'function_call', name: record.body.tools[0].name, call_id: 'call-one', arguments: mismatch ? '{"changed":true}' : '{}' }] } })));
      const result = generate({ ...request, tools, stream: true }, mock.config());
      if (mismatch) await assert.rejects(result, { message: 'stream_output_mismatch' });
      else assert.equal((await result).output[0].namespace, 'catalog');
    });
  }
});

test('stream terminals, protocol errors and incomplete output are not mistaken for success', async t => {
  const cases = [
    ['responses', textDelta(), 'stream_incomplete'],
    ['responses', 'data: [DONE]\n\n', 'stream_incomplete'],
    ['responses', event({ type: 'response.failed', response: { error: 'PRIVATE_BODY' } }), 'provider_stream_error'],
    ['responses', event({ type: 'response.incomplete' }), 'provider_stream_error'],
    ['responses', event({ type: 'error', message: 'PRIVATE_BODY' }), 'provider_stream_error'],
    ['responses', textDelta('Changed') + completed('Hello'), 'stream_output_mismatch'],
    ['responses', completed() + textDelta(), 'unexpected_stream_event'],
    ['responses', completed() + 'data: [DONE]\n\ndata: [DONE]\n\n', 'unexpected_stream_event'],
    ['chat_completions', event(chatChunk({ role: 'assistant', content: 'Hello' }, 'stop')), 'stream_incomplete'],
    ['chat_completions', event(chatChunk({ role: 'assistant', content: 'Hello' })) + 'data: [DONE]\n\n', 'stream_incomplete'],
    ['chat_completions', event(chatChunk({ role: 'assistant' }, 'length')), 'stream_incomplete'],
    ['chat_completions', event({ error: { message: 'PRIVATE_BODY' } }), 'provider_stream_error'],
    ['chat_completions', event(chatChunk({ role: 'assistant' }, 'stop')) + event(chatChunk({ content: 'late' })), 'unexpected_stream_event'],
  ];
  for (const [wireApi, wire, code] of cases) {
    await t.test(`${wireApi}: ${code}`, async child => {
      const mock = await mockServer(child, (req, res) => sendStream(res, wire));
      await assert.rejects(generate({ ...request, stream: true }, mock.config(wireApi)), { message: code });
    });
  }
});

test('malformed streamed JSON, UTF-8, choices and tool calls fail safely', async t => {
  const cases = [
    ['responses', 'data: {"PRIVATE_BODY":\n\n', 'invalid_sse_json'],
    ['responses', Buffer.from([100, 97, 116, 97, 58, 32, 255, 10, 10]), 'invalid_stream_encoding'],
    ['responses', event({ type: 'response.output_text.delta', delta: {} }), 'invalid_stream_delta'],
    ['chat_completions', event({ object: 'chat.completion.chunk', choices: [{ index: 1, delta: {} }] }), 'unsupported_stream_choices'],
    ['chat_completions', event(chatChunk({ role: 'assistant', audio: 'PRIVATE_BODY' })), 'unsupported_stream_delta'],
    ['chat_completions', event(chatChunk({ tool_calls: [{ index: 9 }] })), 'invalid_stream_tool_call'],
    ['chat_completions', event(chatChunk({ tool_calls: [{ index: 0, function: { arguments: [] } }] })), 'invalid_stream_tool_call'],
    ['chat_completions', event(chatChunk({ role: 'assistant', tool_calls: [{ index: 0, type: 'function', function: { name: 'lookup', arguments: '{}' } }] }, 'tool_calls')) + 'data: [DONE]\n\n', 'invalid_chat_response'],
    ['chat_completions', event(chatChunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call-one', type: 'function', function: { name: 'lookup', arguments: 'PRIVATE_BAD_JSON' } }] }, 'tool_calls')) + 'data: [DONE]\n\n', 'invalid_chat_response'],
  ];
  for (const [wireApi, wire, code] of cases) {
    await t.test(`${wireApi}: ${code}`, async child => {
      const mock = await mockServer(child, (req, res) => sendStream(res, wire));
      await assert.rejects(generate({ ...request, stream: true }, mock.config(wireApi)), { message: code });
    });
  }
});

test('one SSE event is bounded independently of the total response budget', async t => {
  const mock = await mockServer(t, (req, res) => sendStream(res, 'data: ' + JSON.stringify({ type: 'synthetic.event', value: 'x'.repeat(1024 * 1024) }) + '\n\n'));
  await assert.rejects(generate({ ...request, stream: true }, mock.config()), { message: 'sse_event_too_large' });
});

test('the deadline covers both response headers and an unfinished response body', async t => {
  for (const streamStarted of [false, true]) {
    await t.test(String(streamStarted), async child => {
      const mock = await mockServer(child, (req, res) => {
        if (streamStarted) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(textDelta()); }
      });
      await assert.rejects(generate({ ...request, stream: true }, mock.config('responses', { timeoutMs: 60 })), { message: 'request_timeout' });
      assert.equal(mock.requests.length, 1);
    });
  }
});

test('cancellation before networking and during a stream uses a fixed error, not the supplied reason', async t => {
  const early = new AbortController();
  early.abort(new Error('PRIVATE_CANCEL_REASON'));
  const mock = await mockServer(t, (req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(textDelta()); });
  await assert.rejects(generate(request, mock.config(), { signal: early.signal }), { message: 'request_cancelled' });
  assert.equal(mock.requests.length, 0);
  const late = new AbortController();
  await assert.rejects(generate({ ...request, stream: true }, mock.config(), { signal: late.signal, onText: () => late.abort('PRIVATE_CANCEL_REASON') }), { message: 'request_cancelled' });
  assert.equal(mock.requests.length, 1);
});

test('text callback errors are sanitized and asynchronous callbacks share the overall deadline', async t => {
  const mock = await mockServer(t, (req, res) => sendStream(res, textDelta() + completed()));
  await assert.rejects(generate({ ...request, stream: true }, mock.config(), { onText: () => { throw new Error('PRIVATE_CALLBACK_VALUE'); } }), { message: 'text_callback_failed' });
  await assert.rejects(generate({ ...request, stream: true }, mock.config('responses', { timeoutMs: 60 }), { onText: () => new Promise(() => {}) }), { message: 'request_timeout' });
});

test('invalid requests and callback options fail before networking; exported errors are fixed codes', async t => {
  const mock = await mockServer(t, (req, res) => sendJson(res, responseBody()));
  await assert.rejects(generate({ ...request, privateOption: 'PRIVATE_VALUE' }, mock.config()), { message: 'request_incompatible' });
  await assert.rejects(generate(request, mock.config(), { signal: {} }), { message: 'invalid_abort_signal' });
  await assert.rejects(generate(request, mock.config(), { onText: 'PRIVATE_VALUE' }), { message: 'invalid_text_callback' });
  assert.equal(mock.requests.length, 0);
  assert.ok(Object.isFrozen(transportErrorCodes));
  assert.equal(new Set(transportErrorCodes).size, transportErrorCodes.length);
  assert.ok(transportErrorCodes.every(code => /^[a-z_]+$/.test(code)));
});

test('the serialized outgoing request has an independent 8 MiB limit before networking', async t => {
  const mock = await mockServer(t, (req, res) => sendJson(res, responseBody()));
  await assert.rejects(generate({ input: 'x'.repeat(8 * 1024 * 1024) }, mock.config()), { message: 'request_too_large' });
  assert.equal(mock.requests.length, 0);
});

test('a truncated Content-Length fails even when the received prefix is otherwise valid JSON', async t => {
  const payload = JSON.stringify(responseBody());
  const mock = await mockServer(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) + 100, connection: 'close' });
    res.end(payload);
  });
  await assert.rejects(generate(request, mock.config()), { message: 'transport_failed' });
  assert.equal(mock.requests.length, 1);
});

test('invalid content encoding fails without echoing the wire payload or retrying', async t => {
  const mock = await mockServer(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
    res.end('PRIVATE_PROVIDER_BODY_NOT_GZIP');
  });
  await assert.rejects(generate(request, mock.config()), { message: 'transport_failed' });
  assert.equal(mock.requests.length, 1);
});

test('a refused loopback connection fails once with a fixed safe code', async () => {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  await assert.rejects(generate(request, {
    schemaVersion: 1, endpoint: `http://127.0.0.1:${port}/responses`, apiKeyEnv: null,
    profile, timeoutMs: 2000, maxResponseBytes: 1024,
  }), { message: 'transport_failed' });
});
