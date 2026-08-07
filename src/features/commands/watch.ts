import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { isValidTwitchLogin, normalizeTwitchLogin } from "../../lib/twitchLogins.js";
import type { SlashCommand } from "./types.js";

export const watchCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("watch")
    .setDescription("Manage the Twitch watchlist")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add a Twitch channel to the watchlist")
        .addStringOption((option) =>
          option
            .setName("channel")
            .setDescription("Twitch login name or channel URL")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove a Twitch channel from the watchlist")
        .addStringOption((option) =>
          option
            .setName("channel")
            .setDescription("Twitch login name or channel URL")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("Show the current watchlist")),

  async execute(interaction, ctx) {
    // Default member permissions only gate the UI — Discord lets server admins
    // re-expose commands, so the authorization check lives here, server-side.
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: "You need the **Manage Server** permission to manage the watchlist.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "list") {
      const logins = ctx.watchlist.list();
      await interaction.editReply(
        logins.length > 0
          ? `Watching **${logins.length}** channel${logins.length === 1 ? "" : "s"}: ${logins.map((login) => `\`${login}\``).join(", ")}`
          : "The watchlist is empty — add someone with `/watch add`.",
      );
      return;
    }

    const raw = interaction.options.getString("channel", true);
    const login = normalizeTwitchLogin(raw);
    if (!isValidTwitchLogin(login)) {
      await interaction.editReply(
        `\`${raw}\` doesn't look like a Twitch login — use the name from the channel URL (letters, numbers, underscores).`,
      );
      return;
    }

    if (subcommand === "add") {
      if (ctx.watchlist.has(login)) {
        await interaction.editReply(`Already watching \`${login}\`.`);
        return;
      }
      // Resolve before adding — catches typos while the mistake is fixable.
      const [user] = await ctx.twitch.getUsersByLogin([login]);
      if (!user) {
        await interaction.editReply(`No Twitch channel named \`${login}\` exists — check the spelling.`);
        return;
      }
      await ctx.watchlist.add(login);
      await interaction.editReply(
        `Now watching **${user.display_name}** (twitch.tv/${login}) — takes effect on the next poll.`,
      );
      return;
    }

    // remove
    const removed = await ctx.watchlist.remove(login);
    await interaction.editReply(
      removed ? `Stopped watching \`${login}\`.` : `\`${login}\` isn't on the watchlist.`,
    );
  },
};
