import { inspectHistory, restoreEvent } from './compatibility.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.length > 0;
const fail = code => { throw new Error(code); };
const only = (value, fields, code) => { if (Object.keys(value).some(key => !fields.includes(key))) fail(code); };

function content(parts, role) {
  if (typeof parts === 'string') return parts;
  if (!Array.isArray(parts)) fail('unsupported_chat_content');
  return parts.map(part => {
    if (!object(part)) fail('unsupported_chat_content');
    if (['input_text', 'output_text', 'text'].includes(part.type) && typeof part.text === 'string') {
      // Output annotations/logprobs describe the previous response; Chat history carries its text.
      only(part, part.type === 'output_text' ? ['type', 'text', 'annotations', 'logprobs'] : ['type', 'text'], 'unsupported_chat_content');
      if ((part.annotations !== undefined && !Array.isArray(part.annotations)) ||
          (part.logprobs !== undefined && !Array.isArray(part.logprobs))) fail('unsupported_chat_content');
      return { type: 'text', text: part.text };
    }
    if (role === 'user' && part.type === 'input_image' && typeof part.image_url === 'string') {
      only(part, ['type', 'image_url', 'detail'], 'unsupported_chat_content');
      if (part.detail !== undefined && typeof part.detail !== 'string') fail('unsupported_chat_content');
      return { type: 'image_url', image_url: { url: part.image_url, ...(part.detail ? { detail: part.detail } : {}) } };
    }
    if (role === 'user' && part.type === 'image_url' && object(part.image_url) && typeof part.image_url.url === 'string') {
      only(part, ['type', 'image_url'], 'unsupported_chat_content');
      only(part.image_url, ['url', 'detail'], 'unsupported_chat_content');
      if (part.image_url.detail !== undefined && typeof part.image_url.detail !== 'string') fail('unsupported_chat_content');
      return structuredClone(part);
    }
    fail('unsupported_chat_content');
  });
}

export function toChatRequest(request, profile) {
  const messages = [];
  if (request.instructions !== undefined) messages.push({ role: 'system', content: request.instructions });
  const input = typeof request.input === 'string' ? [{ role: 'user', content: request.input }] : request.input;
  const calls = new Set();
  const pending = new Set();
  for (const item of input) {
    if (item.type === 'function_call') {
      only(item, ['type', 'id', 'status', 'call_id', 'name', 'arguments'], 'unsupported_chat_history_field');
      const last = messages.at(-1);
      if (pending.size && last?.role !== 'assistant') fail('unfinished_tool_history');
      if (calls.has(item.call_id)) fail('duplicate_call_id');
      calls.add(item.call_id); pending.add(item.call_id);
      const call = { id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } };
      if (last?.role === 'assistant') (last.tool_calls ??= []).push(call);
      else messages.push({ role: 'assistant', content: null, tool_calls: [call] });
    } else if (item.type === 'function_call_output') {
      only(item, ['type', 'id', 'status', 'call_id', 'output'], 'unsupported_chat_history_field');
      if (!pending.delete(item.call_id)) fail('unmatched_tool_output');
      if (typeof item.output !== 'string') fail('chat_tool_output_must_be_text');
      messages.push({ role: 'tool', tool_call_id: item.call_id, content: item.output });
    } else if ([undefined, 'message'].includes(item.type) && ['system', 'developer', 'user', 'assistant'].includes(item.role)) {
      // Canonical item IDs/status are protocol metadata, not model-visible message content.
      only(item, ['type', 'id', 'status', 'role', 'content'], 'unsupported_chat_history_field');
      if (pending.size) fail('unfinished_tool_history');
      messages.push({ role: item.role, content: content(item.content, item.role) });
    } else fail('unsupported_chat_history_item');
  }
  if (pending.size) fail('unfinished_tool_history');
  const out = { model: request.model, messages };
  for (const key of ['stream', 'parallel_tool_calls']) if (request[key] !== undefined) out[key] = request[key];
  if (request.max_output_tokens !== undefined) out[profile.chatMaxTokensField ?? 'max_tokens'] = request.max_output_tokens;
  if (request.tools !== undefined) out.tools = request.tools.map(tool => {
    if (Object.keys(tool).some(key => !['type', 'name', 'description', 'parameters', 'strict'].includes(key))) fail('unsupported_function_schema_field');
    const { type, ...definition } = tool;
    return { type, function: definition };
  });
  if (request.tool_choice !== undefined) {
    if (object(request.tool_choice)) only(request.tool_choice, ['type', 'name'], 'unsupported_tool_choice');
    out.tool_choice = object(request.tool_choice)
      ? { type: 'function', function: { name: request.tool_choice.name } }
      : request.tool_choice;
  }
  return out;
}

export function restoreChatResponse(body, plan) {
  if (!object(body) || body.error != null || body.object !== 'chat.completion' || !Array.isArray(body.choices) || body.choices.length !== 1) fail('invalid_chat_response');
  const choice = body.choices[0];
  if (!object(choice) || (choice.index !== undefined && choice.index !== 0) || !['stop', 'tool_calls'].includes(choice.finish_reason)) fail('incomplete_chat_response');
  const message = choice.message;
  if (!object(message) || message.role !== 'assistant' ||
      (message.content !== null && typeof message.content !== 'string') ||
      Object.keys(message).some(key => !['role', 'content', 'tool_calls', 'refusal'].includes(key)) ||
      (message.refusal !== undefined && message.refusal !== null)) fail('unsupported_chat_response');
  const outputText = message.content ?? '';
  const output = outputText ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: outputText }] }] : [];
  if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) fail('invalid_chat_tool_call');
  const seen = new Set();
  for (const call of message.tool_calls ?? []) {
    if (!object(call) || call.type !== 'function' || !nonempty(call.id) || seen.has(call.id) ||
        !object(call.function) || !nonempty(call.function.name) || typeof call.function.arguments !== 'string') fail('invalid_chat_tool_call');
    seen.add(call.id);
    const item = { type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments };
    if (inspectHistory([item]).issues.length) fail('invalid_chat_tool_arguments');
    output.push(restoreEvent({ type: 'response.output_item.done', item }, plan).item);
  }
  if ((choice.finish_reason === 'tool_calls') !== (seen.size > 0)) fail('invalid_chat_finish_reason');
  return { outputText, output };
}
