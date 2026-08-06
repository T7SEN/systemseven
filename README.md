# SystemSeven

All-in-one Discord bot for your server. Current features:

- **Twitch go-live notifications** — polls the Twitch API and posts an embed
  (with optional role ping) in a channel when a watched streamer goes live.
  Restart-safe: an ongoing stream is never announced twice, and brief stream
  drops don't re-ping the server.

## Requirements

- Node.js 18.17 or newer
- pnpm
- A Discord server where you have permission to add bots

## Setup

### 1. Create the Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Under **Bot**, click **Reset Token** and copy it — this is `DISCORD_TOKEN`.
   (No privileged gateway intents are needed.)
3. Under **Installation → Guild Install** (or OAuth2 → URL Generator), create an
   invite link with the `bot` scope and these permissions: **View Channels**,
   **Send Messages**, **Embed Links**. If you want the bot to ping a
   *non-mentionable* role, also grant **Mention @everyone, @here and All Roles**.
4. Open the invite link and add the bot to your server.

### 2. Create the Twitch app

1. Go to the [Twitch Developer Console](https://dev.twitch.tv/console/apps) and click **Register Your Application**.
2. Name it anything, set the OAuth redirect URL to `http://localhost`, category **Application Integration**.
3. Copy the **Client ID** (`TWITCH_CLIENT_ID`) and generate a **Client Secret** (`TWITCH_CLIENT_SECRET`).

### 3. Configure and run

```bash
cp .env.example .env   # then fill in the values
pnpm install
pnpm dev
```

In Discord, enable Developer Mode (User Settings → Advanced) so you can
right-click the announcement channel → **Copy Channel ID** for
`ANNOUNCE_CHANNEL_ID` (and a role → **Copy Role ID** for `MENTION_ROLE_ID`
if you want a ping).

For production, build once and run the compiled output:

```bash
pnpm build
pnpm start
```

### 4. Verify the setup

```bash
pnpm check         # validates tokens, channel access, permissions — posts nothing
pnpm test-notify   # posts a REAL test announcement (pings the role if configured)
```

`pnpm test-notify` exercises the exact code path a real go-live announcement
takes, using your real Twitch profile and a synthetic stream (or the real one
if you're live). To test the *detection* side end-to-end, temporarily set
`TWITCH_BROADCASTERS` to any channel that is live right now, run `pnpm dev`,
and watch the announcement arrive; then set it back.

## Behavior notes

- Twitch is polled every `POLL_SECONDS` (default 60), so announcements arrive
  within about a minute of going live.
- Announced stream IDs are persisted in `data/state.json`, so restarting the
  bot mid-stream won't re-announce.
- If a stream crashes and restarts within `RENOTIFY_COOLDOWN_MINUTES`
  (default 15), the new session is not re-announced.
- If the bot is started for the very first time while a stream is already
  live, that stream **is** announced (there's no prior state to compare to).

## Project layout

```
src/
  index.ts                  # entry point: Discord client + feature startup
  config.ts                 # environment loading and validation
  lib/twitch.ts             # minimal Twitch Helix API client (app token flow)
  features/streamNotifier.ts# go-live polling + announcement logic
```

New features get their own module under `src/features/` and are wired up in
`index.ts`.
