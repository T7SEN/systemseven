import { Client, Events, GatewayIntentBits, PermissionFlagsBits } from "discord.js";
import { loadConfig } from "./config.js";
import { TwitchClient } from "./lib/twitch.js";

/**
 * Setup doctor: validates the whole .env chain — Twitch credentials and
 * broadcaster names, Discord token, announcement channel access and
 * permissions, mention role — without posting anything. Run with `pnpm check`.
 */

let failed = false;
const ok = (message: string) => console.log(`  OK   ${message}`);
const bad = (message: string) => {
  failed = true;
  console.log(`  FAIL ${message}`);
};
const info = (message: string) => console.log(`  --   ${message}`);

const config = loadConfig();

console.log("[check] Twitch");
const twitch = new TwitchClient(config.twitchClientId, config.twitchClientSecret);
let liveNow: string[] = [];
try {
  const users = await twitch.getUsersByLogin(config.broadcasterLogins);
  ok("client ID + secret are valid");
  const found = new Set(users.map((user) => user.login.toLowerCase()));
  for (const login of config.broadcasterLogins) {
    if (found.has(login)) ok(`broadcaster "${login}" exists on Twitch`);
    else bad(`broadcaster "${login}" was not found on Twitch — check the spelling`);
  }
  const streams = await twitch.getLiveStreams(config.broadcasterLogins);
  liveNow = streams.map((stream) => stream.user_login);
  for (const login of liveNow) info(`"${login}" is live right now`);
} catch (error) {
  bad(`Twitch API: ${error instanceof Error ? error.message : String(error)}`);
}

console.log("[check] Discord");
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
try {
  // Register before login: the ready event can fire while login() is awaited.
  const ready = new Promise<void>((resolve) => client.once(Events.ClientReady, () => resolve()));
  await client.login(config.discordToken);
  if (!client.isReady()) {
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("timed out waiting for the gateway")), 30_000).unref();
      }),
    ]);
  }
  ok(`bot token is valid — logged in as ${client.user?.tag}`);

  const channel = await client.channels.fetch(config.announceChannelId).catch((error: unknown) => {
    bad(
      `cannot access channel ${config.announceChannelId}: ${
        error instanceof Error ? error.message : String(error)
      } — is the bot invited to the server, and is the channel ID right?`,
    );
    return null;
  });

  if (channel) {
    if (!channel.isSendable() || channel.isDMBased()) {
      bad(`channel ${config.announceChannelId} is not a text channel the bot can post in`);
    } else {
      ok(`announcement channel found: #${channel.name}`);
      const me = channel.guild.members.me;
      const permissions = me ? channel.permissionsFor(me) : null;
      if (!permissions) {
        bad("could not resolve the bot's permissions in that channel");
      } else {
        for (const [flag, label] of [
          [PermissionFlagsBits.ViewChannel, "View Channel"],
          [PermissionFlagsBits.SendMessages, "Send Messages"],
          [PermissionFlagsBits.EmbedLinks, "Embed Links"],
        ] as const) {
          if (permissions.has(flag)) ok(`permission: ${label}`);
          else bad(`missing permission in that channel: ${label}`);
        }

        if (config.mentionRoleId) {
          const role = await channel.guild.roles.fetch(config.mentionRoleId).catch(() => null);
          if (!role) {
            bad(`mention role ${config.mentionRoleId} was not found in that server`);
          } else if (!role.mentionable && !permissions.has(PermissionFlagsBits.MentionEveryone)) {
            bad(
              `role @${role.name} is not mentionable and the bot lacks the ` +
                `"Mention @everyone, @here and All Roles" permission — the ping would silently not notify anyone`,
            );
          } else {
            ok(`mention role @${role.name} can be pinged`);
          }
        } else {
          info("no mention role configured — announcements won't ping anyone");
        }
      }
    }
  }
} catch (error) {
  bad(`Discord login failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await client.destroy();
}

if (failed) {
  console.log("\n[check] Problems found — fix the FAIL lines above and re-run `pnpm check`.");
} else {
  console.log("\n[check] Everything looks good. Start the bot with `pnpm dev`.");
  if (liveNow.length > 0) {
    console.log(
      `[check] Note: ${liveNow.join(", ")} is live RIGHT NOW — starting the bot for the first time will announce that stream immediately.`,
    );
  }
}
process.exit(failed ? 1 : 0);
