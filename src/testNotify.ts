import { Client, Events, GatewayIntentBits } from "discord.js";
import { loadConfig } from "./config.js";
import { TwitchClient, type TwitchStream } from "./lib/twitch.js";
import { sendGoLiveMessage } from "./features/announcement.js";

/**
 * Posts a go-live announcement through the exact same code path the notifier
 * uses, without waiting for a real stream. Run with `pnpm test-notify`.
 *
 * NOTE: this posts a real message to the announcement channel and pings the
 * mention role if one is configured.
 *
 * Uses the first configured broadcaster's real Twitch profile; if they happen
 * to be live right now, the real stream data is used, otherwise a synthetic
 * test stream is announced. Does not touch data/state.json, so it won't
 * interfere with real go-live detection.
 */

const config = loadConfig();
const login = config.broadcasterLogins[0];

const twitch = new TwitchClient(config.twitchClientId, config.twitchClientSecret);
const [user] = await twitch.getUsersByLogin([login]);
const [liveStream] = await twitch.getLiveStreams([login]);

const stream: TwitchStream = liveStream ?? {
  id: `test-${Date.now()}`,
  user_id: user?.id ?? "0",
  user_login: login,
  user_name: user?.display_name ?? login,
  game_name: "Just Chatting",
  title: "Test notification — SystemSeven is working!",
  type: "live",
  started_at: new Date().toISOString(),
  // Twitch serves an offline placeholder for this preview URL when not live.
  thumbnail_url: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-{width}x{height}.jpg`,
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const ready = new Promise<void>((resolve) => client.once(Events.ClientReady, () => resolve()));
await client.login(config.discordToken);
if (!client.isReady()) await ready;

console.log(
  liveStream
    ? `[test] "${login}" is actually live — announcing the real stream.`
    : `[test] Posting a synthetic test announcement for "${login}"…`,
);
await sendGoLiveMessage(client, config, stream, user);
console.log("[test] Announcement posted — check your Discord channel.");
await client.destroy();
process.exit(0);
