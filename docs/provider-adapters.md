# Adapting the method to other models

The reusable part is the compatibility method and adapter code. A model name is data in an explicit profile, not a built-in alias. Contributors can use the same tests to fix a translation defect or add a capability for another provider.

This is a starting point for Responses-style integrations. It does not establish that every model works. Models using another protocol need a separately implemented and tested protocol adapter.

## Use the offline adapter

Run this example from the repository root using Node.js 22 or later. It reads the synthetic examples and makes no network request:

```js
import { readFile } from 'node:fs/promises';
import { prepareRequest } from './src/adapter.mjs';
import { createEventTranslator } from './src/sse.mjs';

const profile = JSON.parse(await readFile('fixtures/example-profile.json', 'utf8'));
const input = JSON.parse(await readFile('fixtures/example-request.json', 'utf8'));
const prepared = prepareRequest(input, profile);

// Counts and fixed codes only. Do not log prepared.request with private inputs.
console.log(prepared.diagnostics);

// A downstream transport can use prepared.request and pipe JSON SSE bytes
// through this transform. Creating it neither connects nor starts a process.
const responseTransform = createEventTranslator(prepared.plan);
responseTransform.destroy();
```

`prepared.request` is the transformed request, including its original content. It is not redacted and must not be treated as a safe log. `prepared.plan` carries the matching tool-name mapping for response restoration. Keep a plan with the request that created it; never share one mutable global plan across concurrent requests.

For a complete, non-streaming response, restore its output identities with:

```js
import { restoreEvent } from './src/compatibility.mjs';
const restored = restoreEvent(
  { type: 'response.completed', response: syntheticResponse },
  prepared.plan
).response;
```

Here `syntheticResponse` represents a response supplied by your own test or transport; the lab does not fetch one.

## Profile contract

| Field | Meaning |
| --- | --- |
| `id` | A descriptive profile label; diagnostics do not print it |
| `model` | Explicit target model; a different model already present in the input is rejected |
| `wireApi` | Currently only `responses` is implemented |
| `namespaces` | `flatten` maps namespace/tool tuples; `native` retains them |
| `conversationState` | `stateless` rejects stored conversations and sets `store: false`; `server` preserves the supplied state options |
| `functionTools` | Whether function-tool definitions and choices may be requested |
| `streaming` | Whether `stream: true` may be requested |
| `images` | Whether recognized message-image parts may be requested |
| `maxInlineImageBytes` | Local budget for encoded inline image URIs; not an inferred provider limit |

A profile is a declared expectation. It is not a provider discovery result or proof of compatibility. The supplied profile is entirely fictional. It contains no endpoint or credential.

## Implemented request scope

The adapter accepts `model`, `input`, `instructions`, `tools`, `tool_choice`, `parallel_tool_calls`, `stream`, `max_output_tokens`, `store`, and `previous_response_id`. Unknown request fields fail with `unsupported_request_field`. New capabilities must have explicit behavior and tests before they are accepted.

Only function tools, one namespace level, the control choices `auto`/`none`/`required`, and an explicit function choice are supported. Missing required tools, unsupported hosted/custom definitions, unresolved namespaced history, and malformed checked history items fail.

The adapter applies partial history checks, not full message or schema validation. Unknown history item types and provider-specific function parameters still need review. Native namespace mode preserves namespace metadata; flattening does not. Image accounting excludes remote image bytes, file-ID content, and opaque tool outputs. Those limitations apply even when a profile declares image support.

## How others can improve it

| Area | Current state | Useful next contribution |
| --- | --- | --- |
| Provider selection | Explicit target model, no global settings changes | Synthetic profile plus evidence for a particular endpoint's capabilities |
| Tools and history | Shared mapping and fail-on-unsupported behavior | Regression cases for additional schemas, choices, or history rules |
| Streaming | Offline JSON SSE transform | Additional event envelopes with chunk-boundary tests |
| Reasoning and output formats | Rejected as unsupported request fields | A documented capability contract and round-trip tests |
| Other protocols | Rejected | A distinct protocol module with mappings for requests, responses, tools, errors, and streams |
| Live transport | Absent | Separately reviewed authentication, timeouts, cancellation, backoff, response-size limits, and provider-isolation tests |
| Desktop or plugin packaging | Absent | An explicit integration design that does not override unrelated chats or create restart loops |

Use the [contribution workflow](../CONTRIBUTING.md) to add a minimal failing case, fix its existing owner, and document the evidence. Claims of live support should name the client, protocol, provider/model, tested capabilities, date, and limitations. A passing synthetic profile alone must not be labeled live support.

The retired Space Bunny integration remains retired. Improving this provider-neutral method does not require reactivating it.
