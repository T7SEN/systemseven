import { Client, EmbedBuilder, type MessageCreateOptions } from "discord.js";
import type { Config } from "../config.js";
import type { TwitchStream, TwitchUser } from "../lib/twitch.js";

/** Build the go-live announcement message for a stream. */
export function buildGoLiveMessage(
  config: Config,
  stream: TwitchStream,
  user: TwitchUser | undefined,
): MessageCreateOptions {
  const url = `https://twitch.tv/${stream.user_login}`;
  const displayName = user?.display_name ?? stream.user_name;
  const thumbnail = stream.thumbnail_url.replace("{width}", "1280").replace("{height}", "720");

  const embed = new EmbedBuilder()
    .setColor(0x9146ff)
    .setAuthor({
      name: `${displayName} is now live on Twitch!`,
      iconURL: user?.profile_image_url,
      url,
    })
    .setTitle(stream.title || "Untitled stream")
    .setURL(url)
    .setImage(`${thumbnail}?t=${Date.now()}`)
    .setTimestamp(new Date(stream.started_at));

  if (stream.game_name) {
    embed.addFields({ name: "Playing", value: stream.game_name, inline: true });
  }

  const roleId = config.mentionRoleId;
  return {
    content: roleId ? `<@&${roleId}> ${displayName} just went live: ${url}` : undefined,
    embeds: [embed],
    allowedMentions: roleId ? { roles: [roleId] } : { parse: [] },
  };
}

/** Post a go-live announcement to the configured channel. */
export async function sendGoLiveMessage(
  client: Client,
  config: Config,
  stream: TwitchStream,
  user: TwitchUser | undefined,
): Promise<void> {
  const channel = await client.channels.fetch(config.announceChannelId);
  if (!channel || !channel.isSendable()) {
    throw new Error(
      `Channel ${config.announceChannelId} does not exist or the bot cannot send messages to it.`,
    );
  }
  await channel.send(buildGoLiveMessage(config, stream, user));
}
