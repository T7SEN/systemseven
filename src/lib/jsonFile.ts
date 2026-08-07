import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type JsonReadResult =
  | { state: "ok"; value: unknown }
  | { state: "missing" }
  | { state: "error"; error: unknown };

/**
 * Read and parse a JSON file. "missing" (ENOENT) is distinct from "error"
 * (unreadable or unparseable) so callers can treat an absent file as a fresh
 * start without ever mistaking a corrupt-but-present file for one.
 */
export async function readJsonFile(filePath: string): Promise<JsonReadResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { state: "missing" };
    return { state: "error", error };
  }
  try {
    return { state: "ok", value: JSON.parse(raw) as unknown };
  } catch (error) {
    return { state: "error", error };
  }
}

/**
 * Write tmp + rename so a crash mid-write can never leave a truncated file
 * (a corrupt runtime file would cost a duplicate announcement or a lost list).
 * Each call gets a unique tmp name, so concurrent writers can't splice each
 * other's tmp file — but concurrency is last-rename-wins: every rename installs
 * a complete snapshot, and callers whose writes are logically ordered must
 * still serialize themselves (see Watchlist's save chain).
 */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpFile = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tmpFile, JSON.stringify(value, null, 2), "utf8");
  try {
    await rename(tmpFile, filePath);
  } catch (error) {
    await unlink(tmpFile).catch(() => {});
    throw error;
  }
}
