# Codex provider compatibility lab

Provider-neutral offline request adapters, regression examples, and lessons from a retired local provider-routing experiment involving Space Bunny Alpha. The method can be extended for other models through explicit capability profiles and reproducible tests.

This repository does not install a plugin, start a server, connect to a provider, change Codex settings, or require credentials. The original router is retired. This project is independent of OpenAI and OpenRouter.

The request adapter currently targets a defined subset of the Responses protocol. Other protocols and capabilities require additional implementation and validation; this is not a claim that every model already works. [Use and extend the adapter](docs/provider-adapters.md).

## Run the examples

Use Node.js 22 or later. There are no package dependencies and no installation step.

```sh
node --test
node bin/inspect.mjs fixtures/example-request.json
node scripts/audit-publication.mjs
```

The inspector reads one JSON request and prints counts, field names, and fixed diagnostic codes. It does not print prompts, tool arguments, results, model names, filenames, or credentials. Prefer synthetic inputs.

Exit codes: `0` means the implemented checks found no issues; `1` means a checked history shape or tool plan failed; `2` means usage, parsing, or reading failed. Passing is not proof that a provider will accept the request. Unknown history item types are counted as `otherItems`, not validated.

The CLI has an 8 MiB input limit. The library's separate image-accounting helper defaults to a historical 24 MiB budget for encoded image URIs; this is a local example policy, not a provider limit. The CLI cannot read a request large enough to exceed that default. See the [findings and limitations](docs/compatibility-findings.md) before reusing a helper.

## What you can learn

| Area | Reproducible check | Evidence boundary |
| --- | --- | --- |
| Provider profiles | Explicit model selection and capability checks | A declared contract, not live provider discovery or certification |
| Tool history | Missing call IDs, output shapes, JSON arguments | Partial shape checks, not history repair or a full API schema |
| Namespaces | Distinct wire names, collision rejection, round-trip restoration | Function tools only; hosted/custom tools fail explicitly |
| Streaming | UTF-8 split across chunks, line endings, multi-line events, incomplete events | JSON SSE transformation only; no HTTP, WebSocket, reconnect, or provider test |
| Images | Count inline encoded bytes without changing content | No decoding, resizing, remote download, or provider-limit certification |
| Publication | Explicit file manifest and common credential/path patterns | A narrow guard plus review, not a comprehensive secret detector |

The tests use invented conversations and tool names. No real sessions, credentials, provider profiles, model catalogs, private diagnostics, or third-party application source are included.

## Read and extend

- [Compatibility findings](docs/compatibility-findings.md) explains the failure modes and separates historical observations from current offline results.
- [Provenance](docs/provenance.md) explains how the public package was prepared.
- [Contributing](CONTRIBUTING.md) describes how to add a minimal regression case.
- [Security](SECURITY.md) describes the project's boundaries and safe reports.

CI runs the same offline commands on Windows and Linux with Node.js 22 and 24. Its result applies to these examples at the tested commit. No live Space Bunny, Codex desktop, connector, or model compatibility is certified.

Licensed under [MIT](LICENSE).
- [Provider adapters](docs/provider-adapters.md) includes the reusable interface, profile fields, and contribution roadmap.
