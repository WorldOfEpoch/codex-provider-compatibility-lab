import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareRequest } from '../src/adapter.mjs';
import { restoreChatResponse } from '../src/chat-completions.mjs';

const profile = { id: 'synthetic-chat', model: 'example/model', wireApi: 'chat_completions', namespaces: 'flatten', conversationState: 'stateless', functionTools: true, streaming: true, images: true, maxInlineImageBytes: 1024 };
const tools = [{ type: 'namespace', name: 'catalog', tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object', properties: {} } }] }];
const call = { type: 'function_call', namespace: 'catalog', name: 'lookup', call_id: 'one', arguments: '{}' };
const result = { type: 'function_call_output', call_id: 'one', output: '' };
const response = message => ({ object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] });

test('chat conversion preserves a complete tool exchange and namespaced choice', () => {
  const request = { instructions: 'Synthetic instructions', input: [{ role: 'user', content: 'Find a sample' }, call, result], tools, tool_choice: { type: 'function', namespace: 'catalog', name: 'lookup' }, max_output_tokens: 8, stream: true };
  const original = structuredClone(request);
  const prepared = prepareRequest(request, profile);
  assert.equal(prepared.request.messages[0].role, 'system');
  const name = prepared.request.tools[0].function.name;
  assert.equal(prepared.request.messages[2].tool_calls[0].function.name, name);
  assert.equal(prepared.request.messages[3].content, '');
  assert.equal(prepared.request.tool_choice.function.name, name);
  assert.equal(prepared.request.max_tokens, 8);
  assert.equal(prepared.request.stream, true);
  assert.ok(!Object.hasOwn(prepared.request, 'store'));
  assert.deepEqual(request, original);
});
test('parallel calls remain grouped; output IDs and reversed result order are retained', () => {
  const prepared = prepareRequest({ input: [call, { ...call, call_id: 'two' }, { ...result, call_id: 'two' }, result], tools }, profile);
  assert.equal(prepared.request.messages[0].tool_calls.length, 2);
  assert.equal(prepared.request.messages[1].tool_call_id, 'two');
});

test('another assistant call group cannot interrupt pending parallel tool results', () => {
  const input = [call, { ...call, call_id: 'two' }, result, { ...call, call_id: 'three' }, { ...result, call_id: 'two' }, { ...result, call_id: 'three' }];
  assert.throws(() => prepareRequest({ input, tools }, profile), { message: 'unfinished_tool_history' });
  const completedRounds = [call, result, { ...call, call_id: 'two' }, { ...result, call_id: 'two' }];
  assert.deepEqual(prepareRequest({ input: completedRounds, tools }, profile).request.messages.map(message => message.role), ['assistant', 'tool', 'assistant', 'tool']);
});
test('chat completion token field is an explicit profile option', () => {
  assert.equal(prepareRequest({ input: 'Example', max_output_tokens: 12 }, { ...profile, chatMaxTokensField: 'max_completion_tokens' }).request.max_completion_tokens, 12);
});
test('text and URL images convert without fetching or mutating them', () => {
  const prepared = prepareRequest({ input: [{ role: 'user', content: [{ type: 'input_text', text: 'Describe' }, { type: 'input_image', image_url: 'https://example.invalid/image.png', detail: 'low' }] }] }, profile);
  assert.equal(prepared.request.messages[0].content[1].image_url.detail, 'low');
  assert.throws(() => prepareRequest({ input: [{ role: 'user', content: [{ type: 'input_image', file_id: 'example' }] }] }, profile), /unsupported_chat_content/);
});
test('unsupported or broken history fails instead of guessing or discarding items', () => {
  for (const input of [[result], [call], [call, call, result], [{ type: 'reasoning', summary: [] }], [call, { role: 'user', content: 'Next' }, result]]) {
    assert.throws(() => prepareRequest({ input, tools }, profile), /unmatched|unfinished|duplicate|unsupported/);
  }
  assert.throws(() => prepareRequest({ input: [call, { ...result, output: [] }], tools }, profile), /chat_tool_output_must_be_text/);
});

test('unhandled message, call, result and content fields fail instead of being silently lost', () => {
  for (const input of [
    [{ role: 'assistant', content: 'Example', tool_calls: [{ id: 'one', type: 'function', function: { name: 'lookup', arguments: '{}' } }] }],
    [{ role: 'assistant', content: 'Example', audio: { data: 'synthetic' } }],
    [{ ...call, extra: 'synthetic' }, result],
    [call, { ...result, extra: 'synthetic' }],
  ]) assert.throws(() => prepareRequest({ input, tools }, profile), { message: 'unsupported_chat_history_field' });
  for (const part of [
    { type: 'input_text', text: 'Example', attachment: 'synthetic' },
    { type: 'output_text', text: 'Example', annotations: {} },
    { type: 'input_image', image_url: 'https://example.invalid/image.png', file_id: 'synthetic-file' },
    { type: 'input_image', image_url: 'https://example.invalid/image.png', detail: {} },
    { type: 'image_url', image_url: { url: 'https://example.invalid/image.png', extra: 'synthetic' } },
  ]) assert.throws(() => prepareRequest({ input: [{ role: 'user', content: [part] }] }, profile), { message: 'unsupported_chat_content' });
  assert.throws(() => prepareRequest({ input: 'Example', tools, tool_choice: { type: 'function', namespace: 'catalog', name: 'lookup', extra: 'synthetic' } }, profile), { message: 'unsupported_tool_choice' });
});

test('known canonical metadata converts while preserving the message and tool content', () => {
  const input = [
    { type: 'message', id: 'message-one', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Example', annotations: [], logprobs: [] }] },
    { ...call, id: 'item-one', status: 'completed' },
    { ...result, id: 'result-one' },
  ];
  const prepared = prepareRequest({ input, tools }, profile);
  assert.deepEqual(prepared.request.messages[0].content, [{ type: 'text', text: 'Example' }]);
  assert.equal(prepared.request.messages[0].tool_calls[0].id, 'one');
  assert.equal(prepared.request.messages[1].content, '');
});
test('completed chat tools restore original names; no tool is executed', () => {
  const prepared = prepareRequest({ input: 'Example', tools }, profile);
  const body = response({ content: null, tool_calls: [{ id: 'one', type: 'function', function: { name: prepared.request.tools[0].function.name, arguments: '{}' } }] });
  const restored = restoreChatResponse(body, prepared.plan);
  assert.equal(restored.output[0].namespace, 'catalog');
  assert.equal(restored.output[0].name, 'lookup');
  assert.equal(restored.outputText, '');
});
test('truncation, refusal, malformed tool calls and alternate outputs are explicit failures', () => {
  const valid = response({ content: 'Example' });
  assert.throws(() => restoreChatResponse({ ...valid, choices: [{ ...valid.choices[0], finish_reason: 'length' }] }, { mappings: [] }), /incomplete/);
  assert.throws(() => restoreChatResponse(response({ content: null, refusal: 'PRIVATE_CONTENT' }), { mappings: [] }), { message: 'unsupported_chat_response' });
  assert.throws(() => restoreChatResponse(response({ content: null, tool_calls: [{ id: 'one', type: 'function', function: { name: 'f', arguments: 'PRIVATE_CONTENT' } }] }), { mappings: [] }), { message: 'invalid_chat_tool_arguments' });
  assert.throws(() => restoreChatResponse(response({ content: 'Example', audio: {} }), { mappings: [] }), /unsupported/);
});

test('a completed-looking chat response with a provider error is not successful', () => {
  const body = { ...response({ content: 'Example' }), error: { message: 'PRIVATE_PROVIDER_BODY' } };
  assert.throws(() => restoreChatResponse(body, { mappings: [] }), { message: 'invalid_chat_response' });
  assert.equal(restoreChatResponse({ ...body, error: null }, { mappings: [] }).outputText, 'Example');
});
test('chat profiles cannot claim unimplemented native namespaces or server state', () => {
  for (const change of [{ namespaces: 'native' }, { conversationState: 'server' }, { chatMaxTokensField: 'unknown' }]) {
    assert.throws(() => prepareRequest({ input: 'Example' }, { ...profile, ...change }), /invalid_chat_profile/);
  }
});
