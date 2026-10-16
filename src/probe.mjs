import { generate, validateConnection } from './transport.mjs';

// Every case is synthetic and bounded. Nothing executes a model-requested tool.
export async function probeConnection(rawConfig, { network = false, tools = false, maxTokens = 128, signal } = {}) {
  if (network !== true) throw new Error('network_opt_in_required');
  if (typeof tools !== 'boolean') throw new Error('invalid_probe_options');
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 16 || maxTokens > 4096) throw new Error('invalid_probe_budget');
  const config = validateConnection(rawConfig);
  if (tools && !config.profile.functionTools) throw new Error('function_tools_not_supported');
  const cases = ['text_json', ...(config.profile.streaming ? ['text_stream'] : []), ...(tools ? ['named_tool_call', 'tool_result_replay'] : [])];
  const report = {
    schemaVersion: 1,
    protocol: config.profile.wireApi,
    startedAt: new Date().toISOString(),
    requestLimit: cases.length,
    maxOutputTokensPerRequest: maxTokens,
    results: cases.map(name => ({ name, status: 'not_run' })),
    scope: 'synthetic_live_protocol_probe',
    excluded: ['images', 'desktop_integration', 'compaction', 'model_quality', 'plugin_execution'],
  };
  let firstToolResult;
  const definitions = [{ type: 'namespace', name: 'compatibility', tools: [{
    type: 'function', name: 'echo', description: 'Return the supplied synthetic value.',
    parameters: { type: 'object', properties: { value: { type: 'string', enum: ['compatibility'] } }, required: ['value'], additionalProperties: false },
  }] }];
  const toolInput = [{ role: 'user', content: 'Call the echo function once with value compatibility. After its result, reply with only that value.' }];
  for (const entry of report.results) {
    try {
      let request = { input: 'Reply with only the word compatibility.', max_output_tokens: maxTokens, stream: entry.name === 'text_stream' };
      if (entry.name === 'named_tool_call') {
        request = { input: toolInput, tools: definitions, tool_choice: { type: 'function', namespace: 'compatibility', name: 'echo' }, max_output_tokens: maxTokens };
      }
      if (entry.name === 'tool_result_replay') {
        const call = firstToolResult.output.find(item => item.type === 'function_call');
        request = {
          input: [...toolInput, ...firstToolResult.output, { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ value: 'compatibility' }) }],
          tools: definitions, tool_choice: 'none', max_output_tokens: maxTokens,
        };
      }
      const result = await generate(request, config, { signal });
      const calls = result.output.filter(item => item.type === 'function_call');
      if (entry.name === 'named_tool_call') {
        if (calls.length !== 1 || calls[0].namespace !== 'compatibility' || calls[0].name !== 'echo') throw new Error('probe_tool_mismatch');
        const argumentsValue = JSON.parse(calls[0].arguments);
        if (Object.keys(argumentsValue).length !== 1 || argumentsValue.value !== 'compatibility') throw new Error('probe_tool_mismatch');
        firstToolResult = result;
      } else {
        if (calls.length) throw new Error('probe_tool_mismatch');
        if (result.outputText.trim().toLowerCase().replace(/[.!]$/, '') !== 'compatibility') throw new Error('probe_text_mismatch');
      }
      entry.status = 'passed';
    } catch (error) {
      entry.status = 'failed';
      // The CLI maps this private error to a fixed public code. Never serialize it.
      Object.defineProperty(report, 'failure', { value: error, enumerable: false });
      break;
    }
  }
  report.passed = report.results.every(entry => entry.status === 'passed');
  return report;
}
