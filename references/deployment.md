# Running, Testing & Deployment

## Run modes

| Command | What it does |
|---|---|
| `pnpm dev` | `tsx watch src/index.ts` — dev loop with restart-on-save |
| `pnpm build` + `pnpm start` | `tsc` to `dist/`, then `node dist/index.js` — production mode |
| `pnpm typecheck` | `tsc --noEmit` — run after any code change |
| `pnpm check` | Setup doctor. Validates Twitch creds → effective watchlist names (file if present, env seed otherwise) → Discord token → slash-command guild (when `DISCORD_GUILD_ID` set) → channel access → per-channel permissions → role pingability. **Posts nothing.** Safe to run anytime. |
| `pnpm test-notify` | Posts a **real announcement** (pings the mention role if configured) through the production code path. Owner-triggered only. |

## Environment

- `.env` (gitignored) holds live credentials: `DISCORD_TOKEN`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, plus `ANNOUNCE_CHANNEL_ID`, `MENTION_ROLE_ID` (optional), `DISCORD_GUILD_ID` (optional — instant slash-command registration when set, global with up-to-1h delay otherwise), `TWITCH_BROADCASTERS` (comma-separated logins — watchlist SEED on first boot only; `/watch` manages it afterward and the var may then be left empty), `POLL_SECONDS` (default 60, min 15), `RENOTIFY_COOLDOWN_MINUTES` (default 15).
- `.env.example` is the documented template — every new var gets a commented entry there and validation in `src/config.ts`.
- Secrets hygiene: never read/print `.env` contents, never log config values, never commit credentials. If a token leaks, reset it in the respective developer portal (Discord: bot token reset; Twitch: new client secret) and update `.env`.

## Discord-side setup (for reference when things break)

- Invite needs: View Channel, Send Messages, Embed Links; plus "Mention @everyone, @here and All Roles" **only** if the configured mention role isn't itself mentionable.
- A private announcement channel needs a channel-level permission override for the bot's role — the server-wide invite grant isn't enough. `pnpm check` reports this as a channel-access FAIL.
- No privileged gateway intents are used, so the Developer Portal intent toggles stay off.

## Keeping it running (deliberately undecided)

The bot currently runs in a foreground `pnpm dev` on the owner's Windows 11 PC. Options that were presented but **not chosen** — ask the owner rather than picking one:

- **pm2**: `pnpm build` then `pm2 start dist/index.js --name systemseven`; survives crashes, needs pm2 itself launched at boot (`pm2 startup` equivalent on Windows is clunky).
- **Windows Task Scheduler**: run at logon/boot; native but no crash-restart loop.
- **A VPS / small always-on box**: the code is host-agnostic (no Windows dependencies); moving is copy + `pnpm install` + `.env`.

There is no Dockerfile, no pm2 config, no service definition in the repo — that's intentional until the owner picks.

## State file operations

Three runtime artifacts live in `data/` (all gitignored, all safe to inspect, all written atomically):

- `data/state.json` — announce-dedupe state. Deleting it while the bot is **running** is harmless — state is authoritative in memory after startup and the file is rewritten on the next change. Deleting it while the bot is **stopped** (or migrating hosts without it) while a watched stream is live = one duplicate announcement at next startup.
- `data/watchlist.json` — the authoritative watched-channel list. Deleting it (bot stopped) causes a re-seed from `TWITCH_BROADCASTERS` on next boot, losing any `/watch` changes. An empty `logins` array is a valid state (everyone removed), not corruption. A *corrupt* file is never re-seeded over: it's backed up to `watchlist.json.bad` and the bot starts with an empty list until fixed.
- `data/history.json` — rolling announcement log (cap 50) behind `/recent`. Freely deletable; only cosmetic history is lost.
- Migrating hosts: copy the whole `data/` directory with the bot stopped.

## Failure triage

1. Bot won't start, config error in console → the error message names the exact env var and fix.
2. Starts but no announcements → `pnpm check`; it isolates Twitch creds vs. broadcaster names vs. channel access vs. permissions.
3. Announcements but no ping → role not mentionable and bot lacks Mention Everyone permission (`pnpm check` flags exactly this), or `MENTION_ROLE_ID` unset.
4. Duplicate announcements → state file was deleted/unwritable, or two bot processes are running (check for a forgotten `pnpm dev` alongside pm2/production).
