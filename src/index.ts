import { Client, Events, GatewayIntentBits } from "discord.js";
import { loadConfig } from "./config.js";
import { CommandsFeature } from "./features/commands/index.js";
import { StreamNotifier } from "./features/streamNotifier.js";
import { AnnouncementHistory } from "./lib/history.js";
import { createLogger } from "./lib/logger.js";
import { TwitchClient } from "./lib/twitch.js";
import { Watchlist } from "./lib/watchlist.js";

const log = createLogger("bot");
const config = loadConfig();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const twitch = new TwitchClient(config.twitchClientId, config.twitchClientSecret);
const watchlist = new Watchlist();
const history = new AnnouncementHistory();
const notifier = new StreamNotifier(client, config, { twitch, watchlist, history });
const commands = new CommandsFeature(client, { config, twitch, watchlist, history });

client.once(Events.ClientReady, async (readyClient) => {
  log.info(`Logged in as ${readyClient.user.tag}`);
  try {
    await watchlist.load(config.broadcasterLogins);
    await history.load();
    await commands.start();
    await notifier.start();
  } catch (error) {
    log.error("Startup failed", error);
    process.exitCode = 1;
    await shutdown();
  }
});

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("Shutting down…");
  commands.stop();
  // Drain the notifier before destroying the client: an in-flight announcement
  // needs the Discord connection alive to finish sending and save its state.
  await notifier.stop();
  await client.destroy();
  process.exit();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection", reason);
});

await client.login(config.discordToken);
