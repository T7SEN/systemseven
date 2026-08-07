import {
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { joinCapped } from "./format.js";
import type { SlashCommand } from "./types.js";

export const liveCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("live")
    .setDescription("Show which watched streamers are live right now")
    .setContexts(InteractionContextType.Guild),

  async execute(interaction, ctx) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const logins = ctx.watchlist.list();
    if (logins.length === 0) {
      await interaction.editReply("The watchlist is empty — add someone with `/watch add`.");
      return;
    }

    const streams = (await ctx.twitch.getLiveStreams(logins)).filter(
      (stream) => stream.type === "live",
    );
    if (streams.length === 0) {
      await interaction.editReply(
        `No one is live right now (watching ${logins.length} channel${logins.length === 1 ? "" : "s"}).`,
      );
      return;
    }

    const lines = streams.map((stream) => {
      const game = stream.game_name ? ` — ${stream.game_name}` : "";
      return (
        `**[${stream.user_name}](https://twitch.tv/${stream.user_login})**${game}\n` +
        `${stream.title || "Untitled stream"} · ${stream.viewer_count} viewer${stream.viewer_count === 1 ? "" : "s"} · started <t:${Math.floor(Date.parse(stream.started_at) / 1000)}:R>`
      );
    });

    const embed = new EmbedBuilder()
      .setColor(0x9146ff)
      .setTitle(`Live now (${streams.length})`)
      .setDescription(joinCapped(lines, "live"));

    await interaction.editReply({ embeds: [embed] });
  },
};
