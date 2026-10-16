#!/usr/bin/env node
import { open, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { generate, validateConnection, transportErrorCodes, inspectCredentialValue } from '../src/transport.mjs';
import { prepareRequest } from '../src/adapter.mjs';
import { probeConnection } from '../src/probe.mjs';

const help = 'Commands:\n  init --protocol responses|chat_completions --endpoint URL --model ID --out FILE [--key-env NAME] [--tools] [--images]\n  init  (interactive setup)\n  doctor --config FILE  (offline; no requests)\n  run --config FILE --prompt TEXT|--input FILE [--stream] [--json] [--max-tokens 512]\n  probe --config FILE --network [--tools] [--max-tokens 128]\nRun/probe contact only the configured endpoint. No settings changes, tool execution, automatic retries, or background services.\n';
const known = new Set([
  'network_opt_in_required', 'invalid_probe_budget', 'invalid_probe_options', 'probe_tool_mismatch', 'probe_text_mismatch',
  'function_tools_not_supported', 'invalid_provider_profile', 'unsupported_wire_api', 'invalid_chat_profile',
  'unsupported_profile_field', 'unsupported_request_field', 'model_profile_mismatch', 'invalid_history_shape',
  'server_state_not_supported', 'images_not_supported', 'streaming_not_supported', 'inline_image_budget_exceeded',
  'unsupported_or_invalid_tool', 'unmapped_history_tool', 'unsupported_chat_history_item', 'unsupported_chat_history_field', 'unsupported_chat_content',
  'config_exists', 'invalid_cli_arguments', 'input_file_unreadable', 'input_file_too_large', 'invalid_input_json',
]);
function code(error) {
  if (known.has(error?.message)) return error.message;
  if (transportErrorCodes.includes(error?.message)) return error.message;
  return 'request_failed';
}
function args(values) {
  const options = {};
  const switches = new Set(['stream', 'json', 'network', 'tools', 'images']);
  for (let i = 0; i < values.length; i++) {
    const key = values[i].replace(/^--/, '');
    if (!values[i].startsWith('--') || Object.hasOwn(options, key)) throw new Error('invalid_cli_arguments');
    if (switches.has(key)) options[key] = true;
    else {
      if (!values[i + 1] || values[i + 1].startsWith('--')) throw new Error('invalid_cli_arguments');
      options[key] = values[++i];
    }
  }
  return options;
}
async function readJson(path, limit = 8 * 1024 * 1024) {
  if (!path) throw new Error('invalid_cli_arguments');
  let handle;
  try {
    handle = await open(path, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('input_file_too_large');
    const data = Buffer.alloc(limit + 1);
    let used = 0;
    while (used < data.length) {
      const { bytesRead } = await handle.read(data, used, data.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > limit) throw new Error('input_file_too_large');
    try { return JSON.parse(data.subarray(0, used).toString('utf8').replace(/^\uFEFF/, '')); }
    catch { throw new Error('invalid_input_json'); }
  } catch (error) {
    if (known.has(error.message)) throw error;
    throw new Error('input_file_unreadable');
  } finally { await handle?.close(); }
}
function only(options, allowed) {
  if (Object.keys(options).some(key => !allowed.includes(key))) throw new Error('invalid_cli_arguments');
}
async function init(options) {
  only(options, ['protocol', 'endpoint', 'model', 'out', 'key-env', 'tools', 'images']);
  if (!Object.keys(options).length) {
    if (!process.stdin.isTTY) throw new Error('invalid_cli_arguments');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      options.protocol = (await rl.question('Protocol [chat_completions / responses] (chat_completions): ')).trim() || 'chat_completions';
      const fallback = options.protocol === 'responses' ? 'http://127.0.0.1:11434/v1/responses' : 'http://127.0.0.1:11434/v1/chat/completions';
      options.endpoint = (await rl.question('Full endpoint URL (' + fallback + '): ')).trim() || fallback;
      options.model = (await rl.question('Exact model ID from your provider: ')).trim();
      options['key-env'] = (await rl.question('API key environment-variable name (blank for no key; never enter the key): ')).trim();
      options.tools = /^y(es)?$/i.test((await rl.question('Declare function-tool support? [y/N]: ')).trim());
      options.images = /^y(es)?$/i.test((await rl.question('Declare image support? [y/N]: ')).trim());
      options.out = (await rl.question('Save connection file (../compatibility-provider.local.json): ')).trim() || '../compatibility-provider.local.json';
    } finally { rl.close(); }
  }
  const config = validateConnection({
    schemaVersion: 1, endpoint: options.endpoint, apiKeyEnv: options['key-env'] || null,
    timeoutMs: 30000, maxResponseBytes: 8 * 1024 * 1024,
    profile: { id: 'my-provider', model: options.model, wireApi: options.protocol, namespaces: 'flatten',
      conversationState: 'stateless', functionTools: Boolean(options.tools), streaming: true, images: Boolean(options.images),
      maxInlineImageBytes: 2 * 1024 * 1024 },
  });
  if (!options.out) throw new Error('invalid_cli_arguments');
  try { await writeFile(options.out, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('config_exists'); throw new Error('input_file_unreadable'); }
  process.stdout.write('Connection file created. Run doctor with that file, then run or explicitly opt in to a probe. No request was sent.\n');
}

const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt);
try {
  const [command, ...values] = process.argv.slice(2);
  if (!command || ['help', '--help', '-h'].includes(command)) process.stdout.write(help);
  else {
    const options = args(values);
    if (command === 'init') await init(options);
    else {
      if (!['doctor', 'run', 'probe'].includes(command)) throw new Error('invalid_cli_arguments');
      only(options, command === 'doctor' ? ['config'] : command === 'probe' ? ['config', 'network', 'tools', 'max-tokens'] : ['config', 'prompt', 'input', 'stream', 'json', 'max-tokens']);
      const config = validateConnection(await readJson(options.config, 64 * 1024));
      if (command === 'doctor') {
        prepareRequest({ input: 'Offline doctor check.' }, config.profile);
        const credentialReady = config.apiKeyEnv === null || inspectCredentialValue(process.env[config.apiKeyEnv]).ready;
        process.stdout.write(JSON.stringify({ ok: credentialReady, networkUsed: false, protocol: config.profile.wireApi,
          credentialReady, capabilities: { tools: config.profile.functionTools, images: config.profile.images, streaming: config.profile.streaming },
          evidence: 'configuration_only' }, null, 2) + '\n');
        if (!credentialReady) process.exitCode = 1;
      } else if (command === 'probe') {
        const report = await probeConnection(config, { network: Boolean(options.network), tools: Boolean(options.tools),
          maxTokens: Number(options['max-tokens'] ?? 128), signal: controller.signal });
        if (report.failure) report.results.find(item => item.status === 'failed').code = code(report.failure);
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        if (!report.passed) process.exitCode = 1;
      } else {
        if (Boolean(options.input) === Boolean(options.prompt) || (options.stream && options.json)) throw new Error('invalid_cli_arguments');
        const request = options.input ? await readJson(options.input) : { input: options.prompt };
        if (Object.hasOwn(options, 'max-tokens')) request.max_output_tokens = Number(options['max-tokens']);
        else if (request && typeof request === 'object' && !Object.hasOwn(request, 'max_output_tokens')) request.max_output_tokens = 512;
        if (options.stream) request.stream = true;
        const streaming = request.stream === true && !options.json;
        const result = await generate(request, config, { signal: controller.signal, onText: streaming ? text => process.stdout.write(text) : undefined });
        if (options.json) process.stdout.write(JSON.stringify({ outputText: result.outputText, output: result.output }, null, 2) + '\n');
        else { if (!streaming) process.stdout.write(result.outputText); process.stdout.write('\n'); }
        if (!options.json && result.output.some(item => item.type === 'function_call')) process.stderr.write('The model returned tool calls. Use --json to inspect them; no tool was executed.\n');
      }
    }
  }
} catch (error) {
  process.stderr.write('Operation failed (' + code(error) + '). Check the connection and compatibility guide. Any streamed text may be incomplete.\n');
  process.exitCode = 2;
} finally { process.removeListener('SIGINT', interrupt); }
