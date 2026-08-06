# Code Style

No linter enforces this — consistency is maintained by matching the existing code.

## Naming & structure

- Files: camelCase (`streamNotifier.ts`, `testNotify.ts`); one primary export per file.
- Classes for stateful features (`StreamNotifier`, `TwitchClient`); plain functions for stateless logic (`buildGoLiveMessage`, `loadConfig`).
- Native `#private` fields in classes — not TypeScript `private` keyword.
- `interface` for data shapes (`Config`, `TwitchStream`, `BroadcasterState`); `type` only where interfaces can't express it.
- Constants: `SCREAMING_SNAKE` at module top (`STATE_FILE`, `TOKEN_URL`, `TWITCH_LOGIN_RE`).

## Logging

- Prefix by subsystem: `[bot]`, `[notifier]`, `[check]`, `[test]`. New features add their own prefix.
- Log state transitions and failures, not routine success. One line per event.
- Never log secrets or full config objects.

## Errors

- Error messages are written for the person fixing them: say what to do, not just what broke. Example from `config.ts`: *"Missing required environment variable X. Copy .env.example to .env and fill it in."*
- Include upstream context when wrapping: status code + response body for API failures.
- Transient vs. fatal is a deliberate choice per call site: startup validation throws; runtime polling logs and retries.

## Comments

- A comment states a constraint the code can't express: *why* the ready-listener is registered before login, *why* the write is tmp+rename, *why* the cooldown anchors to `lastSeenLiveAt`. Class-level JSDoc describes behavior contracts (see `StreamNotifier`).
- No narration ("increment the counter"), no changelog comments ("fixed in review"), no commented-out code.

## TypeScript

- `strict` is on; don't weaken it per-file. No `any` — use `unknown` + narrowing (see `#loadState`).
- Prefer narrowing guards discord.js provides (`isSendable()`, `isDMBased()`, `isReady()`) over casts.
- `as` casts only at trust boundaries (JSON.parse results, API payloads), immediately followed by field-level validation when the data crosses into state.

## Git

- Conventional-commit style subjects (`feat:`, `fix:`, `chore:`) — matches existing history.
- The owner commits or explicitly asks for commits; agents don't commit unprompted.
