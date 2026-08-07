import {
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { joinCapped } from "./format.js";
import type { SlashCommand } from "./types.js";

const DEFAULT_COUNT = 5;

export const recentCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("recent")
    .setDescription("Show recent go-live announcements")
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option
        .setName("count")
        .setDescription(`How many to show (default ${DEFAULT_COUNT})`)
        .setMinValue(1)
        .setMaxValue(15),
    ),

  async execute(interaction, ctx) {
    const count = interaction.options.getInteger("count") ?? DEFAULT_COUNT;
    const entries = ctx.history.list(count);

    if (entries.length === 0) {
      await interaction.reply({
        content: "No announcements recorded yet.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = entries.map((entry) => {
      const game = entry.game ? ` — ${entry.game}` : "";
      return (
        `**[${entry.displayName}](${entry.url})**${game} · <t:${Math.floor(Date.parse(entry.announcedAt) / 1000)}:R>\n` +
        (entry.title || "Untitled stream")
      );
    });

    const embed = new EmbedBuilder()
      .setColor(0x9146ff)
      .setTitle(`Recent announcements (${entries.length})`)
      .setDescription(joinCapped(lines, "entries"));

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
