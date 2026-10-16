# Setup and first request

This guide uses Windows PowerShell; the Node commands also work in other shells. Install Node.js 22 or later from [Node.js](https://nodejs.org/en/download), then extract a release source archive or clone this repository. Open a terminal in the extracted folder. No `npm install` is needed.

## 1. Choose an endpoint and model

Use an account or local model server you control. The endpoint must be a **complete operation URL**, not just its base URL. The model ID must exactly match one offered by that provider.

| Server | Example operation URL | Evidence |
| --- | --- | --- |
| Ollama on this PC | `http://127.0.0.1:11434/v1/chat/completions` | Documented API shape; not live-certified here |
| LM Studio on this PC | `http://127.0.0.1:1234/v1/chat/completions` | Documented API shape; not live-certified here |
| OpenAI API | `https://api.openai.com/v1/responses` | Documented API shape; not live-certified here |
| Another compatible server | Its full HTTPS `/responses` or `/chat/completions` operation URL | Must be tested for the selected model |

Start and load your local model using that server's normal controls before running a network command. This lab does not install, download, load, or start models. Local HTTP is allowed only with a literal loopback address, such as `127.0.0.1`; use HTTPS for remote servers. URLs containing credentials, query strings, or fragments are rejected.

API resemblance is not full feature compatibility. Consult [Ollama's OpenAI compatibility documentation](https://docs.ollama.com/api/openai-compatibility), [LM Studio's compatible endpoints](https://lmstudio.ai/docs/developer/openai-compat), and [OpenAI's Responses API](https://developers.openai.com/api/docs/guides/text) for your server's supported operations. Tool and image support also depend on the selected model.

## 2. Create a connection file

```powershell
node bin/lab.mjs init
```

The wizard asks for protocol, endpoint, model, credential-variable name, tool/image capabilities, and destination. Answer with `chat_completions` or `responses`. Leave tools and images off until you intend to test them. Streaming starts enabled; set `profile.streaming` to `false` in your connection file if the endpoint cannot stream. Existing files are never overwritten.

For a scriptable setup, replace `YOUR_MODEL_ID` before running:

```powershell
node bin/lab.mjs init --protocol chat_completions --endpoint http://127.0.0.1:11434/v1/chat/completions --model YOUR_MODEL_ID --out ../compatibility-provider.local.json
```

Add `--tools` or `--images` to declare those expectations. Add `--key-env LAB_PROVIDER_API_KEY` when the server needs a bearer key. The name goes in the file; the credential does not. Use the provider's normal private sign-in/key process and set that variable in the terminal used to run the client. Never reuse Codex desktop credentials or paste a key into a public issue, command example, or connection file. An unset or invalid credential fails before networking. Local no-key servers can leave the variable name blank.

Optional connection settings are `timeoutMs` (default 30000, maximum 300000) and `maxResponseBytes` (default 8 MiB, maximum 64 MiB). A local model's first answer can take longer than 30 seconds; change its explicit deadline if appropriate. Requests remain capped at 8 MiB regardless of response settings. Configuration files are limited to 64 KiB.

For Chat Completions models requiring `max_completion_tokens`, add `"chatMaxTokensField": "max_completion_tokens"` inside `profile`. The default is `max_tokens`. Do not guess which one a server accepts.

## 3. Check setup without spending tokens

```powershell
node bin/lab.mjs doctor --config ../compatibility-provider.local.json
```

`ok: true` means the connection shape and any named credential's basic shape pass offline checks. It does not contact a server, validate the key with a provider, load a model, or certify capabilities. It prints no endpoint, model ID, or credential.

## 4. Run a prompt

```powershell
node bin/lab.mjs run --config ../compatibility-provider.local.json --prompt "Say hello briefly." --stream
```

Omit `--stream` for a complete answer. Use `--max-tokens 256` to change the output allowance. Press Ctrl+C to cancel. A stream may have printed partial text before a failure; only a successful exit establishes protocol completion.

`--input request.json` accepts the lab's Responses-style request shape for either wire protocol; it does not accept a raw Chat Completions request. The default output allowance is 512 tokens unless the input or command specifies one. `--json` prints canonical output, including function calls, for another program to inspect. That output and ordinary answers are **content**, not redacted diagnostics. The lab never executes a returned function. Your application owns permissions, argument validation, execution, and replay.

## 5. Test expected capabilities

```powershell
node bin/lab.mjs probe --config ../compatibility-provider.local.json --network --tools
```

For text-only use, omit `--tools`. Without `--network`, the command fails before sending anything. Each case makes one request, sequentially, stopping at the first failure. The token allowance is a request parameter, not a guaranteed money limit enforced against a provider. The synthetic echo result is constructed locally; no external tool is called.

The report omits endpoint, model ID, credential, prompts, and response bodies. Before sharing, identify the public provider/model version and environment separately so another person can reproduce your result. A successful run only covers the cases in that report. See the [evidence matrix](compatibility-matrix.md).

## Troubleshooting and removal

| Code or symptom | Next check |
| --- | --- |
| `provider_auth_failed` | Selected environment variable and provider account access |
| `provider_rate_limited` | Provider quota; the lab does not retry |
| `request_timeout` | Server/model readiness and configured deadline |
| `transport_failed` | Server availability, TLS, connection, or broken response framing; raw details are intentionally hidden |
| `request_incompatible` | Profile and request subset in the adapter guide |
| `probe_text_mismatch` | Model did not follow the synthetic instruction; this alone does not prove a protocol defect |
| Stream failure | Missing completion, truncated stream, unsupported event shape, or output budget exhaustion |
| Publication audit rejects a local file | Keep private configs and reports outside the repository |

Exit codes: `0` successful command; `1` failed doctor/probe result; `2` usage, configuration, or execution failure. Use `node bin/lab.mjs help` for commands.

To remove the lab, close the foreground command and delete its extracted folder and any connection files you created. No service or startup item is installed. Remove a credential variable if you created it solely for this test; do not remove one shared by another application. Local model servers remain managed by their own applications.
