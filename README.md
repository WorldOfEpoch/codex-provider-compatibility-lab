# Codex provider compatibility lab

A small, explicit client and test lab for using models through **Responses** or **Chat Completions** endpoints. Choose a model, create a connection file, check it offline, and run a prompt or a bounded compatibility probe. Built for Windows, with Windows and Linux CI.

**0.3.0 is a preview.** The client is tested against simulated providers; no named live model has been certified by this release. It implements a documented subset of each protocol. This is an independent community project, not an official OpenAI integration or a replacement for Codex desktop.

## Get started

Use Node.js 22 or later. Download a tagged source archive or clone this repository. There are no package dependencies to install. Run these commands from its folder:

```sh
node bin/lab.mjs init
node bin/lab.mjs doctor --config ../compatibility-provider.local.json
node bin/lab.mjs run --config ../compatibility-provider.local.json --prompt "Say hello briefly." --stream
```

Setup asks for the full endpoint, exact model ID, optional API-key **environment-variable name**, and expected capabilities. It creates a new file outside the checkout by default. `doctor` stays offline; `run` sends your prompt to that endpoint. See the [Windows setup guide](docs/getting-started.md) for local servers, credentials, troubleshooting, and uninstalling.

To deliberately test a provider with synthetic prompts:

```sh
node bin/lab.mjs probe --config ../compatibility-provider.local.json --network
node bin/lab.mjs probe --config ../compatibility-provider.local.json --network --tools
```

The first command makes up to two requests; the second makes up to four when streaming and tools are declared. They stop on the first failure. Each request defaults to 128 output tokens and a 30-second deadline. Providers may charge for these requests. No returned tool is executed. [Read what the tests establish](docs/compatibility-matrix.md).

## What it does

| Capability | Current behavior |
| --- | --- |
| Explicit provider selection | One connection file, one endpoint, one model; no automatic fallback |
| Responses and Chat Completions | JSON answers, streaming text, function calls, and tool-result replay |
| Namespaced tools | Reversible tool-name mapping; unsupported tools fail explicitly |
| Bounded requests | Deadlines, cancellation, request/response limits, no retries or redirects |
| Offline inspection | Synthetic history checks, image byte accounting, setup validation |
| Useful failure reports | Fixed error codes without upstream error bodies or credentials |

The client runs in the foreground. It does not change Codex settings, start a relay, execute tools, install a plugin, or create a startup entry. The old Space Bunny integration remains retired. The [reconnection case study](docs/reconnection-case-study.md) explains its confirmed role and the separate errors that remain unresolved.

## Improve it with us

Our goal is a dependable way to choose models and compose useful, permissioned plugins. The [open ecosystem roadmap](docs/open-ecosystem-roadmap.md) covers LifePortal Connect, calendar/work/meeting/activity modules, capture and splats, Video Studio, and optional VR. Those integrations are goals; this repository currently delivers the model client and its test method.

- [Start using the client](docs/getting-started.md)
- [Adapter and library contract](docs/provider-adapters.md)
- [Compatibility evidence and limitations](docs/compatibility-matrix.md)
- [Contribute a provider result or fix](CONTRIBUTING.md)
- [Windows Codex problem records](https://github.com/WorldOfEpoch/codex-windows-community)
- [Release changes](CHANGELOG.md), [security](SECURITY.md), and [provenance](docs/provenance.md)

## Run the checks

```sh
node --test
node bin/inspect.mjs fixtures/example-request.json
node scripts/audit-publication.mjs
```

Tests use synthetic payloads and temporary loopback servers, without provider accounts. CI runs Node.js 22 and 24 on Windows and Linux. Keep private connection files outside this checkout: the publication audit intentionally rejects files outside its reviewed manifest.

Licensed under [MIT](LICENSE).
