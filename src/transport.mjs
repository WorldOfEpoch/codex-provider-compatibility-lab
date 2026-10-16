import { prepareRequest, validateProfile } from './adapter.mjs';
import { inspectHistory, restoreEvent } from './compatibility.mjs';
import { restoreChatResponse } from './chat-completions.mjs';
import { createEventTranslator } from './sse.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.length > 0;
const index = value => Number.isSafeInteger(value) && value >= 0;
const connectionFields = new Set(['schemaVersion', 'endpoint', 'apiKeyEnv', 'profile', 'timeoutMs', 'maxResponseBytes']);
export const transportErrorCodes = Object.freeze([
  'invalid_connection_config', 'invalid_endpoint', 'insecure_endpoint', 'invalid_provider_profile',
  'endpoint_protocol_mismatch', 'incomplete_response', 'invalid_response_output', 'unsupported_response_output',
  'invalid_response_tool_call', 'invalid_response_reasoning', 'invalid_stream_event', 'provider_stream_error',
  'unexpected_stream_event', 'invalid_stream_delta', 'stream_output_mismatch', 'stream_incomplete',
  'unsupported_stream_choices', 'unsupported_stream_delta', 'invalid_stream_tool_call', 'invalid_chat_response',
  'invalid_abort_signal', 'invalid_text_callback', 'request_incompatible', 'request_too_large', 'api_key_env_missing',
  'api_key_env_invalid', 'request_cancelled', 'request_timeout', 'provider_redirect_rejected',
  'provider_rate_limited', 'provider_auth_failed', 'provider_unavailable', 'provider_http_error',
  'unexpected_content_type', 'missing_response_body', 'text_callback_failed', 'response_too_large',
  'invalid_response_json', 'invalid_stream_encoding', 'invalid_sse_json', 'sse_event_too_large', 'transport_failed',
]);
class TransportError extends Error {}
const fail = code => { throw new TransportError(code); };

// A content-free result shared by offline setup checks and the request sender.
export function inspectCredentialValue(value) {
  if (value === undefined || value === '') return { ready: false, code: 'api_key_env_missing' };
  if (typeof value !== 'string' || !/^[\x21-\x7e]+$/.test(value)) return { ready: false, code: 'api_key_env_invalid' };
  return { ready: true };
}

// Configuration is explicit: no endpoint discovery, model aliases, retries or saved credentials.
export function validateConnection(config) {
  if (!object(config) || Object.keys(config).some(key => !connectionFields.has(key)) ||
      config.schemaVersion !== 1 || !nonempty(config.endpoint) ||
      !(config.apiKeyEnv === null || (typeof config.apiKeyEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(config.apiKeyEnv))) ||
      !Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 300000 ||
      !Number.isSafeInteger(config.maxResponseBytes) || config.maxResponseBytes < 1 || config.maxResponseBytes > 64 * 1024 * 1024) fail('invalid_connection_config');
  let endpoint;
  try { endpoint = new URL(config.endpoint); }
  catch { fail('invalid_endpoint'); }
  if ((['http:', 'https:'].includes(endpoint.protocol) && !/^https?:\/\//i.test(config.endpoint)) || endpoint.username || endpoint.password ||
      config.endpoint.match(/^https?:\/\/([^/]*)/i)?.[1].includes('@') || config.endpoint.includes('?') || config.endpoint.includes('#') ||
      /[\s\\]/.test(config.endpoint)) fail('invalid_endpoint');
  if (endpoint.protocol === 'http:') {
    // Inspect the original authority too: URL normalizes shorthand and hexadecimal IPv4 literals.
    const authority = config.endpoint.match(/^http:\/\/([^/]+)/i)?.[1];
    const literalV4 = /^127(?:\.(?:0|[1-9][0-9]{0,2})){3}(?::[0-9]+)?$/.test(authority ?? '') &&
      endpoint.hostname.split('.').every(part => Number(part) <= 255);
    const literalV6 = /^\[::1\](?::[0-9]+)?$/.test(authority ?? '');
    if (!literalV4 && !literalV6) fail('insecure_endpoint');
  } else if (endpoint.protocol !== 'https:') fail('insecure_endpoint');
  let profile;
  try { profile = validateProfile(config.profile); }
  catch { fail('invalid_provider_profile'); }
  const suffix = profile.wireApi === 'responses' ? '/responses' : '/chat/completions';
  if (!endpoint.pathname.endsWith(suffix)) fail('endpoint_protocol_mismatch');
  return { ...structuredClone(config), endpoint: endpoint.href, profile };
}

function completedResponse(body) {
  if (!object(body) || body.object !== 'response' || body.status !== 'completed' ||
      !Array.isArray(body.output) || body.error != null || body.incomplete_details != null) fail('incomplete_response');
  const calls = new Set();
  let outputText = '';
  for (const item of body.output) {
    if (!object(item)) fail('invalid_response_output');
    if (item.type === 'message') {
      if (item.role !== 'assistant' || !Array.isArray(item.content) ||
          (item.status !== undefined && item.status !== 'completed')) fail('invalid_response_output');
      for (const part of item.content) {
        if (!object(part) || part.type !== 'output_text' || typeof part.text !== 'string') fail('unsupported_response_output');
        outputText += part.text;
      }
    } else if (item.type === 'function_call') {
      if (inspectHistory([item]).issues.length || calls.has(item.call_id) ||
          (item.namespace !== undefined && !nonempty(item.namespace)) ||
          (item.status !== undefined && item.status !== 'completed')) fail('invalid_response_tool_call');
      calls.add(item.call_id);
    } else if (item.type === 'reasoning') {
      // Reasoning stays opaque history. This is a bounded shape check, not reasoning-schema validation.
      if (!Array.isArray(item.summary)) fail('invalid_response_reasoning');
    } else fail('unsupported_response_output');
  }
  return { outputText, output: structuredClone(body.output) };
}

function responseObserver(queueText) {
  let result;
  let done = false;
  const textDeltas = new Map();
  const argumentDeltas = new Map();
  return {
    onEvent(event) {
      if (!object(event) || !nonempty(event.type)) fail('invalid_stream_event');
      if (['error', 'response.failed', 'response.incomplete'].includes(event.type) || event.error != null) fail('provider_stream_error');
      if (result || done) fail('unexpected_stream_event');
      if (event.type === 'response.output_text.delta') {
        if (typeof event.delta !== 'string' || !index(event.output_index) || !index(event.content_index)) fail('invalid_stream_delta');
        const key = `${event.output_index}:${event.content_index}`;
        textDeltas.set(key, (textDeltas.get(key) ?? '') + event.delta);
        if (event.delta) queueText(event.delta);
      } else if (event.type === 'response.function_call_arguments.delta') {
        if (typeof event.delta !== 'string' || !index(event.output_index)) fail('invalid_stream_delta');
        argumentDeltas.set(event.output_index, (argumentDeltas.get(event.output_index) ?? '') + event.delta);
      } else if (event.type === 'response.completed') {
        result = completedResponse(event.response);
        for (const [key, text] of textDeltas) {
          const [outputIndex, contentIndex] = key.split(':').map(Number);
          const part = result.output[outputIndex]?.content?.[contentIndex];
          if (part?.type !== 'output_text' || part.text !== text) fail('stream_output_mismatch');
        }
        for (const [outputIndex, argumentsText] of argumentDeltas) {
          const item = result.output[outputIndex];
          if (item?.type !== 'function_call' || item.arguments !== argumentsText) fail('stream_output_mismatch');
        }
        if (!textDeltas.size && result.outputText) queueText(result.outputText);
      }
    },
    onDone() {
      if (!result) fail('stream_incomplete');
      if (done) fail('unexpected_stream_event');
      done = true;
    },
    finish() {
      if (!result) fail('stream_incomplete');
      return result;
    },
  };
}

function chatObserver(plan, queueText) {
  let role;
  let content = '';
  let sawContent = false;
  let finishReason;
  let done = false;
  const calls = new Map();
  return {
    onEvent(event) {
      if (object(event) && event.error != null) fail('provider_stream_error');
      if (!object(event) || event.object !== 'chat.completion.chunk' || !Array.isArray(event.choices)) fail('invalid_stream_event');
      if (done) fail('unexpected_stream_event');
      // A final usage-only chunk is allowed after finish_reason and before [DONE].
      if (!event.choices.length) return;
      if (finishReason) fail('unexpected_stream_event');
      if (event.choices.length !== 1 || !object(event.choices[0]) || event.choices[0].index !== 0) fail('unsupported_stream_choices');
      const choice = event.choices[0];
      const delta = choice.delta;
      if (!object(delta) || Object.keys(delta).some(key => !['role', 'content', 'tool_calls', 'refusal'].includes(key)) ||
          delta.refusal != null) fail('unsupported_stream_delta');
      if (delta.role !== undefined) {
        if (delta.role !== 'assistant') fail('invalid_stream_delta');
        role = delta.role;
      }
      if (delta.content !== undefined && delta.content !== null) {
        if (typeof delta.content !== 'string') fail('invalid_stream_delta');
        sawContent = true;
        content += delta.content;
        if (delta.content) queueText(delta.content);
      }
      if (delta.tool_calls !== undefined) {
        if (!Array.isArray(delta.tool_calls)) fail('invalid_stream_tool_call');
        for (const fragment of delta.tool_calls) {
          if (!object(fragment) || !index(fragment.index) ||
              Object.keys(fragment).some(key => !['index', 'id', 'type', 'function'].includes(key))) fail('invalid_stream_tool_call');
          if (!calls.has(fragment.index)) {
            if (fragment.index !== calls.size) fail('invalid_stream_tool_call');
            calls.set(fragment.index, { id: '', type: '', function: { name: '', arguments: '' } });
          }
          const call = calls.get(fragment.index);
          if (fragment.id !== undefined) {
            if (!nonempty(fragment.id) || (call.id && call.id !== fragment.id)) fail('invalid_stream_tool_call');
            call.id = fragment.id;
          }
          if (fragment.type !== undefined) {
            if (fragment.type !== 'function') fail('invalid_stream_tool_call');
            call.type = fragment.type;
          }
          if (fragment.function !== undefined) {
            if (!object(fragment.function) || Object.keys(fragment.function).some(key => !['name', 'arguments'].includes(key))) fail('invalid_stream_tool_call');
            for (const key of ['name', 'arguments']) {
              if (fragment.function[key] !== undefined) {
                if (typeof fragment.function[key] !== 'string') fail('invalid_stream_tool_call');
                call.function[key] += fragment.function[key];
              }
            }
          }
        }
      }
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        if (!['stop', 'tool_calls'].includes(choice.finish_reason)) fail('stream_incomplete');
        finishReason = choice.finish_reason;
      }
    },
    onDone() {
      if (!finishReason) fail('stream_incomplete');
      if (done) fail('unexpected_stream_event');
      done = true;
    },
    finish() {
      if (!finishReason || !done) fail('stream_incomplete');
      const message = { role, content: sawContent ? content : null };
      if (calls.size) message.tool_calls = [...calls.values()];
      try { return restoreChatResponse({ object: 'chat.completion', choices: [{ index: 0, finish_reason: finishReason, message }] }, plan); }
      catch { fail('invalid_chat_response'); }
    },
  };
}

function abortError(signal) {
  if (signal.aborted) throw signal.reason;
}

// Await user callbacks with the same deadline as network consumption. Callback errors are never echoed.
function waitWithSignal(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export async function generate(request, rawConfig, { signal, onText } = {}) {
  const config = validateConnection(rawConfig);
  if (signal !== undefined && !(signal instanceof AbortSignal)) fail('invalid_abort_signal');
  if (onText !== undefined && typeof onText !== 'function') fail('invalid_text_callback');
  let prepared;
  try { prepared = prepareRequest(request, config.profile); }
  catch { fail('request_incompatible'); }
  let requestBody;
  try { requestBody = JSON.stringify(prepared.request); }
  catch { fail('request_incompatible'); }
  if (Buffer.byteLength(requestBody) > 8 * 1024 * 1024) fail('request_too_large');
  const headers = { 'content-type': 'application/json', accept: prepared.request.stream ? 'text/event-stream' : 'application/json' };
  if (config.apiKeyEnv !== null) {
    const credential = process.env[config.apiKeyEnv];
    const state = inspectCredentialValue(credential);
    if (!state.ready) fail(state.code);
    headers.authorization = `Bearer ${credential}`;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort(new TransportError('request_cancelled'));
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new TransportError('request_timeout')), config.timeoutMs);
  timer.unref();
  let response;
  let reader;
  let translator;
  let receivedBytes = 0;
  try {
    abortError(controller.signal);
    response = await fetch(config.endpoint, {
      method: 'POST', headers, body: requestBody,
      redirect: 'manual', credentials: 'omit', signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) fail('provider_redirect_rejected');
    if (response.status === 429) fail('provider_rate_limited');
    if ([401, 403].includes(response.status)) fail('provider_auth_failed');
    if (response.status >= 500) fail('provider_unavailable');
    if (!response.ok) fail('provider_http_error');
    const streaming = prepared.request.stream === true;
    const mediaType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (mediaType !== (streaming ? 'text/event-stream' : 'application/json')) fail('unexpected_content_type');
    if (!response.body) fail('missing_response_body');
    reader = response.body.getReader();
    const chunks = [];
    const pendingText = [];
    const utf8 = new TextDecoder('utf-8', { fatal: true });
    let observer;
    if (streaming) {
      observer = config.profile.wireApi === 'responses'
        ? responseObserver(text => pendingText.push(text))
        : chatObserver(prepared.plan, text => pendingText.push(text));
      translator = createEventTranslator(prepared.plan, { ...observer, maxEventBytes: Math.min(config.maxResponseBytes, 1024 * 1024) });
      // Discard rewritten wire bytes; observers supply canonical results. Drain to avoid backpressure.
      translator.on('error', () => {});
      translator.resume();
    }
    const emitText = async () => {
      while (pendingText.length) {
        abortError(controller.signal);
        const text = pendingText.shift();
        if (onText) {
          try { await waitWithSignal(onText(text), controller.signal); }
          catch { abortError(controller.signal); fail('text_callback_failed'); }
        }
      }
    };
    while (true) {
      abortError(controller.signal);
      const next = await reader.read();
      if (next.done) break;
      // Fetch decodes gzip/deflate/Brotli before exposing these bytes; Content-Length is not a limit.
      receivedBytes += next.value.byteLength;
      if (receivedBytes > config.maxResponseBytes) fail('response_too_large');
      if (streaming) {
        try { utf8.decode(next.value, { stream: true }); }
        catch { fail('invalid_stream_encoding'); }
        await new Promise((resolve, reject) => translator.write(next.value, error => error ? reject(error) : resolve()));
        await emitText();
      } else chunks.push(Buffer.from(next.value));
    }
    let result;
    if (streaming) {
      try { utf8.decode(); }
      catch { fail('invalid_stream_encoding'); }
      await new Promise((resolve, reject) => translator.end(error => error ? reject(error) : resolve()));
      await emitText();
      result = observer.finish();
    } else {
      let body;
      try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { fail('invalid_response_json'); }
      if (config.profile.wireApi === 'responses') result = completedResponse(restoreEvent({ type: 'response.completed', response: body }, prepared.plan).response);
      else {
        try { result = restoreChatResponse(body, prepared.plan); }
        catch { fail('invalid_chat_response'); }
      }
    }
    abortError(controller.signal);
    return { ...result, diagnostics: { ...prepared.diagnostics, wireApi: config.profile.wireApi, streamed: streaming, receivedBytes } };
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof TransportError) throw error;
    if (['invalid_sse_json', 'sse_event_too_large'].includes(error?.message)) fail(error.message);
    fail('transport_failed');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    translator?.destroy();
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    } else if (response?.body) await response.body.cancel().catch(() => {});
  }
}
