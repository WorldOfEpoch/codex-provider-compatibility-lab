# Contributing

Keep changes focused on a demonstrated compatibility case. Reuse the existing helper that owns the behavior.

1. Create the smallest synthetic input that reproduces the problem. Do not import a real conversation or proprietary fixture.
2. State what should happen and cite a primary protocol reference when claiming protocol behavior.
3. Add a regression test that would fail before the fix. Preserve opaque prompts, arguments, and tool outputs.
4. Update the limitations in the findings when the supported scope changes.
5. Add any new public file to `PUBLICATION_FILES.json`.
6. Run `node --test`, `node bin/inspect.mjs fixtures/example-request.json`, and `node scripts/audit-publication.mjs`.
7. Review the actual staged diff and file list before pushing.

Keep this package offline and dependency-free. Do not add credential helpers, automatic provider calls, settings changes, background processes, model aliases, or live conversation fixtures. A future operational integration would be a separately scoped project with explicit provider and feature contracts.

Distinguish source review, offline tests, live API acceptance, desktop behavior, connector behavior, and user acceptance. A successful example at one layer is not proof of the next.
