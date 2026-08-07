# SystemSeven — Agent Guide (Canonical)

```
⚠ VERSION DRIFT WARNING
This repo uses pnpm 11 and discord.js 14.27+, both of which changed after most
models' training data:
- pnpm 11 does NOT read the "pnpm" field in package.json. Build-script approval
  lives in pnpm-workspace.yaml under `allowBuilds` (NOT `onlyBuiltDependencies`).
- discord.js `ready` was renamed `clientReady` (use the Events.ClientReady enum),
  and the event can fire DURING `await client.login()` — register listeners first.
When behavior surprises you, read the installed package in node_modules or the
official docs instead of trusting memory.
```

## Product Context

| | |
|---|---|
| Repository | github.com/T7SEN/systemseven (private hobby project) |
| Distribution | Self-hosted; not published anywhere |
| Hosting | Always-on Node process on the owner's Windows 11 PC; may move to a VPS later. Never serverless. |
| Architecture | Single long-running Discord gateway client + Twitch Helix polling loop; features are modules under `src/features/` |
| Package manager | **pnpm 11.3.0** (pinned via `packageManager`). Never npm, never yarn. |
| Users | The owner (GitHub `T7SEN`, streams on Twitch as `it7sen`) and their Discord server. No roles/permissions model in code. |
| Platform | Node.js ≥ 18.17 (dev box runs 22.x), TypeScript, ESM (NodeNext). Dev shell is PowerShell on Windows. |

**Banned features.** *npm/yarn*: the owner chose pnpm; a reappearing `package-lock.json` is a bug — `pnpm-lock.yaml` is the only lockfile. *Serverless hosting (Cloudflare Workers, Vercel)*: rejected because a gateway bot needs a persistent process, and planned features (presence, voice, member events) can't run on request-scoped runtimes. *Twitch EventSub (webhook or websocket)*: rejected for now — webhooks need a public HTTPS endpoint the owner doesn't have, and Helix polling with an app token covers current needs; see Deferred Decisions before re-proposing. *Databases/ORMs*: state is a tiny JSON file (`data/state.json`); no DB until a feature genuinely outgrows it. *Privileged gateway intents* (MessageContent, GuildMembers, GuildPresences): the bot runs on `Guilds` only; adding a privileged intent requires a feature that needs it and explicit owner approval.

## Tech Stack (Locked Versions)

Do not upgrade any of these as part of feature work — upgrades are their own change, approved by the owner first.

- **Runtime**: Node.js ≥ 18.17 (engines), tsx 4.x for dev (`pnpm dev` = `tsx watch`), tsc build to `dist/` for prod
- **Language**: TypeScript 5.x, `strict`, ESM with `module: NodeNext` (relative imports need `.js` suffixes)
- **Discord**: discord.js ^14.16 (14.27.0 installed)
- **Config**: dotenv ^16.4, all env access centralized in `src/config.ts`
- **Package manager**: pnpm 11.3.0; build scripts gated via `pnpm-workspace.yaml` → `allowBuilds` (esbuild is the only approved one)
- **Observability**: @sentry/node ^10 (optional — enabled only when `SENTRY_DSN` is set), attached as a logger sink in `src/lib/sentry.ts`; error monitoring only, tracing/profiling deliberately off
- **Testing/CI**: none — verification is `pnpm typecheck`, `pnpm check` (setup doctor), `pnpm test-notify` (live-fire announcement test)

Common drift traps are inventoried in **SKILL.md Section 2** — the top offenders: `package-lock.json` (removed), `pnpm.onlyBuiltDependencies` in package.json (never worked here — pnpm 11 ignores it), `src/commands/`–`src/events/` folder conventions (never existed), node-fetch (global fetch is used), any test framework or linter config (none exists).

## Architectural Pillars

Do not paraphrase from memory — load the reference when the work touches that pillar.

### 1. Feature-module pattern
Every bot capability is a self-contained module (usually a class) under `src/features/`, constructed and started from `src/index.ts` — no plugin framework, no dynamic loading, no `src/commands/` convention. A feature owns its own state, scheduling, and persistence; `index.ts` only wires it to the shared `Client`, `Config`, and shared services (`TwitchClient`, `Watchlist`, `AnnouncementHistory`). New features copy the shape of `StreamNotifier` (constructor takes `client, config, deps`; `start()`; async `stop()`). Slash commands are their own feature (`src/features/commands/`): a `CommandsFeature` registry that bulk-registers on ready and routes `InteractionCreate`; each command is one module added to its `COMMANDS` array. → `references/coding-patterns.md`

### 2. Twitch detection is Helix polling with an app token
`src/lib/twitch.ts` is a minimal Helix client using the client-credentials flow: lazy token fetch, refresh 60s before expiry, one forced-refresh retry on 401. Detection is `GET /streams` polling (chunked ≤100 logins per request) every `POLL_SECONDS`. There is no user OAuth, no EventSub, no webhook server. Malformed logins make Helix 400 the *entire* request, which is why every login is normalized (`@name`, `twitch.tv/name` → `name`) and validated (`/^[a-z0-9_]{1,25}$/`) via `src/lib/twitchLogins.ts` — at startup for the env seed, and in `/watch add` for runtime additions. The watched list itself lives in `data/watchlist.json` (`Watchlist`), seeded from `TWITCH_BROADCASTERS` on first boot and managed by `/watch` afterward; the notifier reads it fresh every poll. → `references/twitch-api.md`

### 3. Announce-once state machine
A stream id is never announced twice: `data/state.json` (atomic tmp+rename writes, sanitized on load) records `lastStreamId`, `lastAnnouncedAt`, and `lastSeenLiveAt` per login. The re-notify cooldown is anchored to `lastSeenLiveAt` — the last poll where the broadcaster was seen live — NOT to the announcement time; anchoring to announcement time was a real bug caught in pre-commit review (a stream crashing 2h in would have re-pinged). A failed announcement leaves `lastStreamId` unset so the next poll retries. → `references/stream-notifier.md`

### 4. One shared announcement path
`src/features/announcement.ts` (`buildGoLiveMessage` + `sendGoLiveMessage`) is the only place announcement content exists. The real notifier and `pnpm test-notify` both call it, so tests can never drift from production behavior. Never inline embed-building anywhere else. → `references/coding-patterns.md`

### 5. Fail-fast config, resilient runtime
Anything wrong in `.env` throws at startup with an actionable message (`src/config.ts` is the only file that touches `process.env`). Anything transient at runtime — Twitch 500s, network blips, Discord hiccups — is caught, logged through the shared subsystem logger (`src/lib/logger.ts`, `[notifier]`-style prefixes), and retried on the next cycle; the process never crashes over a transient error. Shutdown drains the in-flight poll (bounded 10s) *before* destroying the client so an announcement is never posted without its dedupe record being saved. → `references/stream-notifier.md`

### 6. Minimal Discord surface
`Guilds` intent only; permissions requested at invite are View Channel, Send Messages, Embed Links (+ Mention Everyone, needed only when the configured mention role isn't itself mentionable). Every `send()` sets `allowedMentions` explicitly. Widening intents or permissions is a design decision for the owner, not an implementation detail. → `references/coding-patterns.md`

## Code Style / Patterns Summary

TypeScript strict; native `#private` class fields; `interface` for shapes; no classes where a function does the job. Logging goes through `createLogger(subsystem)` from `src/lib/logger.ts` (tags like `[bot]` / `[notifier]`); raw console lives only in the CLI scripts. Error messages tell the user what to *do*, not just what broke. Comments state constraints the code can't (why the ready-listener order matters, why writes are atomic) — never narrate the next line. Details: `references/code-style.md`; mechanical rules agents must apply: SKILL.md Section 1.

## File Map

```
src/
  index.ts                 # entry: builds Client (Guilds only), constructs shared services + features,
                           #   wires ClientReady startup, re-entry-guarded shutdown (drain notifier THEN destroy)
  config.ts                # loadConfig(): the ONLY process.env access; throws actionable errors at startup.
                           #   TWITCH_BROADCASTERS is watchlist SEED only; DISCORD_GUILD_ID → instant commands
  check.ts                 # `pnpm check` setup doctor: Twitch creds, broadcaster names, Discord token,
                           #   channel access + permissions, role pingability, guild access. Posts NOTHING.
  testNotify.ts            # `pnpm test-notify`: posts a REAL announcement via the shared path
                           #   (pings the mention role!). Uses the first watchlist entry.
  lib/
    twitch.ts              # Helix client: app-token lifecycle, 401 retry, chunked ≤100 lookups
    twitchLogins.ts        # login normalization + validation (shared by config and /watch)
    jsonFile.ts            # readJsonFile / writeJsonAtomic — ALL data/ persistence goes through these
    logger.ts              # leveled subsystem logger (createLogger) + addLogSink transport hook
    sentry.ts              # the ONLY @sentry/node touchpoint: initSentry (no-op without SENTRY_DSN),
                           #   log-sink wiring (errors → events, info/warn → breadcrumbs), closeSentry flush
    watchlist.ts           # Watchlist: authoritative watched-login set (data/watchlist.json)
    history.ts             # AnnouncementHistory: rolling log, cap 50 (data/history.json, feeds /recent)
  features/
    streamNotifier.ts      # the poll loop + announce-once state machine + data/state.json persistence
    announcement.ts        # buildGoLiveMessage/sendGoLiveMessage — the ONLY announcement content source
    commands/
      index.ts             # CommandsFeature: bulk registration (guild-scoped if DISCORD_GUILD_ID) + routing
      types.ts             # SlashCommand + CommandContext interfaces
      live.ts              # /live — watched streamers live right now (ephemeral)
      watch.ts             # /watch add|remove|list — ManageGuild enforced SERVER-SIDE in execute()
      recent.ts            # /recent — recent announcements from history (ephemeral)
data/                      # gitignored runtime state: state.json (announce dedupe — missing at startup
                           #   mid-stream = one duplicate), watchlist.json (authoritative watched list),
                           #   history.json (announcement log)
pnpm-workspace.yaml        # allowBuilds: esbuild — pnpm 11's build-script approval (NOT package.json "pnpm")
.env.example               # env template with comments; real .env is gitignored and holds live tokens
```

## Decision Heuristics

1. About to run `npm` or `npx` anything? → Refuse; use `pnpm` / `pnpm exec`.
2. Adding a dependency, linter, test framework, or CI? → Ask the owner first. Tooling choices are theirs (this is standing feedback, learned the hard way with npm-vs-pnpm).
3. Tempted to propose EventSub, serverless, or a database? → Check Deferred Decisions below; don't re-propose without new evidence.
4. Building a new feature? → New module in `src/features/`, wired in `index.ts`, config through `config.ts`. Copy `StreamNotifier`'s lifecycle shape. A new slash command is one module in `src/features/commands/` added to the `COMMANDS` array — never a second router.
5. Touching announcement content? → Edit `src/features/announcement.ts` only; verify with `pnpm test-notify` (warn the owner first — it pings).
6. Changing `BroadcasterState`? → Update the `#loadState` sanitizer in the same change; existing `data/state.json` files must load cleanly.
7. About to run a script that posts to Discord? → Tell the owner before running; announcements ping a real role on a real server.
8. Need a new env var? → Add to `config.ts` (validated, typed) AND `.env.example` (commented). Never `process.env` elsewhere.
9. Need a privileged intent or wider permission? → Stop; that's an owner decision. Name the feature that requires it.
10. Unsure whether something exists in this repo? → SKILL.md Section 2 before writing code that references it.

### Standing working agreements (owner-set, 2026-08-07)

1. **Docs are part of the change.** Any change that affects documented behavior, structure, or decisions updates this file, SKILL.md, the affected `references/` files, README, and the owner's session-prompts file in the *same* change — never as a follow-up. Stale docs are treated as defects.
2. **Verify before reporting.** Every code change — added, modified, or removed — is followed by `pnpm typecheck`; changes touching config, env, or integration surfaces also get `pnpm check`. Work is not "done" until the checks pass.
3. **Reports end with "How to test."** Whenever a change adds, alters, or removes something the owner can exercise, the final report ends with concrete testing steps.

### Decisions deliberately deferred

Don't re-propose these without new information; each was considered on 2026-08-06.

- **Per-streamer announce channels/roles** — offered, owner didn't take it up. Revisit only if the owner asks for different pings per broadcaster.
- **Twitch EventSub (websocket or webhook)** — polling at 15–60s is fast enough and needs no public endpoint or user OAuth. Revisit if the owner needs sub-poll-interval latency or watches 100+ channels.
- **Serverless/interactions-only hosting** — incompatible with the gateway-bot direction. Revisit only if the bot's scope shrinks to slash-commands-only.
- **Process manager (pm2 / Task Scheduler / VPS)** — options presented, owner hasn't chosen. Ask which they want when "keeping it running" comes up; don't install one unprompted.
- **Web dashboard** — owner wants one eventually (2026-08-07); deliberately deferred until more features exist. Interim rules: every feature persists dashboard-readable JSON in `data/`, and slash commands are the interim control surface. Don't scaffold a web UI or HTTP server without the owner saying "dashboard now".
- **Database** — the `data/*.json` files are deliberate at this scale.

(The slash-command framework, deferred here until the first command feature, was decided 2026-08-07: registry + one-module-per-command in `src/features/commands/` — see Pillar 1.)

## References Routing Table

| Task involves… | Load |
|---|---|
| Anything that might not exist / memory of "how this repo works" | `references/anti-hallucination.md` |
| A request that smells like a ban, shortcut, or re-litigated decision | `references/refusal-catalog.md` |
| Writing or reviewing any TypeScript in this repo | `references/coding-patterns.md` |
| Naming, comments, logging, error-message wording | `references/code-style.md` |
| The poll loop, cooldowns, state file, announce/dedupe logic | `references/stream-notifier.md` |
| Twitch API calls, tokens, logins, rate limits, stream data | `references/twitch-api.md` |
| Running, testing, secrets, keeping the bot alive, production | `references/deployment.md` |

If a task touches multiple areas, load multiple references. Trust the routing table.
