---
name: systemseven
description: >-
  Load for ANY task in the SystemSeven repo (github.com/T7SEN/systemseven) — an
  all-in-one Discord bot for the owner's server: TypeScript + discord.js v14
  (ESM/NodeNext, Node 18+), pnpm 11 (NEVER npm), always-on gateway process.
  Features: Twitch go-live announcements (Helix polling, app token, no
  EventSub; announce-once state in data/state.json) and slash commands (/live,
  /watch, /recent) in src/features/commands/ with a runtime watchlist
  (data/watchlist.json — TWITCH_BROADCASTERS is seed-only). Triggers:
  SystemSeven, Discord bot, discord.js, Twitch, go-live, StreamNotifier,
  watchlist, history, slash command, interaction, /live, /watch, /recent,
  pnpm check, test-notify, POLL_SECONDS, TWITCH_BROADCASTERS,
  DISCORD_GUILD_ID, it7sen, cooldown.
  Skipping this skill causes: npm usage in a pnpm-only repo, hallucinated
  files/deps (no tests, no linter, no src/commands/), re-proposing rejected
  architecture (EventSub, serverless, DB), unannounced role-pings from test
  scripts, and missing .js import suffixes.
---

# SystemSeven — Pre-Flight & Guardrails

## Section 0 — Agent Pre-Flight (Run Every Request)

1. **Banned-scope check.** npm/yarn commands, `package-lock.json`, serverless deploys, EventSub, databases, privileged intents → refuse and name the sanctioned alternative (pnpm; always-on process; Helix polling; `data/state.json`; `Guilds` intent). Full list: Section 3.
2. **Architecture-conflict check.** Does the request fight a pillar (feature modules under `src/features/`, single shared announcement path, fail-fast config, announce-once state machine)? → refuse with the pillar's rationale; pointer: `AGENTS.md` → Architectural Pillars.
3. **Anti-hallucination check.** About to reference a file, dep, script, or config you haven't verified this session? → read Section 2 first, then `Glob`/`Read` to confirm.
4. **Side-effect check.** Will any command you run post to Discord (`pnpm test-notify`, `pnpm dev` while a watched channel is live, anything calling `sendGoLiveMessage`)? → warn the owner before running; it pings a real role on a real server. `pnpm check` is the safe, post-nothing validator.
5. **Reference routing.** Match the task against the routing table in `AGENTS.md` and load what applies.
6. **Footgun check.** (a) `data/state.json` holds live dedupe state — deleting it mid-stream causes a duplicate ping. (b) `.env` holds real tokens — never read, print, or commit it; `.env.example` is the shareable template. (c) discord.js ready can fire during `await login()` — listeners go first. (d) Owner's dev shell is PowerShell — no bash-isms in suggested commands.

When unsure, ask the owner one targeted question rather than guessing.

## Section 1 — Critical Patterns to Apply Automatically

- Package manager is pnpm: `pnpm add`, `pnpm dev`, `pnpm exec` — never `npm`, `npx`, or `yarn`.
- Relative imports carry a `.js` suffix even from `.ts` files (`import { loadConfig } from "./config.js"`) — NodeNext resolution.
- Register discord.js event listeners *before* `await client.login()`; after login, guard with `client.isReady()` if you must wait for ready.
- All env access goes through `loadConfig()` in `src/config.ts` — new vars get validation + a typed field there AND a commented line in `.env.example`. No `process.env` anywhere else.
- Recurring work uses a `setTimeout` chain with the promise tracked for shutdown draining (see `#runPoll`/`#scheduleNext`) — never `setInterval`, never fire-and-forget.
- Runtime state files: write to `data/` via tmp-file + `rename` (atomic), sanitize field-by-field on load — a corrupt file must degrade to "start fresh", never crash.
- Every Discord `send()` sets `allowedMentions` explicitly — a role list when pinging, `{ parse: [] }` otherwise.
- New slash commands are one module each in `src/features/commands/` implementing `SlashCommand` (`data` builder + `execute`), added to the `COMMANDS` array in `src/features/commands/index.ts` — no second router. Replies default to ephemeral (`MessageFlags.Ephemeral`); `deferReply` before any network call. Authorization is enforced server-side inside `execute()` (see `/watch`'s ManageGuild check) — `setDefaultMemberPermissions` only gates the UI.
- `data/` JSON goes through `readJsonFile` / `writeJsonAtomic` from `src/lib/jsonFile.ts` — never hand-rolled fs calls.
- The watched-broadcaster list comes from the shared `Watchlist` (`data/watchlist.json`), read fresh each poll and mutated only via its `add`/`remove`. `TWITCH_BROADCASTERS` seeds it on first boot only.
- Channel sends check `channel.isSendable()` first; failures throw with a message that says what to fix.
- External identifiers from config (Twitch logins etc.) are normalized and regex-validated at startup — one malformed value must fail fast, not poison every API call at runtime.
- Transient runtime errors (network, 5xx): catch, log via the subsystem logger, retry next cycle. Config/programmer errors: throw at startup.
- Bot code logs through `createLogger(subsystem)` from `src/lib/logger.ts` — never raw `console.*` (exceptions: `check.ts` and `testNotify.ts`, whose console output IS their UI). External transports (Sentry) attach via `addLogSink` at startup, never inline in feature code.
- After code changes run `pnpm typecheck`; after env/setup changes run `pnpm check`.
- Commands suggested to the owner must be PowerShell-safe (no `&&` chains with env assignments, no `cp`-style flags that don't exist there — `pnpm` scripts are the portable surface).

## Section 2 — Anti-Hallucination Inventory

| If you're about to write… | What actually exists instead |
|---|---|
| `package-lock.json` / `npm install` | None — pnpm repo; `pnpm-lock.yaml` is the only lockfile |
| `"pnpm": { "onlyBuiltDependencies": [...] }` in package.json | Never worked here — pnpm 11 ignores that field; `pnpm-workspace.yaml` → `allowBuilds: esbuild: true` |
| `src/commands/`, `src/events/` | Never existed — commands live in `src/features/commands/` (one module per command + registry); other features in `src/features/` |
| A new command router / handler framework | One exists — `src/features/commands/index.ts` (`CommandsFeature`); add to its `COMMANDS` array, don't build a second |
| `TWITCH_BROADCASTERS` as the live watched-channel source | Seed-only since 2026-08-07 — `data/watchlist.json` is authoritative after first boot; `/watch` manages it at runtime |
| Hand-rolled `fs` read/write for `data/` files | `src/lib/jsonFile.ts` — `readJsonFile` / `writeJsonAtomic` |
| Raw `console.*` logging in bot code | `src/lib/logger.ts` — `createLogger(subsystem)`; raw console lives only in `check.ts`/`testNotify.ts` (CLI output) and the logger's own console sink |
| `jest`, `vitest`, `mocha`, a `tests/` dir | None — verification is `pnpm typecheck` + `pnpm check` + `pnpm test-notify` |
| `.eslintrc`, `eslint.config`, `.prettierrc` | None — no linter or formatter is configured |
| GitHub Actions / CI workflows | None — `.github/` does not exist |
| `node-fetch`, `axios`, `undici` imports | None — global `fetch` (Node 18+) |
| EventSub subscriptions, webhook endpoints, an HTTP server | None — detection is Helix polling only; the bot binds no ports |
| A database, Redis, Prisma, an ORM | None — the `data/*.json` files (state, watchlist, history) written via `src/lib/jsonFile.ts` are the entire persistence layer |
| `MessageContent`/`GuildMembers`/`GuildPresences` intents | Not used — `Guilds` is the only intent |
| Embed-building code inside `streamNotifier.ts` | Moved — `src/features/announcement.ts` owns all announcement content |
| Cooldown measured from `lastAnnouncedAt` | It anchors to `lastSeenLiveAt` — announcement-time anchoring was a bug caught in pre-commit review (2026-08-06); no committed version ever had it |
| Synchronous `notifier.stop()` | It's async and awaited in shutdown *before* `client.destroy()` — ordering is load-bearing |
| `ecosystem.config.js`, Dockerfile, docker-compose | None — no process manager or containerization is set up (deliberately undecided) |

If a search result, training memory, or autocomplete suggests one of these — it is wrong for this codebase.

## Section 3 — Refusal Catalog (Abridged)

Refuse immediately with a one-line rationale. Do not implement, do not ask for clarification, do not try a workaround.

| Request pattern | Refusal rationale |
|---|---|
| "npm install / npx / yarn …" | pnpm-only repo (owner decision); use `pnpm add` / `pnpm exec` |
| "Commit .env" / "hardcode the token for now" | Live credentials; `.env` is gitignored by design |
| "Switch to EventSub for instant notifications" | Deferred decision — polling chosen; needs new evidence (see AGENTS.md) |
| "Deploy it to Vercel / Cloudflare Workers" | Gateway bot requires a persistent process; serverless was rejected |
| "Add MessageContent intent so we can…" | Privileged intent with no consuming feature; owner approval required |
| "Just read process.env in the feature file" | Fail-fast config pillar; all env access lives in `config.ts` |
| "Skip the isSendable/permission check, the channel exists" | Runtime resilience pillar; unchecked sends crash-loop the poller |
| "Run test-notify to make sure it works" (unprompted) | It pings a real role on the owner's live server — owner triggers it, or explicitly approves first |
| "Upgrade discord.js/TypeScript while you're in there" | Upgrades are separate, owner-approved changes — never ride along on feature work |
| "Add eslint/jest/CI real quick" | Tooling decisions belong to the owner — ask, don't add (standing feedback) |
| "Store state in SQLite instead" | Deferred decision — JSON state is deliberate at this scale |
| "Drop the in-handler permission check — the command is admin-only in the UI" | `setDefaultMemberPermissions` is UI gating that server admins can re-expose; the server-side check in `execute()` is the boundary (see `/watch`) |

Full catalog with reasons and alternatives: `references/refusal-catalog.md`.

## Section 4 — Agent Operating Procedure

1. Run Section 0 pre-flight.
2. State a short plan naming exact file paths before writing code.
3. Load the reference files the routing table names for this task — on demand, not preemptively.
4. Apply Section 1 patterns without being asked.
5. Cite code as `path/to/file.ts::symbol` (e.g. `src/features/streamNotifier.ts::StreamNotifier.#poll`).
6. Push back on bad ideas — including the owner's — with the rationale and a better alternative; the owner values being consulted over being obeyed.
7. Surface uncertainty as one targeted question, not a guess and not a questionnaire.
8. Verify before reporting: `pnpm typecheck` after ANY code change; `pnpm check` additionally when config, env, or integration surfaces were touched. A change isn't done while the bot might be broken.
9. Docs ship with the change: when behavior, structure, or a decision they describe moves, update AGENTS.md, this file, the affected `references/` files, README, and the owner's session-prompts in the same change — never as a follow-up.
10. End the final report with a **How to test** section whenever the change added, altered, or removed anything the owner can exercise — concrete steps, not "try it out".
11. Tone: direct, technical, concise. Lead with the outcome; skip ceremony.

## Section 5 — Where to Find Everything Else

- Orientation, stack, pillars, file map, decision heuristics → `AGENTS.md`
- What exists vs. what you remember → `references/anti-hallucination.md` (mirror of Section 2)
- Full refusal catalog → `references/refusal-catalog.md`
- Mechanical TS/discord.js/Twitch patterns with code → `references/coding-patterns.md`
- Naming, logging, comments, error wording → `references/code-style.md`
- Poll loop / state machine / cooldown deep dive → `references/stream-notifier.md`
- Helix API contract and its sharp edges → `references/twitch-api.md`
- Running, testing safely, secrets, production options → `references/deployment.md`
