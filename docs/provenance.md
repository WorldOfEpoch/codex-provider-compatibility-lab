# Provenance

This public package was prepared on October 16, 2026 from lessons learned in the repository owner's retired local provider-routing experiment.

The legacy integration was a local adapter, not an official OpenAI or OpenRouter plugin. Its historical Space Bunny Alpha name is retained only to explain the case study. It has not been reactivated for this publication.

The public implementation is a small extraction and rewrite of selected compatibility methods: item-specific history checks, namespace mapping, JSON SSE handling, and encoded-image accounting. A new provider-neutral adapter applies those methods through explicit capability profiles. Regression tests exercise them without an API key or network connection. All fixture text, IDs, tool names, profiles, and private-data sentinels are synthetic.

The package excludes the operational proxy, model aliases and catalogs, startup watchers, launchers, credential-loading helpers, encrypted credential stores, personal configuration, session archives, memory, raw diagnostics, private endpoints, project-specific content, and third-party application source. No legacy Git history was imported.

`PUBLICATION_FILES.json` lists the exact intended files. The audit checks the current working tree against it, excluding only Git metadata. The initial publication also reviewed the staged files and commit identity. This is a scoped publication review, not a forensic certification of the original computer.

The MIT license covers this repository's original code and documentation. Product names and external documentation remain the property of their respective owners. Links to protocol documentation are references, not copied vendor implementations or endorsements.
