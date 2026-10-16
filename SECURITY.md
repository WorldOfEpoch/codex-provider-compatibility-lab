# Security

This is an offline learning package. It has no provider client, listening port, credential store, installation hook, automatic retry loop, or startup entry.

The CLI reads only the explicitly supplied file and outputs a reduced diagnostic summary. It does not modify that file. Use invented examples rather than real conversations. The tests create and remove their own temporary example file; they do not inspect a Codex profile.

The protocol helpers are not a security boundary. They accept already parsed data, perform partial checks, and do not provide complete schema validation, transport security, history repair, or a production gateway.

The publication audit is a narrow pattern check plus an exact file manifest. A pass is not proof that all credentials or personal information have been removed. Review every proposed file and diff.

Report ordinary defects with a minimal synthetic input, the expected result, the observed fixed error code, and the Node.js version. Never post real API keys, provider error bodies, session files, personal paths, or private prompts. Do not include a working secret as a detector test. If a report involves an actual disclosure, use GitHub's private vulnerability reporting option when available rather than a public issue.
