import { Client, Events, MessageFlags, type Interaction } from "discord.js";
import { liveCommand } from "./live.js";
import { recentCommand } from "./recent.js";
import type { CommandContext, SlashCommand } from "./types.js";
import { watchCommand } from "./watch.js";

const COMMANDS: SlashCommand[] = [liveCommand, watchCommand, recentCommand];

/**
 * Slash-command registry: bulk-registers the command set on start (overwriting
 * that scope's previous set, so removals propagate within it) and routes
 * incoming interactions. Guild-scoped when DISCORD_GUILD_ID is set (instant
 * propagation); global otherwise (Discord may take up to an hour). Guild-scoped
 * boots also clear the global scope so an earlier global run can't leave
 * duplicate entries in the picker; the reverse (unsetting DISCORD_GUILD_ID)
 * can't be auto-cleaned — the old guild id is gone — so re-set it once and
 * boot if a stale guild set ever needs removing.
 */
export class CommandsFeature {
  #client: Client;
  #ctx: CommandContext;
  #byName = new Map<string, SlashCommand>();

  constructor(client: Client, ctx: CommandContext) {
    this.#client = client;
    this.#ctx = ctx;
    for (const command of COMMANDS) {
      this.#byName.set(command.data.name, command);
    }
  }

  /** Call after ClientReady — registration needs the application to be resolved. */
  async start(): Promise<void> {
    const definitions = COMMANDS.map((command) => command.data.toJSON());
    const application = this.#client.application;
    if (!application) {
      throw new Error("Client application unavailable — start() must run after ClientReady.");
    }

    const guildId = this.#ctx.config.guildId;
    if (guildId) {
      const guild = await this.#client.guilds.fetch(guildId).catch((error: unknown) => {
        throw new Error(
          `Cannot access guild ${guildId} — is DISCORD_GUILD_ID right and the bot invited? (${error instanceof Error ? error.message : String(error)})`,
        );
      });
      await guild.commands.set(definitions);
      // A previous boot without DISCORD_GUILD_ID may have registered globally —
      // clear that scope so the picker doesn't show every command twice.
      await application.commands.set([]);
      console.log(`[commands] Registered ${definitions.length} command(s) in guild ${guild.name}`);
    } else {
      await application.commands.set(definitions);
      console.log(
        `[commands] Registered ${definitions.length} global command(s) — Discord may take up to an hour to show them (set DISCORD_GUILD_ID for instant registration)`,
      );
    }

    this.#client.on(Events.InteractionCreate, this.#onInteraction);
  }

  stop(): void {
    this.#client.off(Events.InteractionCreate, this.#onInteraction);
  }

  #onInteraction = async (interaction: Interaction): Promise<void> => {
    if (!interaction.isChatInputCommand()) return;
    const command = this.#byName.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, this.#ctx);
    } catch (error) {
      console.error(`[commands] /${interaction.commandName} failed:`, error);
      const reply = {
        content: "Something went wrong running that command.",
        flags: MessageFlags.Ephemeral,
      } as const;
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(reply);
        } else {
          await interaction.reply(reply);
        }
      } catch {
        // Interaction expired — nothing left to tell the user.
      }
    }
  };
}
