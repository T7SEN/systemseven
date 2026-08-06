# Stream Notifier — State Machine Deep Dive

Covers `src/features/streamNotifier.ts` and its interaction with `src/index.ts` shutdown. Read this before touching polling, cooldowns, announcements, or `data/state.json`.

## Per-broadcaster state (`BroadcasterState`)

| Field | Meaning | Written when |
|---|---|---|
| `lastStreamId` | Twitch stream id last announced *or deliberately suppressed* | announce success; cooldown suppression |
| `lastAnnouncedAt` | ISO time of the last announcement actually posted (observability) | announce success only |
| `lastSeenLiveAt` | ISO time of the most recent poll that saw this broadcaster live | **every** poll the broadcaster is live |

Keyed by lowercase login in `state.broadcasters`. Persisted to `data/state.json` after any change (atomic tmp+rename).

## Poll decision tree (per live stream returned by Helix)

1. `stream.type !== "live"` → skip (Helix can return other types).
2. Same `stream.id` as `lastStreamId` → refresh `lastSeenLiveAt`, save, done. **This refresh is the heart of the cooldown fix** — it keeps the liveness clock current for the entire stream duration.
3. New `stream.id`, and `now - lastSeenLiveAt < RENOTIFY_COOLDOWN_MINUTES` → treat as a reconnect: record the new id + `lastSeenLiveAt`, do NOT announce. Suppressed sessions also never announce later (their id is recorded).
4. New `stream.id`, outside cooldown → announce. On success record id + both timestamps. **On failure record nothing** — the next poll (15–60s later) retries the announcement.

## Why the cooldown anchors to `lastSeenLiveAt`, not `lastAnnouncedAt`

The pre-commit draft compared against `lastAnnouncedAt`, and review caught the failure before anything was committed: stream announced at 18:00 runs three hours, drops at 21:00, restarts 21:02 with a new stream id → 3h since announcement > 15min cooldown → duplicate ping. Anchoring to the last-seen-live poll means "restarted within N minutes of the drop", which is what the README promises. Do not "simplify" this back.

## Scenario table (behavioral contract)

| Scenario | Behavior |
|---|---|
| First-ever startup while streamer is already live | Announces (no prior state — documented in README) |
| Bot restarts mid-stream, state file present | No announcement (same stream id) |
| Stream drops, restarts within cooldown | No announcement; new id recorded silently |
| Stream drops, restarts after cooldown | Announced as a new stream |
| Continuous flapping | Stays suppressed — each live sighting refreshes `lastSeenLiveAt` |
| Discord send fails (outage, permissions) | Error logged; retried next poll because state wasn't advanced |
| Twitch API fails (any poll, including the first) | Logged, retried next cycle; never fatal |
| `data/state.json` missing or corrupt (any shape) | Sanitized load → start fresh; worst case one duplicate announcement |
| Two watched streamers go live in one poll | Both announced independently in the same pass |
| SIGTERM during an in-flight announcement | `shutdown` awaits `notifier.stop()`, which drains `#currentPoll` (≤10s) before `client.destroy()` — the state write completes |

## Timing & lifecycle

- Poll loop: `setTimeout` chain (`#scheduleNext`), never overlapping; in-flight promise tracked in `#currentPoll`.
- `start()`: load state → resolve users (non-fatal on failure — embeds degrade gracefully) → initial poll (wrapped, non-fatal) → schedule.
- `stop()`: sets `#stopped`, clears the timer, drains `#currentPoll` with a 10s `Promise.race` cap.
- User records (`#users`) are resolved once at startup for display names/avatars; a broadcaster added to config needs a restart to be watched (config is read once at boot — there is no hot reload).

## Invariants to preserve when editing

1. A stream id, once recorded, is never announced again.
2. State is persisted before the poll cycle ends whenever it changed.
3. Announce-failure leaves state untouched (retry semantics depend on it).
4. Every live sighting refreshes `lastSeenLiveAt` — except a sighting whose announcement fails, which records nothing (that's invariant 3; the stale timestamp just means a post-failure restart may announce instead of suppress, which is the safe direction).
5. `#loadState` must accept arbitrary JSON without throwing.
6. Changing `BroadcasterState`'s shape requires updating the `#loadState` sanitizer in the same change; existing state files must load.
