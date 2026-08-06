# Anti-Hallucination Inventory (Full Mirror)

Verbatim mirror of SKILL.md Section 2, for tools that load references without SKILL.md.

| If you're about to write… | What actually exists instead |
|---|---|
| `package-lock.json` / `npm install` | None — pnpm repo; `pnpm-lock.yaml` is the only lockfile |
| `"pnpm": { "onlyBuiltDependencies": [...] }` in package.json | Never worked here — pnpm 11 ignores that field; `pnpm-workspace.yaml` → `allowBuilds: esbuild: true` |
| `src/commands/`, `src/events/`, a command handler | None — never existed; features live in `src/features/`, wired in `src/index.ts` |
| Slash commands, interactions, REST command registration | None yet — no commands exist; pattern undecided until the first command feature |
| `jest`, `vitest`, `mocha`, a `tests/` dir | None — verification is `pnpm typecheck` + `pnpm check` + `pnpm test-notify` |
| `.eslintrc`, `eslint.config`, `.prettierrc` | None — no linter or formatter is configured |
| GitHub Actions / CI workflows | None — `.github/` does not exist |
| `node-fetch`, `axios`, `undici` imports | None — global `fetch` (Node 18+) |
| EventSub subscriptions, webhook endpoints, an HTTP server | None — detection is Helix polling only; the bot binds no ports |
| A database, Redis, Prisma, an ORM | None — `data/state.json` is the entire persistence layer |
| `MessageContent`/`GuildMembers`/`GuildPresences` intents | Not used — `Guilds` is the only intent |
| Embed-building code inside `streamNotifier.ts` | Moved — `src/features/announcement.ts` owns all announcement content |
| Cooldown measured from `lastAnnouncedAt` | It anchors to `lastSeenLiveAt` — announcement-time anchoring was a bug caught in pre-commit review (2026-08-06); no committed version ever had it |
| Synchronous `notifier.stop()` | It's async and awaited in shutdown *before* `client.destroy()` — ordering is load-bearing |
| `ecosystem.config.js`, Dockerfile, docker-compose | None — no process manager or containerization is set up (deliberately undecided) |

If a search result, training memory, or autocomplete suggests one of these — it is wrong for this codebase.

## Provenance notes (why these entries exist)

- **pnpm field in package.json**: attempted during the 2026-08-06 npm→pnpm migration; pnpm 11.3.0 warned `The "pnpm" field in package.json is no longer read` and the fix landed in `pnpm-workspace.yaml` (`allowBuilds`), which pnpm itself scaffolded.
- **Cooldown anchor**: the pre-commit draft compared `Date.now()` against `lastAnnouncedAt`; a multi-agent review caught that a stream crashing 2+ hours in would always re-ping, and the fix (adding `lastSeenLiveAt`, refreshed every poll a stream is seen live) landed before the initial commit — git history only ever contains the correct anchoring. The row exists because the buggy version is the "obvious" implementation an agent would reach for.
- **Announcement extraction**: embed code originally lived inline in `StreamNotifier.#announce`; extracted to `announcement.ts` so `pnpm test-notify` exercises the identical path.
- **stop() ordering**: shutdown must drain the in-flight poll before `client.destroy()`, otherwise a SIGTERM landing between `channel.send()` resolving and the state file write causes a duplicate ping on restart.
