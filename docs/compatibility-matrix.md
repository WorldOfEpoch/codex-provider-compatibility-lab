# Compatibility evidence

Release target: 0.3.0 preview, October 16, 2026. The authoritative automated result is the CI run for the exact commit under review. Passing a simulated server test is not a named provider certification.

| Area | Automated evidence shipped here | Still needs real-world evidence |
| --- | --- | --- |
| Setup and doctor | File creation, no overwrite, offline validation, missing credential checks | Usability with different terminals/provider installations |
| Responses JSON/SSE | Complete answers, split events, UTF-8, tools, semantic completion | Named provider/model/version results |
| Chat Completions JSON/SSE | Request conversion, fragmented tool arguments, finish reasons, replay | Vendor-specific extensions and model compliance |
| Failure handling | Refused connection, malformed JSON, truncated HTTP, invalid gzip, deadlines, cancellation, HTTP errors | Production network/proxy combinations |
| Limits | Outgoing request, incoming decoded bytes, event bounds | Provider-specific budgets and process-memory benchmarks |
| Tool identity | Namespace collision rejection and round trip | Actual connector schema acceptance and permission enforcement |
| Images | Capability rejection and encoded-byte accounting | Real image inference, file-ID forms, image quality |
| Host platform | Windows and Linux, Node 22/24 CI matrix | Other platforms/runtimes |

## Live results

**No live provider/model result is shipped as verified in 0.3.0.** Ollama, LM Studio, OpenAI, and other compatible services are candidates described by their API documentation. There are no downloaded model weights or credentials in the package.

The opt-in probe covers text JSON, text streaming when declared, an explicitly selected namespaced function when requested, and replay of its synthetic result. It stops on the first failure; subsequent cases remain `not_run`. A model ignoring the exact-word instruction can fail the text check even when its transport is valid. A pass does not test schema adherence in general, images, quality, compaction, tools executing, a Codex turn, or a plugin lifecycle.

## Submit a useful result

Open a provider-result issue with the following public facts:

1. Lab tag/commit, operating system, Node version, provider/server version, and public model identifier.
2. Protocol, declared capabilities, output allowance, and whether a local model was already loaded.
3. The reduced probe report and a synthetic reproduction for failures. Exclude private endpoints, tokens, prompts, user paths, and raw provider errors.
4. Separate text, streaming, function call, and replay outcomes. Name anything not tested.
5. Date and any independent reproduction. A report from one configuration should not claim support for an entire model family.

Maintainers can record reviewed results here in a later change with an issue link. Historical results must retain the tested version and date; they do not automatically carry forward to a new provider release.

## Evidence levels

`authored` means the implementation exists. `mock-tested` means synthetic unit/loopback cases passed. `live-probed` means an identified endpoint/model completed specific cases. `integrated` means a named application's real flow was exercised. `user-accepted` requires the intended user workflow. `published` means files or a release are public. Each is recorded independently.
