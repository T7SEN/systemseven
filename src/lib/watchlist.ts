import { rename } from "node:fs/promises";
import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "./jsonFile.js";
import { isValidTwitchLogin, normalizeTwitchLogin } from "./twitchLogins.js";

const WATCHLIST_FILE = path.join(process.cwd(), "data", "watchlist.json");

export interface WatchlistLoadOptions {
  /** Set false for read-only tooling (check, test-notify): never writes the seed file. */
  persistSeed?: boolean;
}

/**
 * The authoritative set of watched Twitch logins.
 *
 * Seeded from TWITCH_BROADCASTERS the first time the bot runs (no file yet);
 * from then on data/watchlist.json rules and env changes are ignored — the
 * list is managed at runtime via /watch. An existing-but-empty file is a
 * valid state (everyone was removed), not a trigger to re-seed. A present
 * but corrupt file is NEVER overwritten by the seed: it's backed up to
 * watchlist.json.bad and the session starts empty, so /watch-managed data
 * can't be silently destroyed by a hand-edit typo.
 */
export class Watchlist {
  #logins = new Set<string>();
  #loadedFromFile = false;
  #saveChain: Promise<void> = Promise.resolve();

  async load(seed: string[], options: WatchlistLoadOptions = {}): Promise<void> {
    const persistSeed = options.persistSeed !== false;
    const result = await readJsonFile(WATCHLIST_FILE);

    if (result.state === "ok") {
      const parsed = result.value;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const raw = (parsed as { logins?: unknown }).logins;
        if (Array.isArray(raw)) {
          const clean = raw
            .filter((login): login is string => typeof login === "string")
            .map(normalizeTwitchLogin)
            .filter(isValidTwitchLogin);
          this.#logins = new Set(clean);
          this.#loadedFromFile = true;
          console.log(`[watchlist] Loaded ${this.#logins.size} watched login(s) from data/watchlist.json`);
          return;
        }
      }
    }

    if (result.state !== "missing") {
      // Present but corrupt/malformed — the /watch-managed list is more precious
      // than the stale env seed, so preserve the evidence and refuse to re-seed.
      console.error(
        "[watchlist] data/watchlist.json exists but is corrupt or malformed — NOT re-seeding from " +
          "TWITCH_BROADCASTERS. Backing it up to watchlist.json.bad and starting with an empty list; " +
          "restore or /watch add your channels.",
      );
      await rename(WATCHLIST_FILE, `${WATCHLIST_FILE}.bad`).catch((error: unknown) => {
        console.error("[watchlist] Could not back up the corrupt file:", error);
      });
      this.#logins = new Set();
      return;
    }

    // No file yet — seed from env.
    this.#logins = new Set(seed);
    if (seed.length === 0) {
      // Don't write an empty file: leaving it absent keeps a later env seed viable.
      console.warn(
        "[watchlist] No watchlist file and TWITCH_BROADCASTERS is empty — watching nobody. " +
          "Add channels with /watch add (or set TWITCH_BROADCASTERS and restart).",
      );
      return;
    }
    if (!persistSeed) {
      console.log("[watchlist] No data/watchlist.json; using TWITCH_BROADCASTERS in memory only");
      return;
    }
    try {
      await this.#save();
      console.log(
        `[watchlist] Seeded ${seed.length} login(s) from TWITCH_BROADCASTERS; ` +
          `data/watchlist.json is now authoritative — manage it with /watch`,
      );
    } catch (error) {
      // In-memory list still works this session; seeding retries next boot.
      console.error("[watchlist] Failed to write seed file:", error);
    }
  }

  /** True when the list came from data/watchlist.json rather than the env seed. */
  get loadedFromFile(): boolean {
    return this.#loadedFromFile;
  }

  list(): string[] {
    return [...this.#logins];
  }

  has(login: string): boolean {
    return this.#logins.has(login);
  }

  /** Returns false if the login was already watched. Throws if persisting fails. */
  async add(login: string): Promise<boolean> {
    if (this.#logins.has(login)) return false;
    this.#logins.add(login);
    try {
      await this.#save();
    } catch (error) {
      this.#logins.delete(login);
      throw error;
    }
    return true;
  }

  /** Returns false if the login wasn't watched. Throws if persisting fails. */
  async remove(login: string): Promise<boolean> {
    if (!this.#logins.has(login)) return false;
    this.#logins.delete(login);
    try {
      await this.#save();
    } catch (error) {
      this.#logins.add(login);
      throw error;
    }
    return true;
  }

  /**
   * Saves are serialized through a rejection-tolerant chain so concurrent
   * /watch mutations can't interleave writes (which would let a failed
   * writer's rollback undo state another writer already persisted). The
   * snapshot is taken at write time, inside the chain, so each serialized
   * write persists the then-current set and later writes supersede earlier.
   */
  #save(): Promise<void> {
    const run = this.#saveChain
      .catch(() => {})
      .then(() => writeJsonAtomic(WATCHLIST_FILE, { logins: [...this.#logins] }));
    this.#saveChain = run.catch(() => {});
    return run;
  }
}
