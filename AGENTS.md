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
- **Testing/CI**: none — verification is `pnpm typecheck`, `pnpm check` (setup doctor), `pnpm test-notify` (live-fire announcement test)

Common drift traps are inventoried in **SKILL.md Section 2** — the top offenders: `package-lock.json` (removed), `pnpm.onlyBuiltDependencies` in package.json (never worked here — pnpm 11 ignores it), `src/commands/`–`src/events/` folder conventions (never existed), node-fetch (global fetch is used), any test framework or linter config (none exists).

## Architectural Pillars

Do not paraphrase from memory — load the reference when the work touches that pillar.

### 1. Feature-module pattern
Every bot capability is a self-contained module (usually a class) under `src/features/`, constructed and started from `src/index.ts` — no plugin framework, no dynamic loading, no `src/commands/` convention. A feature owns its own state, scheduling, and persistence; `index.ts` only wires it to the shared `Client` and `Config`. New features copy the shape of `StreamNotifier` (constructor takes `client, config`; `start()`; async `stop()`). → `references/coding-patterns.md`

### 2. Twitch detection is Helix polling with an app token
`src/lib/twitch.ts` is a minimal Helix client using the client-credentials flow: lazy token fetch, refresh 60s before expiry, one forced-refresh retry on 401. Detection is `GET /streams` polling (chunked ≤100 logins per request) every `POLL_SECONDS`. There is no user OAuth, no EventSub, no webhook server. Malformed logins make Helix 400 the *entire* request, which is why `config.ts` normalizes (`@name`, `twitch.tv/name` → `name`) and validates (`/^[a-z0-9_]{1,25}$/`) at startup. → `references/twitch-api.md`

### 3. Announce-once state machine
A stream id is never announced twice: `data/state.json` (atomic tmp+rename writes, sanitized on load) records `lastStreamId`, `lastAnnouncedAt`, and `lastSeenLiveAt` per login. The re-notify cooldown is anchored to `lastSeenLiveAt` — the last poll where the broadcaster was seen live — NOT to the announcement time; anchoring to announcement time was a real bug caught in pre-commit review (a stream crashing 2h in would have re-pinged). A failed announcement leaves `lastStreamId` unset so the next poll retries. → `references/stream-notifier.md`

### 4. One shared announcement path
`src/features/announcement.ts` (`buildGoLiveMessage` + `sendGoLiveMessage`) is the only place announcement content exists. The real notifier and `pnpm test-notify` both call it, so tests can never drift from production behavior. Never inline embed-building anywhere else. → `references/coding-patterns.md`

### 5. Fail-fast config, resilient runtime
Anything wrong in `.env` throws at startup with an actionable message (`src/config.ts` is the only file that touches `process.env`). Anything transient at runtime — Twitch 500s, network blips, Discord hiccups — is caught, logged with a `[notifier]`-style prefix, and retried on the next cycle; the process never crashes over a transient error. Shutdown drains the in-flight poll (bounded 10s) *before* destroying the client so an announcement is never posted without its dedupe record being saved. → `references/stream-notifier.md`

### 6. Minimal Discord surface
`Guilds` intent only; permissions requested at invite are View Channel, Send Messages, Embed Links (+ Mention Everyone, needed only when the configured mention role isn't itself mentionable). Every `send()` sets `allowedMentions` explicitly. Widening intents or permissions is a design decision for the owner, not an implementation detail. → `references/coding-patterns.md`

## Code Style / Patterns Summary

TypeScript strict; native `#private` class fields; `interface` for shapes; no classes where a function does the job. Log lines are prefixed `[bot]` / `[notifier]` / `[check]` / `[test]`. Error messages tell the user what to *do*, not just what broke. Comments state constraints the code can't (why the ready-listener order matters, why writes are atomic) — never narrate the next line. Details: `references/code-style.md`; mechanical rules agents must apply: SKILL.md Section 1.

## File Map

```
src/
  index.ts                 # entry: builds Client (Guilds only), wires ClientReady → notifier.start(),
                           #   re-entry-guarded shutdown on SIGINT/SIGTERM (drain notifier THEN destroy)
  config.ts                # loadConfig(): the ONLY process.env access; validation + Twitch login
                           #   normalization; throws actionable errors at startup
  check.ts                 # `pnpm check` setup doctor: validates Twitch creds, broadcaster names,
                           #   Discord token, channel access + permissions, role pingability. Posts NOTHING.
  testNotify.ts            # `pnpm test-notify`: posts a REAL announcement via the shared path
                           #   (pings the mention role!). Uses synthetic stream unless actually live.
  lib/
    twitch.ts              # Helix client: app-token lifecycle, 401 retry, getUsersByLogin /
                           #   getLiveStreams (chunked ≤100), TwitchUser/TwitchStream types
  features/
    streamNotifier.ts      # the poll loop + announce-once state machine + data/state.json persistence
    announcement.ts        # buildGoLiveMessage/sendGoLiveMessage — the ONLY announcement content source
data/state.json            # runtime state (gitignored): per-login lastStreamId/lastAnnouncedAt/lastSeenLiveAt.
                           #   Deleting it mid-stream causes ONE duplicate announcement.
pnpm-workspace.yaml        # allowBuilds: esbuild — pnpm 11's build-script approval (NOT package.json "pnpm")
.env.example               # env template with comments; real .env is gitignored and holds live tokens
```

## Decision Heuristics

1. About to run `npm` or `npx` anything? → Refuse; use `pnpm` / `pnpm exec`.
2. Adding a dependency, linter, test framework, or CI? → Ask the owner first. Tooling choices are theirs (this is standing feedback, learned the hard way with npm-vs-pnpm).
3. Tempted to propose EventSub, serverless, or a database? → Check Deferred Decisions below; don't re-propose without new evidence.
4. Building a new feature? → New module in `src/features/`, wired in `index.ts`, config through `config.ts`. Copy `StreamNotifier`'s lifecycle shape.
5. Touching announcement content? → Edit `src/features/announcement.ts` only; verify with `pnpm test-notify` (warn the owner first — it pings).
6. Changing `BroadcasterState`? → Update the `#loadState` sanitizer in the same change; existing `data/state.json` files must load cleanly.
7. About to run a script that posts to Discord? → Tell the owner before running; announcements ping a real role on a real server.
8. Need a new env var? → Add to `config.ts` (validated, typed) AND `.env.example` (commented). Never `process.env` elsewhere.
9. Need a privileged intent or wider permission? → Stop; that's an owner decision. Name the feature that requires it.
10. Unsure whether something exists in this repo? → SKILL.md Section 2 before writing code that references it.

### Decisions deliberately deferred

Don't re-propose these without new information; each was considered on 2026-08-06.

- **Per-streamer announce channels/roles** — offered, owner didn't take it up. Revisit only if the owner asks for different pings per broadcaster.
- **Twitch EventSub (websocket or webhook)** — polling at 15–60s is fast enough and needs no public endpoint or user OAuth. Revisit if the owner needs sub-poll-interval latency or watches 100+ channels.
- **Serverless/interactions-only hosting** — incompatible with the gateway-bot direction. Revisit only if the bot's scope shrinks to slash-commands-only.
- **Process manager (pm2 / Task Scheduler / VPS)** — options presented, owner hasn't chosen. Ask which they want when "keeping it running" comes up; don't install one unprompted.
- **Slash-command framework** — no commands exist yet; the pattern gets decided when the first command feature lands, not before.
- **Database** — `data/state.json` is deliberate at this scale.

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
