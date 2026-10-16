# An open, modular workspace people can improve

The community goal is a useful personal workspace where people can choose models, add capabilities, and understand what each plugin can access. Someone should be able to ask for a meeting helper, a calendar view, a sports/activity planner, a capture workflow, or a video task, then install and configure the appropriate module without rebuilding the whole system.

This is the owner's direction for several projects. **Only the compatibility client and tests are implemented in this repository.** A roadmap entry is not a released product, a working integration, or permission to connect an account.

## Projects and intended ownership

| Project or module | Intended role | Current public milestone |
| --- | --- | --- |
| This compatibility lab | Model protocol translation, explicit capabilities, repeatable compatibility evidence | Usable foreground preview, mock-tested; named live results still needed |
| [Windows Codex community](https://github.com/WorldOfEpoch/codex-windows-community) | One documented problem and evidence record per failure, with community fixes | Initial sanitized problem catalog |
| LifePortal Connect | Personal workspace and plugin discovery/configuration | Product and integration goal; no host delivered here |
| Work and meetings | Tasks, preparation, meeting records, follow-up workflows | Planned modules with scoped account access |
| Sports and activities | User-selected schedules, participation, reminders | Planned modules; use appropriate data sources and user preferences |
| Calendar module | Google Calendar and later supported calendars | Planned integration; separate read access from event creation/change |
| [Quest Gaussian Splat Capture](https://github.com/WorldOfEpoch/quest-gaussian-splat-capture) | Headset capture and a PC reconstruction bridge | Public app/bridge/Blender source preview, setup guides and contributor tests; clean APK and fresh device acceptance pending |
| Other capture clients, including Vive | Reuse the capture/receipt method through a device adapter | Target, not a claim that Quest camera code runs on a Vive |
| Video Studio | Existing media workflow exposed through its original job commands | Planned public extraction after dependency, privacy, and licensing review |
| Optional VR workspace | Access the same supported workspace functions in a headset | Planned; heavy processing still needs a PC or an explicitly configured compute host |

Keep each substantial application in its own repository when its code and release boundary are ready. Share small, versioned contracts and reuse original command owners. Do not copy whole private projects, accounts, vendor SDKs, or model caches into a common repository.

## What a plugin should promise

These are design requirements for a future plugin contract, not enforcement already implemented by the lab:

- A stable ID and version, supported host/protocol versions, declared model capabilities, and explicit platform/device requirements.
- A readable permissions list: accounts, files, microphone/camera, calendar reads/writes, network destinations, and background behavior.
- User-controlled installation, connection, disconnection, and removal. No hidden startup process or endless restart loop.
- One existing command owner for each action. The interface and assistant call the same validated command, with stable IDs and receipts for resume/retry.
- Separate data from instructions. A model suggestion cannot grant itself permissions, execute arbitrary shell text, or expand account scopes.
- Resource and cost expectations, bounded retries, cancellation, and a way to inspect status without repeating work.
- Public source/license provenance and dependencies installed through their legitimate distribution. Private captures, browser profiles, API keys, vendor content, and signing keys stay outside releases.
- Clear behavior when a capability is unavailable. Do not silently send a request to another provider or manufacture a successful result.

Voice can help a person discover and configure a module. It should produce a reviewable plan when necessary, use the same permissions as other controls, and report the actual result. It must not turn an ambiguous request into unrelated account changes.

## Milestones contributors can complete

| Milestone | Acceptance evidence |
| --- | --- |
| 1. Make the model client easy to use | Fresh Windows setup, offline doctor, normal request, streamed request, clean exit; current automated checks pass |
| 2. Establish named provider compatibility | Dated public provider/model versions, text/tool/replay results, failure cases and limits; independent reproduction where possible |
| 3. Design the plugin contract | Reviewed manifest/permission/version spec, a synthetic sample, install/uninstall lifecycle tests; no unnecessary background service |
| 4. Ship one narrow LifePortal module | Start with a calendar read workflow; test expired access, time zones, duplicates, disconnect, and permission refusal before adding writes |
| 5. Prepare capture and video releases | Clean source/dependency inventory, reproducible builds, verified license rights, release hashes, documented PC/device requirements |
| 6. Add more clients and VR | Each device has its own input/display/network tests; demonstrate the ordinary user flow and preserve existing project data |

Start with a small issue and a concrete acceptance check. Good contributions include a reproducible compatibility failure, a clearer setup step, an accessibility improvement, a verified Windows workaround, or a device-specific report. A large framework is not required to contribute.

## Release and maintenance expectations

WorldOfEpoch intends to maintain public releases and accept improvements from others. Each release should identify its exact source revision, build inputs, tested platforms, known limitations, and upgrade/removal path. "Latest public build" means the newest reviewed release that passes its stated checks, not every new upstream commit automatically packaged and marked safe.

Publishing this roadmap does not create an unattended updater, schedule, deployment, or submission to a plugin store. Releases and community reports are reviewed as work progresses. A third-party dependency's current license and redistribution rules still apply.
