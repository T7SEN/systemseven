import type { ChatInputCommandInteraction, RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import type { Config } from "../../config.js";
import type { AnnouncementHistory } from "../../lib/history.js";
import type { TwitchClient } from "../../lib/twitch.js";
import type { Watchlist } from "../../lib/watchlist.js";

/** Shared services a command may use. Commands never construct their own. */
export interface CommandContext {
  config: Config;
  twitch: TwitchClient;
  watchlist: Watchlist;
  history: AnnouncementHistory;
}

export interface SlashCommand {
  /** Any SlashCommandBuilder chain — only name + JSON serialization are needed. */
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void>;
}
