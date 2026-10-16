# Contributing

Help make explicit model integration usable and reproducible. Open a focused issue for a compatibility result, bug, or proposed capability. General Windows desktop problems belong in the [Windows community catalog](https://github.com/WorldOfEpoch/codex-windows-community).

1. Find the existing behavior owner in the [adapter guide](docs/provider-adapters.md).
2. Create a minimal synthetic reproduction. Never import a real conversation, private tool schema, or proprietary fixture.
3. State expected versus actual behavior and cite a primary protocol reference when claiming protocol semantics.
4. Add a regression test that fails before the fix. Use a temporary loopback server for transport behavior; tests must not need credentials, cloud access, or a downloaded model.
5. Keep provider choice explicit, preserve opaque payloads, reject unsupported capabilities, and keep retries at zero unless a separately reviewed policy changes that.
6. Update scope, limitations, setup, and the changelog when behavior changes. Add each intended public file to `PUBLICATION_FILES.json`.
7. Run the checks below and review the actual staged files before pushing.

```sh
node --test
node bin/inspect.mjs fixtures/example-request.json
node scripts/audit-publication.mjs
```

Node.js 22 and 24 on Windows and Linux are the CI targets. Keep the client dependency-free where practical. Network access must remain an explicit user operation; never add global Codex overrides, autostart, hidden provider fallback, or model-requested shell execution.

For live provider reports, use the [evidence matrix](docs/compatibility-matrix.md). Obtain your own provider access and use synthetic prompts with bounded requests. A public model ID and reduced report are useful; credentials, private endpoints, raw error bodies, or account details are not.

Community notes can confirm the same symptom, report a failed workaround, or identify a different version. Distinguish authored, mock-tested, live-probed, integrated, user-accepted, and published. Unsupported results are valuable when described precisely.

The retired Space Bunny installation is not a test prerequisite. Changes should improve the portable method without reactivating it.
