import { Client, Events, GatewayIntentBits } from "discord.js";
import { loadConfig } from "./config.js";
import { StreamNotifier } from "./features/streamNotifier.js";

const config = loadConfig();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const notifier = new StreamNotifier(client, config);

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[bot] Logged in as ${readyClient.user.tag}`);
  try {
    await notifier.start();
  } catch (error) {
    console.error("[bot] Failed to start stream notifier:", error);
    process.exitCode = 1;
    await shutdown();
  }
});

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[bot] Shutting down…");
  // Drain the notifier before destroying the client: an in-flight announcement
  // needs the Discord connection alive to finish sending and save its state.
  await notifier.stop();
  await client.destroy();
  process.exit();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (reason) => {
  console.error("[bot] Unhandled rejection:", reason);
});

await client.login(config.discordToken);
