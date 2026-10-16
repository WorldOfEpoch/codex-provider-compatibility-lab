# Security

The model client performs network requests only when `run` or an explicitly opted-in `probe` is invoked. It contacts the selected operation URL using only the named credential environment variable. It does not read a Codex profile or key store, listen on a port, execute model tools, follow redirects, retry, or install background/startup components.

Use a provider and endpoint you trust. An explicitly supplied endpoint receives your prompt and configured bearer credential. HTTPS is required except on literal loopback addresses. TLS uses Node's ordinary validation; changing the runtime trust/proxy environment changes that boundary.

Deadlines and byte limits protect accepted request/response sizes. They are not a process sandbox or a strict allocation quota. Functions returning transformed requests or outputs preserve their content; only designated diagnostics/probe reports reduce it. Ordinary `run` output, including `--json`, is not redacted.

The helpers apply a defined subset of protocol and history checks. They do not provide complete JSON Schema validation, authorization, content sanitization, tool execution, or repair of a damaged conversation. Applications integrating the library own argument validation and permissions.

Setup creates only the explicitly chosen new file and refuses to overwrite it. Keep connection files outside the checkout. No secret belongs in a connection file; its key field is an environment-variable name. Unix file mode is requested when creating it; Windows access is governed by the destination's existing ACLs.

Tests use synthetic files and temporary loopback listeners. No production provider is contacted by CI. The publication audit checks an exact manifest and common secret/path patterns; it is a narrow guard, not proof that every sensitive fact has been removed. Review every diff.

Report ordinary defects with a minimal synthetic input, expected/actual behavior, fixed error code, and runtime version. Do not post keys, cookies, private prompts, user paths, raw logs, or provider error bodies. For an actual disclosure or exploitable vulnerability, use this repository's [private vulnerability reporting](https://github.com/WorldOfEpoch/codex-provider-compatibility-lab/security/advisories/new).
