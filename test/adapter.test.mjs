import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareRequest, validateProfile } from '../src/adapter.mjs';
import { restoreEvent } from '../src/compatibility.mjs';

const profile = JSON.parse(await readFile(new URL('../fixtures/example-profile.json', import.meta.url)));
const example = JSON.parse(await readFile(new URL('../fixtures/example-request.json', import.meta.url)));
const minimal = { input: 'Synthetic request' };

test('one profile consistently maps definitions, history, choices and returned calls', () => {
  const input = { ...structuredClone(example), tool_choice: { type: 'function', namespace: 'catalog', name: 'lookup' } };
  const original = structuredClone(input);
  const result = prepareRequest(input, profile);
  const name = result.request.tools[0].name;
  assert.equal(result.request.input[1].name, name);
  assert.equal(result.request.tool_choice.name, name);
  assert.equal(result.request.store, false);
  assert.equal(result.request.model, profile.model);
  const response = restoreEvent({ type: 'response.output_item.done', item: result.request.input[1] }, result.plan);
  assert.equal(response.item.name, 'lookup');
  assert.equal(response.item.namespace, 'catalog');
  assert.equal(response.item.call_id, original.input[1].call_id);
  assert.deepEqual(input, original);
});
test('the same adapter accepts another explicitly selected model without aliases', () => {
  const second = { ...profile, id: 'another-provider', model: 'example/second-model' };
  assert.equal(prepareRequest(minimal, second).request.model, second.model);
  assert.throws(() => prepareRequest({ ...minimal, model: 'example/different-model' }, second), /model_profile_mismatch/);
});
test('native namespace mode retains the original request identities and response shape', () => {
  const input = { ...example, tool_choice: { type: 'function', namespace: 'catalog', name: 'lookup' } };
  const result = prepareRequest(input, { ...profile, namespaces: 'native' });
  assert.deepEqual(result.request.tools, input.tools);
  assert.deepEqual(result.request.input, input.input);
  assert.deepEqual(result.request.tool_choice, input.tool_choice);
  assert.deepEqual(result.plan.mappings, []);
});
test('stateless profiles reject persisted state rather than silently dropping it', () => {
  for (const options of [{ store: true }, { previous_response_id: 'synthetic-response' }]) {
    assert.throws(() => prepareRequest({ ...minimal, ...options }, profile), /server_state_not_supported/);
  }
  const stateful = { ...minimal, store: true, previous_response_id: 'synthetic-response' };
  assert.equal(prepareRequest(stateful, { ...profile, conversationState: 'server' }).request.previous_response_id, stateful.previous_response_id);
});
test('unsupported streaming, images and tools fail explicitly', () => {
  assert.throws(() => prepareRequest({ ...minimal, stream: true }, { ...profile, streaming: false }), /streaming_not_supported/);
  const input = [{ role: 'user', content: [{ type: 'input_image', file_id: 'synthetic-file' }] }];
  assert.throws(() => prepareRequest({ input }, { ...profile, images: false }), /images_not_supported/);
  assert.throws(() => prepareRequest(example, { ...profile, functionTools: false }), /function_tools_not_supported/);
  assert.throws(() => prepareRequest({ ...minimal, tools: [{ type: 'web_search' }] }, profile), /unsupported/);
});
test('inline image budgets are enforced without resizing or changing source content', () => {
  const request = { input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] }] };
  const before = structuredClone(request);
  assert.throws(() => prepareRequest(request, { ...profile, maxInlineImageBytes: 1 }), /inline_image_budget_exceeded/);
  assert.deepEqual(request, before);
});
test('unsupported fields and malformed options fail without exposing values', () => {
  for (const extra of [{ reasoning: { effort: 'PRIVATE_VALUE' } }, { metadata: { private: 'PRIVATE_VALUE' } }]) {
    assert.throws(() => prepareRequest({ ...minimal, ...extra }, profile), { message: 'unsupported_request_field' });
  }
  for (const extra of [{ stream: 'true' }, { store: null }, { max_output_tokens: 0 }, { instructions: [] }, { previous_response_id: '' }]) {
    assert.throws(() => prepareRequest({ ...minimal, ...extra }, profile), { message: 'invalid_request_option' });
  }
});
test('invalid history, missing required tools and unresolved identities fail', () => {
  assert.throws(() => prepareRequest({ input: [{ type: 'function_call_output', output: 'example' }] }, profile), /invalid_history_shape/);
  assert.throws(() => prepareRequest({ ...minimal, tool_choice: 'required' }, profile), /required_tools_missing/);
  assert.throws(() => prepareRequest({ ...minimal, tools: null }, profile), /tools_array_required/);
  const request = { input: [{ type: 'function_call', namespace: 'missing', name: 'lookup', call_id: 'one', arguments: '{}' }] };
  assert.throws(() => prepareRequest(request, profile), /unmapped_history_tool/);
});
test('profiles require explicit capabilities and a supported protocol', () => {
  assert.throws(() => validateProfile({}), /invalid_provider_profile/);
  assert.throws(() => validateProfile({ ...profile, wireApi: 'unknown_protocol' }), /unsupported_wire_api/);
  assert.throws(() => validateProfile({ ...profile, streaming: undefined }), /invalid_provider_profile/);
  assert.throws(() => validateProfile({ ...profile, maxInlineImageBytes: -1 }), /invalid_provider_profile/);
});
test('diagnostics omit private prompts, profile names and target model names', () => {
  const result = prepareRequest({ input: 'PRIVATE_PROMPT' }, { ...profile, id: 'PRIVATE_PROFILE', model: 'PRIVATE_MODEL' });
  assert.ok(!JSON.stringify(result.diagnostics).includes('PRIVATE_'));
  // The returned request is intentionally data, not a safe log or a redacted copy.
  assert.equal(result.request.input, 'PRIVATE_PROMPT');
});
