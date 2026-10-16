# Client and adapter contract

The model is data in an explicit profile. Each request owns its tool-name mapping; concurrent requests do not share a mutable global mapping. The client contacts one configured endpoint without fallback, retries, redirects, or tool execution.

## Library entry points

```js
import { prepareRequest } from './src/adapter.mjs';
import { generate, validateConnection } from './src/transport.mjs';
import { probeConnection } from './src/probe.mjs';

// config and request are supplied by your application.
const checked = validateConnection(config); // offline
const prepared = prepareRequest(request, checked.profile); // offline
console.log(prepared.diagnostics); // counts and fixed fields only

// Explicit network operation. The optional signal cancels this request.
const result = await generate(request, checked, { signal, onText: text => process.stdout.write(text) });
// result.outputText and result.output contain the actual model response.
```

This is illustrative library code: `config`, `request`, and `signal` are application inputs, not globals supplied by the lab. `prepared.request`, tool arguments, and model output contain original content and must not be logged as redacted diagnostics. The `onText` callback runs during streaming and may return a promise, which shares the request deadline. Keep synchronous work brief; callback errors fail the operation. No rollback of already displayed text is possible.

`probeConnection(config, { network: true, tools: true, maxTokens: 128, signal })` runs the synthetic cases. Its enumerable report excludes payloads and credentials. The non-enumerable `failure` property is an internal Error; applications should map it to a fixed code rather than serialize arbitrary error objects.

## Connection and profile

`schemaVersion: 1`, `endpoint`, `apiKeyEnv` (name or null), `profile`, `timeoutMs`, and `maxResponseBytes` are the connection fields. Unknown fields fail. The endpoint must be HTTPS, or HTTP on a literal loopback address, and end in the matching operation path. The only credential read is the explicitly named environment variable. It becomes a bearer header for that endpoint.

| Profile field | Meaning |
| --- | --- |
| `id`, `model` | Required explicit labels; a different model in a request is rejected |
| `wireApi` | `responses` or `chat_completions` |
| `namespaces` | `flatten` maps function identities; Responses can also declare `native` |
| `conversationState` | `stateless` rejects stored state and sets `store: false`; Responses can declare `server` |
| `functionTools`, `streaming`, `images` | Boolean expectations checked before sending |
| `maxInlineImageBytes` | Budget for encoded inline image URIs; not a provider limit |
| `chatMaxTokensField` | Chat only: `max_tokens` (default) or `max_completion_tokens` |

Chat Completions requires `flatten` and `stateless`. Setup chooses these for both protocols. Native namespaces and server-managed Responses state require separate endpoint evidence; the default probe is designed around stateless replay. Profiles declare expectations, not discovered capabilities.

## Request and response subset

The common input accepts `model`, `input`, `instructions`, `tools`, `tool_choice`, `parallel_tool_calls`, `stream`, `max_output_tokens`, `store`, and `previous_response_id`. Unknown top-level request options fail. Reasoning controls, structured output formats, hosted search, custom tools, compaction, audio, and WebSockets are not implemented.

Function definitions, one namespace level, control choices `auto`/`none`/`required`, and explicit function choice are supported. Namespace tuples receive reversible wire names. Opaque arguments and tool results are not recursively rewritten. Missing IDs and malformed checked history fail; IDs are never invented to repair a conversation.

Chat conversion supports text instructions/messages, recognized image URL parts, function calls, and string function results. Consecutive function calls are grouped into an assistant tool-call message. Calls must have unique IDs and matched results before another message. Ambiguous, unfinished, duplicate, or unsupported history fails. File-ID images and reasoning history are unsupported in this conversion.

Responses history checks remain partial, not a complete schema validator. Images receive accounting checks, without download, decoding, resizing, or pixel validation. The selected provider must validate its own schemas; the calling application must validate tool arguments against its allowed schema before execution.

Completed outputs are normalized to `outputText` plus an `output` array of messages/function calls (and supported opaque Responses reasoning items). Chat expects a single assistant choice and `stop` or `tool_calls` completion. Refusals, length-limited output, unsupported vendor message fields, and incomplete/failed responses do not become successful answers.

## Network and streaming boundaries

The serialized request limit is 8 MiB. Responses have a configurable decoded-byte limit, default 8 MiB and maximum 64 MiB. Events have a separate limit of at most 1 MiB. These checks bound accepted content; the network/runtime can allocate a chunk before the client checks it. They are not a hard process-memory quota.

One deadline covers fetch and body consumption. Ctrl+C or an AbortSignal cancels it. HTTP errors map to fixed codes without reading/printing error bodies. JSON/SSE content types and UTF-8 are checked. Broken compression, premature EOF, mismatched streamed/final content, and invalid JSON fail. Local tests exercise real loopback HTTP framing as well as byte-level parser boundaries.

Responses streams require semantic successful completion; Chat streams require a valid finish reason and `[DONE]`. An incomplete final SSE event is discarded by the parser and cannot satisfy completion. Text from a completion-only Responses stream is emitted once. `[DONE]` alone is not proof of a successful Responses answer. See [OpenAI streaming semantics](https://developers.openai.com/api/docs/guides/streaming-responses) and [Chat stream fields](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events).

## Extend the existing owner

| Change | Owner |
| --- | --- |
| Shared validation, names, history, accounting | `src/compatibility.mjs`, `src/adapter.mjs` |
| Chat request/complete-response mapping | `src/chat-completions.mjs` |
| SSE byte/event parser | `src/sse.mjs` |
| HTTP limits and protocol stream completion | `src/transport.mjs` |
| Synthetic live capability cases | `src/probe.mjs` |
| Foreground setup and commands | `bin/lab.mjs` |

Add a failing synthetic case before extending a capability. Use [CONTRIBUTING](../CONTRIBUTING.md) and preserve the distinction between mock coverage, a live provider result, and actual desktop/plugin acceptance. Improving this code never requires reactivating Space Bunny.
