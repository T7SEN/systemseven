import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "discord.js";
import type { Config } from "../config.js";
import { TwitchClient, type TwitchStream, type TwitchUser } from "../lib/twitch.js";
import { sendGoLiveMessage } from "./announcement.js";

const STATE_FILE = path.join(process.cwd(), "data", "state.json");

interface BroadcasterState {
  /** Twitch stream id of the last stream we announced (or deliberately suppressed). */
  lastStreamId?: string;
  /** ISO timestamp of the last announcement we actually posted. */
  lastAnnouncedAt?: string;
  /** ISO timestamp of the most recent poll in which this broadcaster was seen live. */
  lastSeenLiveAt?: string;
}

interface NotifierState {
  broadcasters: Record<string, BroadcasterState>;
}

/**
 * Polls the Twitch Helix API and announces in Discord when a watched
 * broadcaster goes live.
 *
 * Re-announce protection is two-layered:
 *  - the same stream id is never announced twice (state survives restarts), and
 *  - a *new* stream id appearing within RENOTIFY_COOLDOWN_MINUTES of the
 *    broadcaster last being seen live is treated as a reconnect and suppressed.
 */
export class StreamNotifier {
  #client: Client;
  #config: Config;
  #twitch: TwitchClient;
  #state: NotifierState = { broadcasters: {} };
  #users = new Map<string, TwitchUser>();
  #timer: NodeJS.Timeout | null = null;
  #currentPoll: Promise<void> | null = null;
  #stopped = false;

  constructor(client: Client, config: Config) {
    this.#client = client;
    this.#config = config;
    this.#twitch = new TwitchClient(config.twitchClientId, config.twitchClientSecret);
  }

  async start(): Promise<void> {
    await this.#loadState();
    await this.#resolveUsers();
    try {
      await this.#runPoll();
    } catch (error) {
      // Transient Twitch/network failure at boot gets the same treatment as any
      // later poll failure: log it and let the scheduled retry handle it.
      console.error("[notifier] Initial poll failed (will retry on schedule):", error);
    }
    this.#scheduleNext();
    console.log(
      `[notifier] Watching ${this.#config.broadcasterLogins.join(", ")} every ${this.#config.pollSeconds}s`,
    );
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#currentPoll) {
      // Drain an in-flight poll so we never exit between posting an
      // announcement and persisting its dedupe record; bounded so a wedged
      // request can't hang shutdown.
      await Promise.race([
        this.#currentPoll.catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }
  }

  async #runPoll(): Promise<void> {
    this.#currentPoll = this.#poll();
    try {
      await this.#currentPoll;
    } finally {
      this.#currentPoll = null;
    }
  }

  #scheduleNext(): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(async () => {
      try {
        await this.#runPoll();
      } catch (error) {
        console.error("[notifier] Poll failed:", error);
      }
      this.#scheduleNext();
    }, this.#config.pollSeconds * 1000);
  }

  async #resolveUsers(): Promise<void> {
    try {
      const users = await this.#twitch.getUsersByLogin(this.#config.broadcasterLogins);
      for (const user of users) {
        this.#users.set(user.login.toLowerCase(), user);
      }
      const missing = this.#config.broadcasterLogins.filter((login) => !this.#users.has(login));
      if (missing.length > 0) {
        console.warn(
          `[notifier] These Twitch logins were not found and will never trigger: ${missing.join(", ")}`,
        );
      }
    } catch (error) {
      // Non-fatal: announcements still work without user records, just with less detail.
      console.warn("[notifier] Could not resolve Twitch users:", error);
    }
  }

  async #poll(): Promise<void> {
    const streams = await this.#twitch.getLiveStreams(this.#config.broadcasterLogins);
    let stateChanged = false;

    for (const stream of streams) {
      if (stream.type !== "live") continue;

      const login = stream.user_login.toLowerCase();
      const state = this.#state.broadcasters[login] ?? {};
      const now = new Date().toISOString();

      if (state.lastStreamId === stream.id) {
        // Same session still live — keep the liveness timestamp fresh so a
        // later crash+restart is measured from the drop, not the announcement.
        state.lastSeenLiveAt = now;
        this.#state.broadcasters[login] = state;
        stateChanged = true;
        continue;
      }

      const cooldownMs = this.#config.renotifyCooldownMinutes * 60_000;
      const lastSeenLive = state.lastSeenLiveAt ? Date.parse(state.lastSeenLiveAt) : 0;
      const withinCooldown = cooldownMs > 0 && Date.now() - lastSeenLive < cooldownMs;

      if (withinCooldown) {
        console.log(`[notifier] ${login} restarted stream within cooldown; not re-announcing.`);
        state.lastStreamId = stream.id;
        state.lastSeenLiveAt = now;
      } else {
        try {
          await this.#announce(stream);
          state.lastStreamId = stream.id;
          state.lastAnnouncedAt = now;
          state.lastSeenLiveAt = now;
          console.log(`[notifier] Announced ${login} (stream ${stream.id})`);
        } catch (error) {
          // Leave lastStreamId untouched so the next poll retries the announcement.
          console.error(`[notifier] Failed to announce ${login}:`, error);
          continue;
        }
      }

      this.#state.broadcasters[login] = state;
      stateChanged = true;
    }

    if (stateChanged) {
      await this.#saveState();
    }
  }

  async #announce(stream: TwitchStream): Promise<void> {
    const user = this.#users.get(stream.user_login.toLowerCase());
    await sendGoLiveMessage(this.#client, this.#config, stream, user);
  }

  async #loadState(): Promise<void> {
    try {
      const raw = await readFile(STATE_FILE, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const broadcasters = (parsed as { broadcasters?: unknown }).broadcasters;
      if (!broadcasters || typeof broadcasters !== "object" || Array.isArray(broadcasters)) return;

      // Copy field-by-field so a hand-edited or corrupt file can only ever
      // yield a structurally valid state, never a mid-poll TypeError.
      const clean: Record<string, BroadcasterState> = {};
      for (const [login, entry] of Object.entries(broadcasters)) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const { lastStreamId, lastAnnouncedAt, lastSeenLiveAt } = entry as Record<string, unknown>;
        const cleanEntry: BroadcasterState = {};
        if (typeof lastStreamId === "string") cleanEntry.lastStreamId = lastStreamId;
        if (typeof lastAnnouncedAt === "string") cleanEntry.lastAnnouncedAt = lastAnnouncedAt;
        if (typeof lastSeenLiveAt === "string") cleanEntry.lastSeenLiveAt = lastSeenLiveAt;
        clean[login] = cleanEntry;
      }
      this.#state = { broadcasters: clean };
    } catch {
      // Missing or corrupt state file — start fresh. Worst case is one duplicate announcement.
    }
  }

  async #saveState(): Promise<void> {
    try {
      await mkdir(path.dirname(STATE_FILE), { recursive: true });
      const tmpFile = `${STATE_FILE}.tmp`;
      await writeFile(tmpFile, JSON.stringify(this.#state, null, 2), "utf8");
      await rename(tmpFile, STATE_FILE);
    } catch (error) {
      console.error("[notifier] Failed to save state:", error);
    }
  }
}
