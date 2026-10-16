# Case study: retired routing and recent reconnections

Reviewed October 16, 2026. This is a sanitized owner case study, not a claim about every Codex installation or a diagnosis of a model service. The original private logs and router are not distributed.

## What was confirmed

An experimental local relay had become a dependency for ordinary Codex model requests through a global base-URL override. The relay selected an experimental provider only for one alias, but normal model requests still passed through it. Logs explicitly showed requests to the old loopback route being refused. An unavailable relay could therefore interrupt requests unrelated to Space Bunny.

A separate watcher could restart that relay at ten-second intervals. Removing a startup entry, stopping its watcher, stopping the relay, and restarting clients that cached its URL were distinct operations. Editing the configuration alone could not prove that every already-running client had switched routes.

The relay declined WebSocket upgrades with HTTP 426 and depended on an HTTP/SSE fallback. The log establishes that those declines happened; it does not establish how every client handled them. A provider adapter must not assume universal fallback behavior.

The old routing overrides and startup entry were removed, the watcher was stopped, and optional Blender/presence connectors were disabled. Verified Blender helper trees were stopped separately. A later read-only check found no matching helper launches or watcher. One legacy relay was temporarily retained for already-running clients that still held its old URL. That compatibility bridge was not a reactivation of the retired experimental provider. No full desktop restart or post-restart provider acceptance is claimed by this review.

## Log counts and their limits

The inspected snapshot covers October 16 from 00:00 to 13:15:05 UTC. A configuration-removal boundary occurred at 11:09:34 UTC. These are **log records**, not unique incidents, and the windows are unequal.

| Record category | Before boundary | After boundary | Interpretation |
| --- | ---: | ---: | --- |
| Explicit old-loopback WebSocket connection refused | 37 | 1 | Direct evidence of a dependency on an unavailable local route |
| HTTP 426 from old loopback route | 1 | 5 | Upgrade refusal; client recovery is a separate question |
| Response body decoding error | 7 | 0 | Observed symptom; exact triggering branch unproven |
| Thread-read access denied | 49,936 | 4,727 | Separate authorization/read path; many repeated records |
| Notification reconnect scheduled | 123 | 15 | Separate notification path |
| Remote app-server transport closed with code 1006 | 8 | 1 | Actual transport-close records, not repeated UI status lines |

Categories can overlap and must not be summed into a total incident count. Cached clients still attempted the old route after the configuration edit. Consequently this is not a controlled before/after test, and these counts do not establish a percentage improvement or prove a causal domino chain.

Five later Blender-ready log lines were catalog/status notifications, not evidence that five processes had restarted. Process ancestry and actual command lines were necessary to distinguish helpers from status messages.

## Source risks found, without claiming they caused every symptom

| Retired implementation behavior | Plausible consequence | Evidence boundary |
| --- | --- | --- |
| Load an unrelated provider credential before the relay listens | Ordinary requests can lose their relay when that load fails | Dependency proven in source; that failure was not proved in this incident |
| Change provider/model on a compaction path | Compaction can have different capabilities or semantics | Source behavior; the seven decoding errors do not identify this branch |
| Parse SSE line by line and flush partial input | Split/unfinished events can be mishandled | Source risk; synthetic cases are now tested separately |
| Truncate an error body but retain original length/encoding headers | Downstream framing or decompression can fail | Source risk; no captured transaction proves it caused the observed decoding errors |
| Limit compressed request bytes before unbounded decompression | Decoded payload can exceed the intended budget | Source risk; no observed resource-exhaustion claim |

Thread-read authorization and cloud notification errors use different paths from the model relay. Their presence before and after the change leaves them unresolved. The evidence supports **some local routing failures**, not the claim that Space Bunny caused every Codex error, every reconnect, or the Blender process buildup.

## What this project changes

The new client is a foreground command with an explicit endpoint and model. It has no global Codex routing, watcher, autostart, compaction fallback, or retry loop. Synthetic tests exercise the specific protocol risks: split SSE, strict completion, malformed/truncated HTTP, invalid compression, refusal, cancellation, and byte limits. These tests validate this client; they do not repair an installed desktop app or prove old incidents cannot recur.

For separately maintained symptom/fix records and community reproductions, use the [Windows Codex community project](https://github.com/WorldOfEpoch/codex-windows-community). Never upload a whole Codex profile, session database, private log archive, or encrypted credential store as a bug report.
