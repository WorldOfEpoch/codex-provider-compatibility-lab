import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createEventTranslator } from '../src/sse.mjs';
import { makeToolPlan } from '../src/compatibility.mjs';

const plan = makeToolPlan([{ type: 'namespace', name: 'catalog', tools: [{ type: 'function', name: 'lookup' }] }]);
async function transform(chunks, options) {
  let output = '';
  await pipeline(Readable.from(chunks), createEventTranslator(plan, options), new Writable({ write(chunk, encoding, next) { output += chunk.toString('utf8'); next(); } }));
  return output;
}
test('one-byte chunks preserve UTF-8, CRLF framing, comments, IDs and tool identity', async () => {
  const value = { type: 'response.output_item.added', item: { type: 'function_call', name: plan.mappings[0].wireName, call_id: 'one', arguments: '{"label":"café 🐇"}' } };
  const source = Buffer.from(': keepalive\r\nevent: response.output_item.added\r\nid: example\r\ndata: ' + JSON.stringify(value) + '\r\n\r\n');
  const result = await transform(Array.from(source, byte => Buffer.from([byte])));
  assert.ok(result.includes(': keepalive\n'));
  assert.ok(result.includes('id: example\n'));
  const data = JSON.parse(result.split('\n').find(line => line.startsWith('data: ')).slice(6));
  assert.equal(data.item.namespace, 'catalog');
  assert.equal(data.item.name, 'lookup');
  assert.equal(data.item.arguments, value.item.arguments);
});
test('multiple data lines combine before JSON parsing', async () => {
  const source = 'data: {"type":"response.output_item.done",\ndata: "item":{"type":"function_call","name":"' + plan.mappings[0].wireName + '","call_id":"one"}}\n\n';
  const output = await transform([Buffer.from(source)]);
  assert.equal(output.match(/^data:/gm).length, 1);
  assert.equal(JSON.parse(output.slice(6)).item.namespace, 'catalog');
});
test('DONE sentinels and comment-only events remain valid', async () => {
  assert.equal(await transform([Buffer.from(': ping\n\ndata: [DONE]\n\n')]), ': ping\n\ndata: [DONE]\n\n');
});
test('bare CR line endings are supported', async () => {
  assert.equal(await transform([Buffer.from('data: [DONE]\r\r')]), 'data: [DONE]\n\n');
});
test('a split initial UTF-8 marker does not hide the first event', async () => {
  const source = Buffer.from('\uFEFFdata: {"type":"example","text":"\uFEFFinside"}\n\n');
  const result = await transform(Array.from(source, byte => Buffer.from([byte])));
  assert.deepEqual(JSON.parse(result.slice(6)), { type: 'example', text: '\uFEFFinside' });
});
test('incomplete final events are discarded', async () => {
  assert.equal(await transform([Buffer.from('data: {"type":"partial"}\n')]), '');
});
test('invalid JSON fails with a content-free error', async () => {
  await assert.rejects(transform([Buffer.from('data: PRIVATE_SENTINEL\n\n')]), { message: 'invalid_sse_json' });
});
test('large terminated and unterminated events are rejected', async () => {
  await assert.rejects(transform([Buffer.from('data: ' + 'x'.repeat(100))], { maxEventBytes: 64 }), /sse_event_too_large/);
  await assert.rejects(transform([Buffer.from(': ' + 'x'.repeat(100) + '\n\n')], { maxEventBytes: 64 }), /sse_event_too_large/);
});
test('unknown event types are preserved without guessing at their structure', async () => {
  const value = { type: 'example.unknown', item: { type: 'function_call', name: plan.mappings[0].wireName } };
  const result = await transform([Buffer.from('data: ' + JSON.stringify(value) + '\n\n')]);
  assert.deepEqual(JSON.parse(result.slice(6)), value);
});
