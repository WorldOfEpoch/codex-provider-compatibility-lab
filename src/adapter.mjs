import { inspectHistory, imageSummary, makeToolPlan, translateHistory, translateToolChoice } from './compatibility.mjs';
import { toChatRequest } from './chat-completions.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.length > 0;
const fail = code => { throw new Error(code); };
const requestFields = new Set([
  'model', 'input', 'instructions', 'tools', 'tool_choice', 'parallel_tool_calls',
  'stream', 'max_output_tokens', 'store', 'previous_response_id',
]);

export function validateProfile(profile) {
  if (!object(profile) || !nonempty(profile.id) || !nonempty(profile.model)) fail('invalid_provider_profile');
  if (!['responses', 'chat_completions'].includes(profile.wireApi)) fail('unsupported_wire_api');
  if (!['native', 'flatten'].includes(profile.namespaces) ||
      !['stateless', 'server'].includes(profile.conversationState) ||
      ['functionTools', 'streaming', 'images'].some(key => typeof profile[key] !== 'boolean') ||
      !Number.isSafeInteger(profile.maxInlineImageBytes) || profile.maxInlineImageBytes < 0) fail('invalid_provider_profile');
  const fields = ['id', 'model', 'wireApi', 'namespaces', 'conversationState', 'functionTools', 'streaming', 'images', 'maxInlineImageBytes', 'chatMaxTokensField'];
  if (Object.keys(profile).some(key => !fields.includes(key))) fail('unsupported_profile_field');
  if (profile.wireApi === 'chat_completions' &&
      (profile.namespaces !== 'flatten' || profile.conversationState !== 'stateless' ||
       !['max_tokens', 'max_completion_tokens', undefined].includes(profile.chatMaxTokensField))) fail('invalid_chat_profile');
  return structuredClone(profile);
}

function checkOptionalFields(request) {
  for (const key of ['stream', 'store', 'parallel_tool_calls']) {
    if (Object.hasOwn(request, key) && typeof request[key] !== 'boolean') fail('invalid_request_option');
  }
  if (Object.hasOwn(request, 'instructions') && typeof request.instructions !== 'string') fail('invalid_request_option');
  if (Object.hasOwn(request, 'max_output_tokens') &&
      (!Number.isSafeInteger(request.max_output_tokens) || request.max_output_tokens < 1)) fail('invalid_request_option');
  if (Object.hasOwn(request, 'previous_response_id') &&
      request.previous_response_id !== null && !nonempty(request.previous_response_id)) fail('invalid_request_option');
}

function hasImageParts(input) {
  return Array.isArray(input) && input.some(item =>
    object(item) && ['message', undefined].includes(item.type) && Array.isArray(item.content) &&
    item.content.some(part => object(part) && ['input_image', 'image_url'].includes(part.type)));
}

// Request preparation makes no network calls. Profiles declare expectations, not proven support.
export function prepareRequest(request, rawProfile) {
  const profile = validateProfile(rawProfile);
  if (!object(request)) fail('request_object_required');
  if (Object.keys(request).some(key => !requestFields.has(key))) fail('unsupported_request_field');
  checkOptionalFields(request);
  if (Object.hasOwn(request, 'model') && request.model !== profile.model) fail('model_profile_mismatch');
  const history = inspectHistory(request.input);
  if (history.issues.length) fail('invalid_history_shape');
  if (request.stream && !profile.streaming) fail('streaming_not_supported');
  if (profile.conversationState === 'stateless' && (request.store === true || request.previous_response_id != null)) fail('server_state_not_supported');
  if (!profile.images && hasImageParts(request.input)) fail('images_not_supported');
  const images = imageSummary(request.input, { budgetBytes: profile.maxInlineImageBytes });
  if (images.overBudget) fail('inline_image_budget_exceeded');

  const flattened = makeToolPlan(request.tools === undefined ? [] : request.tools);
  if (!profile.functionTools && (flattened.tools.length || request.tool_choice === 'required' || object(request.tool_choice))) fail('function_tools_not_supported');
  // Validate even native choices; unsupported forms must not pass through silently.
  const choice = translateToolChoice(request.tool_choice, flattened);
  if (request.tool_choice === 'required' && !flattened.tools.length) fail('required_tools_missing');
  const outboundHistory = translateHistory(request.input, flattened);
  const outbound = structuredClone(request);
  outbound.model = profile.model;
  if (profile.conversationState === 'stateless') outbound.store = false;
  if (profile.namespaces === 'flatten') {
    outbound.input = outboundHistory;
    if (request.tools !== undefined) outbound.tools = flattened.tools;
    if (request.tool_choice !== undefined) outbound.tool_choice = choice;
  }
  const plan = profile.namespaces === 'flatten'
    ? flattened
    : { tools: structuredClone(request.tools ?? []), mappings: [] };
  return {
    request: profile.wireApi === 'chat_completions' ? toChatRequest(outbound, profile) : outbound,
    plan,
    diagnostics: {
      checkedHistoryItems: history.checkedItems,
      otherHistoryItems: history.otherItems,
      functionCount: flattened.tools.length,
      mappedNames: plan.mappings.length,
      images,
      scope: 'offline_profile_checks',
    },
  };
}
