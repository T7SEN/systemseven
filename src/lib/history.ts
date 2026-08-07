import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "./jsonFile.js";

const HISTORY_FILE = path.join(process.cwd(), "data", "history.json");
const MAX_ENTRIES = 50;

export interface AnnouncementRecord {
  streamId: string;
  login: string;
  displayName: string;
  title: string;
  game: string;
  url: string;
  /** ISO timestamp of when the announcement was posted. */
  announcedAt: string;
}

/**
 * Rolling log of posted go-live announcements (newest first, capped at 50).
 * Feeds /recent today and is deliberately dashboard-readable for later.
 * Best-effort: a failed write is logged, never thrown — history must not
 * break announcing.
 */
export class AnnouncementHistory {
  #entries: AnnouncementRecord[] = [];

  async load(): Promise<void> {
    const result = await readJsonFile(HISTORY_FILE);
    if (result.state !== "ok") return;
    const parsed = result.value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const raw = (parsed as { entries?: unknown }).entries;
    if (!Array.isArray(raw)) return;
    const clean: AnnouncementRecord[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      const fields = ["streamId", "login", "displayName", "title", "game", "url", "announcedAt"] as const;
      if (fields.every((field) => typeof record[field] === "string")) {
        clean.push({
          streamId: record.streamId as string,
          login: record.login as string,
          displayName: record.displayName as string,
          title: record.title as string,
          game: record.game as string,
          url: record.url as string,
          announcedAt: record.announcedAt as string,
        });
      }
    }
    this.#entries = clean.slice(0, MAX_ENTRIES);
  }

  /** Newest first. */
  list(limit: number): AnnouncementRecord[] {
    return this.#entries.slice(0, Math.max(0, limit));
  }

  async append(entry: AnnouncementRecord): Promise<void> {
    this.#entries.unshift(entry);
    this.#entries = this.#entries.slice(0, MAX_ENTRIES);
    try {
      await writeJsonAtomic(HISTORY_FILE, { entries: this.#entries });
    } catch (error) {
      console.error("[history] Failed to save announcement history:", error);
    }
  }
}
