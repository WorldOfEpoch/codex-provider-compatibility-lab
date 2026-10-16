import { createHash } from 'node:crypto';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.length > 0;
const fail = code => { throw new Error(code); };

// These are deliberately partial shape checks, not a complete API schema.
const required = {
  function_call: ['call_id', 'name', 'arguments'],
  function_call_output: ['call_id', 'output'],
  custom_tool_call: ['call_id', 'name', 'input'],
  custom_tool_call_output: ['call_id', 'output'],
};

export function inspectHistory(input) {
  if (typeof input === 'string') return { kind: 'text', checkedItems: 0, otherItems: 0, issues: [] };
  if (!Array.isArray(input)) return { kind: 'invalid', checkedItems: 0, otherItems: 0, issues: [{ code: 'input_shape' }] };
  const result = { kind: 'items', checkedItems: 0, otherItems: 0, issues: [] };
  input.forEach((item, index) => {
    if (!object(item)) { result.issues.push({ index, code: 'item_shape' }); return; }
    const fields = Object.hasOwn(required, item.type) ? required[item.type] : null;
    if (!fields) { result.otherItems++; return; }
    result.checkedItems++;
    for (const field of fields) {
      if (!Object.hasOwn(item, field) || item[field] === null) {
        result.issues.push({ index, field, code: 'missing_field' });
      } else if (field === 'output') {
        if (typeof item[field] !== 'string' && !Array.isArray(item[field])) result.issues.push({ index, field, code: 'output_shape' });
      } else if (typeof item[field] !== 'string' || (['name', 'call_id'].includes(field) && !text(item[field]))) {
        result.issues.push({ index, field, code: 'string_required' });
      }
    }
    if (item.type === 'function_call' && typeof item.arguments === 'string') {
      try {
        if (!object(JSON.parse(item.arguments))) result.issues.push({ index, field: 'arguments', code: 'arguments_object_required' });
      } catch { result.issues.push({ index, field: 'arguments', code: 'invalid_arguments_json' }); }
    }
  });
  return result;
}

export function wireName(namespace, name) {
  if (!text(namespace) || !text(name)) fail('invalid_tool_identity');
  // JSON tuple framing is unambiguous even if a name contains a NUL character.
  return 'compat_' + createHash('sha256').update(JSON.stringify([namespace, name])).digest('hex').slice(0, 24);
}

export function makeToolPlan(tools) {
  if (!Array.isArray(tools)) fail('tools_array_required');
  const flat = [];
  const mappings = [];
  const used = new Set();
  function add(tool, namespace) {
    if (!object(tool) || tool.type !== 'function' || !text(tool.name)) fail('unsupported_or_invalid_tool');
    const name = namespace === undefined ? tool.name : wireName(namespace, tool.name);
    if (used.has(name)) fail('duplicate_or_colliding_tool_name');
    used.add(name);
    flat.push({ ...structuredClone(tool), name });
    if (namespace !== undefined) mappings.push({ wireName: name, namespace, name: tool.name });
  }
  for (const tool of tools) {
    if (!object(tool)) fail('unsupported_or_invalid_tool');
    if (tool.type === 'namespace') {
      if (!text(tool.name) || !Array.isArray(tool.tools)) fail('invalid_namespace');
      for (const child of tool.tools) add(child, tool.name);
    } else add(tool);
  }
  return { tools: flat, mappings };
}

function mapCall(item, plan, outbound) {
  const out = structuredClone(item);
  if (!object(out) || out.type !== 'function_call') return out;
  if (outbound && Object.hasOwn(out, 'namespace')) {
    const binding = plan.mappings.find(entry => entry.namespace === out.namespace && entry.name === out.name);
    if (!binding) fail('unmapped_history_tool');
    out.name = binding.wireName;
    delete out.namespace;
  } else if (!outbound) {
    const binding = plan.mappings.find(entry => entry.wireName === out.name);
    if (binding) { out.name = binding.name; out.namespace = binding.namespace; }
  }
  return out;
}

export function translateHistory(input, plan, { outbound = true } = {}) {
  if (typeof input === 'string') return input;
  if (!Array.isArray(input)) fail('input_array_or_text_required');
  // Only protocol items are translated. User text, arguments and tool outputs remain opaque.
  return input.map(item => mapCall(item, plan, outbound));
}

export function translateToolChoice(choice, plan) {
  if (choice === undefined || ['auto', 'none', 'required'].includes(choice)) return choice;
  if (!object(choice) || choice.type !== 'function' || !text(choice.name)) fail('unsupported_tool_choice');
  const out = structuredClone(choice);
  if (Object.hasOwn(out, 'namespace')) {
    const binding = plan.mappings.find(entry => entry.namespace === out.namespace && entry.name === out.name);
    if (!binding) fail('unmapped_tool_choice');
    out.name = binding.wireName;
    delete out.namespace;
  }
  if (!plan.tools.some(tool => tool.name === out.name)) fail('unmapped_tool_choice');
  return out;
}

export function restoreEvent(event, plan) {
  const out = structuredClone(event);
  if (!object(out)) return out;
  if (['response.output_item.added', 'response.output_item.done'].includes(out.type) && object(out.item)) {
    out.item = mapCall(out.item, plan, false);
  }
  if (['response.completed', 'response.incomplete', 'response.failed'].includes(out.type) && Array.isArray(out.response?.output)) {
    out.response.output = out.response.output.map(item => mapCall(item, plan, false));
  }
  return out;
}

export function imageSummary(input, { budgetBytes = 24 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 0) fail('invalid_image_budget');
  const result = { inlineImages: 0, remoteImages: 0, encodedUriBytes: 0, budgetBytes, overBudget: false };
  if (!Array.isArray(input)) return result;
  for (const item of input) {
    if (!object(item) || !['message', undefined].includes(item.type) || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!object(part) || !['input_image', 'image_url'].includes(part.type)) continue;
      const uri = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
      if (typeof uri !== 'string') continue;
      if (/^data:image\/[^;,]+;base64,/i.test(uri)) {
        result.inlineImages++;
        result.encodedUriBytes += Buffer.byteLength(uri);
      } else if (/^https?:\/\//i.test(uri)) result.remoteImages++;
    }
  }
  result.overBudget = result.encodedUriBytes > budgetBytes;
  return result;
}

export function inspectRequest(request) {
  if (!object(request)) fail('request_object_required');
  const toolTypes = { functions: 0, namespaces: 0, unsupported: 0 };
  if (request.tools !== undefined && !Array.isArray(request.tools)) fail('tools_array_required');
  for (const tool of request.tools ?? []) {
    if (tool?.type === 'function') toolTypes.functions++;
    else if (tool?.type === 'namespace') toolTypes.namespaces++;
    else toolTypes.unsupported++;
  }
  let toolPlan;
  try { const plan = makeToolPlan(request.tools ?? []); toolPlan = { supported: true, flattenedCount: plan.tools.length }; }
  catch { toolPlan = { supported: false }; }
  return {
    history: inspectHistory(request.input),
    toolTypes,
    toolPlan,
    images: imageSummary(request.input),
    scope: 'partial_offline_shape_checks',
  };
}
