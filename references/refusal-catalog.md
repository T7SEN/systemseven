# Refusal Catalog (Full)

Refuse immediately with the rationale; offer the sanctioned alternative. Do not implement, do not ask for clarification, do not try a workaround. Bans keep their reasons attached because a ban without a rationale gets eroded by future agents.

## Package management & tooling

| Request | Refusal + alternative |
|---|---|
| `npm install X`, `npx …`, `yarn …` | Owner explicitly chose pnpm (2026-08-06, after npm was used without asking — this is standing feedback, not a style preference). Use `pnpm add X` / `pnpm exec …`. |
| Re-adding `package-lock.json` | Two lockfiles cause split-brain installs. `pnpm-lock.yaml` only. |
| "Add eslint / prettier / jest / vitest / CI" | Not banned forever — but tooling decisions belong to the owner. Ask first with a concrete proposal; never add as a ride-along. |
| "Upgrade dependencies while you're in there" | Upgrades are separate owner-approved changes. Real churn already absorbed here: pnpm 11 stopped reading the package.json `pnpm` field mid-migration, and discord.js 14 renamed `ready`→`clientReady`. |
| `"pnpm"` config block in package.json | pnpm 11 ignores it. Settings live in `pnpm-workspace.yaml`. |

## Architecture

| Request | Refusal + alternative |
|---|---|
| "Use EventSub webhooks for instant notifications" | Requires a public HTTPS endpoint the owner doesn't run. Deferred decision — revisit only for sub-poll-interval latency needs or 100+ watched channels. Polling via `src/lib/twitch.ts` is the sanctioned path. |
| "Use EventSub websockets" | Requires a *user* access token (OAuth flow + refresh handling) vs. the current zero-interaction app token. Same deferral as above. |
| "Host it on Vercel / Cloudflare Workers / Lambda" | A gateway bot holds a persistent WebSocket; request-scoped runtimes can't. Rejected at project start; the direction is always-on process (PC now, maybe VPS later). |
| "Add a database / SQLite / Redis for state" | The `data/*.json` files (state, watchlist, history — atomic writes and sanitized loads via `src/lib/jsonFile.ts`) are deliberate at one-server scale. Revisit when a feature actually outgrows them. |
| "Split into microservices / add a message queue" | One process, one server, one owner. Complexity without a payer. |
| "Add an HTTP server / health endpoint" | The bot deliberately binds no ports (no attack surface, no port conflicts). If liveness monitoring is wanted, propose it to the owner as its own feature. |

## Discord surface

| Request | Refusal + alternative |
|---|---|
| "Add MessageContent / GuildMembers / GuildPresences intent" | Privileged intents need Discord-side justification at scale and expand data access. No current feature consumes them. Requires a consuming feature + explicit owner approval. |
| "Request Administrator permission to keep it simple" | The invite grants View Channel, Send Messages, Embed Links (+ Mention Everyone only when the configured mention role isn't mentionable). Least privilege is the standing policy. |
| "Drop allowedMentions, the content is safe" | Explicit `allowedMentions` on every send is what makes accidental `@everyone` injection via stream titles impossible. Non-negotiable. |
| "Skip the isSendable / permission checks" | Unchecked sends turn a misconfigured channel into a crash-looping poller instead of one clear log line. |

## Process & safety

| Request | Refusal + alternative |
|---|---|
| "Run `pnpm test-notify` to verify" (agent-initiated) | It posts a real message and pings a real role on the owner's live server. Only the owner triggers it, or gives explicit per-run approval. `pnpm check` is the side-effect-free validator. |
| "Commit `.env` / paste the token into code / log the token" | Live Discord + Twitch credentials. `.env` is gitignored; `.env.example` is the shareable shape. Secrets (tokens, client secret) never appear in logs. |
| "Delete `data/state.json` to reset" | If a watched stream is live, deletion causes a duplicate announcement. Only delete deliberately, with the owner aware of that consequence. |
| "Read process.env directly in my new feature" | Fail-fast config is a pillar: every var is validated in `src/config.ts` and arrives typed. Inline env reads are how silent misconfigurations happen. |
| "The UI/Discord hides the button, so skip the server-side check" | Live rule since slash commands landed (2026-08-07): `setDefaultMemberPermissions` is UI gating that server admins can re-expose in Integrations settings — `/watch` enforces ManageGuild inside `execute()` (`src/features/commands/watch.ts`), and every future privileged command does the same. |

## Deferred decisions (do not re-propose without new evidence)

Mirrored from `AGENTS.md`: per-streamer channels/roles; EventSub (either transport); serverless hosting; process manager choice (pm2 vs Task Scheduler vs VPS — ask the owner when relevant, don't install); web dashboard (owner wants one eventually — deferred until more features exist; meanwhile features persist dashboard-readable JSON in `data/` and slash commands are the control surface); database. The slash-command framework question was settled 2026-08-07: registry + one-module-per-command in `src/features/commands/`.
