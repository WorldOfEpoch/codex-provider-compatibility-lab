# Compatibility findings

Review date: October 16, 2026.

The original experiment inserted a local HTTP relay between Codex and model providers. One model alias selected Space Bunny Alpha through OpenRouter; other requests used the normal upstream. This public lab extracts selected lessons from that retired experiment. It does not reproduce the operational router.

## What the evidence supports

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Review of the owner's legacy routing code and configuration | How that particular adapter selected providers, transformed tools, and managed its lifecycle | A defect in every provider or current Codex release |
| Local cleanup investigation | A global relay dependency and repeated helper processes existed; connection-refused errors also appeared in historical logs | That Space Bunny caused every reconnect or background process |
| Synthetic tests in this repository | The checked transformations and failure cases behave as asserted | Live authentication, a successful desktop turn, complete connector compatibility, or model quality |
| Official protocol documentation | The documented shapes and semantics cited below | That any particular deployed model implements every feature |

Private logs are deliberately absent. Historical observations are an owner case study; the public tests reproduce isolated protocol cases, not the whole private incident.

## 1. Keep provider selection and process lifetime explicit

A global base-URL override made ordinary requests depend on the local relay even when they were not selecting the experimental provider. If that relay was unavailable, the selected model alone did not explain the resulting connection failure. Repeated helper processes and connector retries were separate findings; the investigation did not establish that they shared one cause.

The old alias also obscured which provider a model name selected. A future experiment should use an explicitly named provider and an isolated scope, with a clear removal path and ownership of the process lifetime. Removing startup configuration and stopping a process are different operations: already-running clients can retain an old URL until restarted.

Codex documents named custom providers and a separate `openai_base_url` override for the built-in provider. Configuration choices must be checked against the actual client being tested. This repository ships no Codex settings or live provider connection configuration. Its [offline adapter profiles](provider-adapters.md) describe expected capabilities without endpoints or credentials. [OpenAI advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced)

## 2. Validate history according to the item type

A function result does not need the function's `name`. It needs its `call_id` and `output`. Requiring a name on every tool-related item creates false positives. An empty output string is also different from a missing output field.

The inspector checks four item types:

| Item | Fields checked |
| --- | --- |
| `function_call` | `call_id`, `name`, `arguments` |
| `function_call_output` | `call_id`, `output` |
| `custom_tool_call` | `call_id`, `name`, `input` |
| `custom_tool_call_output` | `call_id`, `output` |

Function arguments must parse as a JSON object in this lab. Output arrays receive only a container check. The inspector does not validate every message, enforce provider-specific schemas, match all calls with results, repair history, or invent missing IDs. OpenAI's examples link function results through `call_id` and distinguish custom-tool text input from function JSON arguments. [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)

## 3. Tool names need a reversible mapping

Two namespaces can both contain a tool named `lookup`. Flattening both to the same name loses their identity. This lab hashes an unambiguous namespace/name tuple into a stable wire name and retains an in-memory reverse mapping. Duplicate or colliding names fail. The hash is an identifier, not encryption.

The same mapping is used for tool definitions, top-level function-call history, explicit function choices, and selected incoming response envelopes. Call IDs, arguments, and results are preserved. Opaque nested tool results must never be recursively rewritten just because they contain a field named `type` or `name`.

Only function tools and one level of namespaces are supported here. The helper preserves function fields but is not a schema converter; it does not preserve namespace-level descriptions or prove that a provider accepts a given schema. Mappings are local to a plan, not a durable registry. History from another tool set may need a separate explicit compatibility policy.

## 4. Unsupported capabilities must remain visible

The legacy adapter omitted native hosted-search definitions on the experimental route and had a compaction path that could select another provider. Those choices can change the meaning or destination of a request. Successful text generation does not establish support for search, compaction, custom tools, images, or every connector.

This lab rejects unsupported tool definitions and tool-choice forms instead of dropping them. It implements no provider fallback or compaction. A real integration needs a separately verified capability contract and an explicit policy for every unsupported operation.

The current OpenRouter Responses documentation describes a stateless interface requiring history in each request; it rejects `store: true` and non-null `previous_response_id`. That is one concrete reason an API with familiar field names still needs feature-by-feature evaluation. This statement comes from documentation, not a live test of this lab. [OpenRouter Responses overview](https://openrouter.ai/docs/api_reference/responses/overview)

## 5. Stream chunks are not protocol events

A JSON event may span several reads, and one read may contain many events. UTF-8 characters can split between bytes. The SSE example assembles complete events, handles LF/CRLF/CR endings and an initial byte-order mark, and joins multiple `data` lines before parsing.

It restores function identities in `response.output_item.added`, `response.output_item.done`, and terminal response output arrays. Other envelopes and argument deltas are preserved. Comments, event IDs, retry fields, and event names pass through without being interpreted as a reconnect policy. `[DONE]` is a recognized provider convention.

The example accepts JSON-bearing SSE events plus that sentinel; it is not a general browser EventSource implementation. Malformed JSON fails with a fixed code. An incomplete last event is discarded, matching the standard's blank-line dispatch boundary. [WHATWG server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation)

The default 1 MiB limit counts decoded UTF-8 event text with normalized line separators. It is not a raw HTTP byte limit or a bound on the memory allocated by an upstream reader. This code does not implement transport timeouts, reconnection, backoff, WebSockets, HTTP headers, decompression limits, or cancellation across a network. These would need their own tests.

The old relay relied on an HTTP/SSE fallback after declining WebSocket upgrades. That behavior must not be assumed for arbitrary clients. This lab does not test the fallback.

## 6. Image budgets must name what they measure

The legacy router used a 24 MiB budget for inline image transport data. This repository retains that number only as a configurable example in `imageSummary`. It counts encoded data-URI bytes in known message-image fields, not decoded pixel data or the total request size. Remote images are counted without being fetched. Tool outputs remain opaque.

The lab does not resize or replace images. A future transport must distinguish attachment originals from transport copies, preserve alpha when required, and establish actual limits for the selected endpoint. Passing this accounting check proves none of those properties.

## 7. Diagnose without copying private payloads

Parser errors and upstream response bodies can contain prompt fragments or credentials. The CLI reports fixed errors rather than echoing exception text or filenames. Its summary exposes counts and fixed field names, not request content. It reads at most 8 MiB and never writes the input.

The publication audit allows only reviewed files and checks several common secret and personal-path patterns. It cannot identify every secret or private fact. Human review, synthetic fixtures, an explicit manifest, and a fresh Git history are separate safeguards.

## Results and remaining work

Run `node --test` to see the current executable cases. CI exercises Node.js 22 and 24 on Windows and Linux; the run linked to a commit is the validation record. The initial local run used Windows and Node.js 25.6.1.

No live requests to Space Bunny were made to prepare this package. No model pricing, availability, latency, or present-day provider compatibility is claimed. No plugin-directory submission or upstream bug acceptance is implied by publishing this repository.

The most useful future contribution is one failing synthetic case with its expected behavior, relevant protocol reference, and explicit evidence boundary. A live test would be a separate activity requiring an isolated environment, an explicit provider/model, a bounded budget, and independent authorization.

The public adapter now provides a reusable entry point for applying these lessons to another explicitly selected model. Profiles and tests can be improved independently of the retired integration; see the [current scope and roadmap](provider-adapters.md).
