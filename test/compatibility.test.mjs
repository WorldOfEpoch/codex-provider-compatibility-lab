import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectHistory, makeToolPlan, wireName, translateHistory, translateToolChoice, restoreEvent, imageSummary, inspectRequest } from '../src/compatibility.mjs';

const tool = name => ({ type: 'function', name, parameters: { type: 'object', properties: {}, additionalProperties: false } });
const definitions = [{ type: 'namespace', name: 'catalog', tools: [tool('lookup')] }, { type: 'namespace', name: 'files', tools: [tool('lookup')] }, tool('ping')];

test('function outputs need call_id and output, but not name; empty output is valid', () => {
  assert.deepEqual(inspectHistory([{ type: 'function_call_output', call_id: 'one', output: '' }]).issues, []);
  assert.deepEqual(inspectHistory([{ type: 'function_call_output', output: 'example' }]).issues, [{ index: 0, field: 'call_id', code: 'missing_field' }]);
});
test('custom tool calls use input instead of arguments', () => {
  assert.deepEqual(inspectHistory([{ type: 'custom_tool_call', call_id: 'one', name: 'edit', input: '' }, { type: 'custom_tool_call_output', call_id: 'one', output: [] }]).issues, []);
});
test('malformed arguments and typed fields are reported without content', () => {
  const result = inspectHistory([{ type: 'function_call', call_id: '', name: null, arguments: 'PRIVATE_SENTINEL' }]);
  assert.equal(result.issues.length, 3);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
  assert.equal(inspectHistory([{ type: 'function_call', call_id: 'one', name: 'f', arguments: '[]' }]).issues[0].code, 'arguments_object_required');
});
test('the validator is explicit about unvalidated item types and invalid containers', () => {
  assert.equal(inspectHistory([{ type: 'message', content: [] }]).otherItems, 1);
  assert.equal(inspectHistory('example').kind, 'text');
  assert.equal(inspectHistory(null).kind, 'invalid');
  assert.equal(inspectHistory([null]).issues[0].code, 'item_shape');
  assert.equal(inspectHistory([{ type: '__proto__' }]).otherItems, 1);
});
test('namespace flattening preserves source schemas and distinguishes equal child names', () => {
  const before = JSON.stringify(definitions);
  const plan = makeToolPlan(definitions);
  assert.equal(plan.tools.length, 3);
  assert.notEqual(plan.tools[0].name, plan.tools[1].name);
  assert.equal(plan.tools[2].name, 'ping');
  assert.equal(JSON.stringify(definitions), before);
  assert.deepEqual(plan.tools[0].parameters, definitions[0].tools[0].parameters);
});
test('tuple framing avoids ambiguous identities containing delimiters', () => {
  assert.notEqual(wireName('a\u0000b', 'c'), wireName('a', 'b\u0000c'));
});
test('duplicate and colliding tool identities fail instead of silently changing targets', () => {
  assert.throws(() => makeToolPlan([tool('same'), tool('same')]), /colliding/);
  assert.throws(() => makeToolPlan([definitions[0], tool(wireName('catalog', 'lookup'))]), /colliding/);
});
test('unsupported hosted or custom tools are rejected, never silently removed', () => {
  for (const type of ['web_search', 'web_search_preview', 'custom', 'computer_use_preview']) {
    assert.throws(() => makeToolPlan([{ type }]), /unsupported/);
  }
  assert.throws(() => makeToolPlan([{ type: 'namespace', name: 'bad', tools: [{ type: 'custom', name: 'edit' }] }]), /unsupported/);
});
test('history translation round-trips identities and preserves call IDs and opaque content', () => {
  const plan = makeToolPlan(definitions);
  const history = [{ type: 'function_call', call_id: 'one', namespace: 'catalog', name: 'lookup', arguments: '{"type":"function_call","namespace":"do-not-touch"}' }, { type: 'function_call_output', call_id: 'one', output: [{ type: 'function_call', name: 'opaque' }] }];
  const original = structuredClone(history);
  const outbound = translateHistory(history, plan);
  assert.equal(outbound[0].name, plan.mappings[0].wireName);
  assert.equal(outbound[0].call_id, 'one');
  assert.equal(outbound[0].arguments, history[0].arguments);
  assert.deepEqual(outbound[1], history[1]);
  assert.deepEqual(translateHistory(outbound, plan, { outbound: false }), original);
  assert.deepEqual(history, original);
});
test('unmapped history and tool choices fail', () => {
  const plan = makeToolPlan(definitions);
  assert.throws(() => translateHistory([{ type: 'function_call', namespace: 'missing', name: 'lookup' }], plan), /unmapped/);
  assert.throws(() => translateToolChoice({ type: 'function', name: 'missing' }, plan), /unmapped/);
  assert.throws(() => translateToolChoice({ type: 'allowed_tools', tools: [] }, plan), /unsupported/);
});
test('explicit tool choices use the same mapping; control choices remain intact', () => {
  const plan = makeToolPlan(definitions);
  assert.deepEqual(translateToolChoice({ type: 'function', namespace: 'catalog', name: 'lookup' }, plan), { type: 'function', name: plan.mappings[0].wireName });
  for (const choice of [undefined, 'auto', 'none', 'required']) assert.equal(translateToolChoice(choice, plan), choice);
});
test('stream events restore only known protocol envelopes', () => {
  const plan = makeToolPlan(definitions);
  const item = { type: 'function_call', name: plan.mappings[0].wireName, call_id: 'one', arguments: '{}' };
  const done = restoreEvent({ type: 'response.completed', response: { output: [item] } }, plan);
  assert.equal(done.response.output[0].namespace, 'catalog');
  const opaque = { type: 'custom.event', item };
  assert.deepEqual(restoreEvent(opaque, plan), opaque);
  assert.ok(!Object.hasOwn(item, 'namespace'));
});
test('image accounting measures encoded URIs, ignores remote bytes and preserves content', () => {
  const uri = 'data:image/png;base64,' + 'A'.repeat(32);
  const input = [{ role: 'user', content: [{ type: 'input_image', image_url: uri }, { type: 'image_url', image_url: { url: uri } }, { type: 'input_image', image_url: 'https://example.invalid/image.png' }] }];
  const original = structuredClone(input);
  const summary = imageSummary(input, { budgetBytes: 64 });
  assert.equal(summary.inlineImages, 2);
  assert.equal(summary.remoteImages, 1);
  assert.equal(summary.encodedUriBytes, 2 * Buffer.byteLength(uri));
  assert.equal(summary.overBudget, true);
  assert.deepEqual(input, original);
});
test('image-looking tool outputs are opaque and invalid budgets fail', () => {
  assert.equal(imageSummary([{ type: 'function_call_output', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] }]).inlineImages, 0);
  assert.throws(() => imageSummary([], { budgetBytes: -1 }), /invalid/);
});
test('request summaries expose only counts, fixed codes and field names', () => {
  const request = { model: 'PRIVATE_MODEL', instructions: 'PRIVATE_PROMPT', headers: { authorization: 'PRIVATE_CREDENTIAL' }, input: [{ type: 'function_call_output', output: 'PRIVATE_OUTPUT' }], tools: [{ type: 'PRIVATE_TYPE' }] };
  const summary = JSON.stringify(inspectRequest(request));
  assert.ok(!summary.includes('PRIVATE_'));
  assert.equal(inspectRequest(request).toolPlan.supported, false);
});
