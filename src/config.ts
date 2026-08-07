import "dotenv/config";
import { isValidTwitchLogin, normalizeTwitchLogin } from "./lib/twitchLogins.js";

export interface Config {
  discordToken: string;
  announceChannelId: string;
  mentionRoleId: string | null;
  guildId: string | null;
  twitchClientId: string;
  twitchClientSecret: string;
  /** Seed only — after first boot, data/watchlist.json is authoritative. */
  broadcasterLogins: string[];
  pollSeconds: number;
  renotifyCooldownMinutes: number;
}

const SNOWFLAKE_RE = /^\d{17,20}$/;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function optionalNumber(name: string, fallback: number, min: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number, got "${raw}"`);
  }
  return Math.max(min, value);
}

export function loadConfig(): Config {
  // Optional: only seeds data/watchlist.json when that file doesn't exist yet.
  // May be empty once the watchlist is /watch-managed (Watchlist warns when
  // both the file and the seed are absent).
  const broadcasterLogins = (process.env.TWITCH_BROADCASTERS ?? "")
    .split(",")
    .map(normalizeTwitchLogin)
    .filter((login) => login.length > 0);

  const invalid = broadcasterLogins.filter((login) => !isValidTwitchLogin(login));
  if (invalid.length > 0) {
    throw new Error(
      `TWITCH_BROADCASTERS contains invalid Twitch login name(s): ${invalid.join(", ")}. ` +
        `Logins may only contain letters, numbers, and underscores (max 25 chars) — ` +
        `use the name from the channel URL, e.g. "somechannel".`,
    );
  }

  const guildId = process.env.DISCORD_GUILD_ID?.trim() || null;
  if (guildId && !SNOWFLAKE_RE.test(guildId)) {
    throw new Error(
      `DISCORD_GUILD_ID must be a numeric server ID (right-click your server icon → Copy Server ID), got "${guildId}"`,
    );
  }

  return {
    discordToken: requireEnv("DISCORD_TOKEN"),
    announceChannelId: requireEnv("ANNOUNCE_CHANNEL_ID"),
    mentionRoleId: process.env.MENTION_ROLE_ID?.trim() || null,
    guildId,
    twitchClientId: requireEnv("TWITCH_CLIENT_ID"),
    twitchClientSecret: requireEnv("TWITCH_CLIENT_SECRET"),
    broadcasterLogins: [...new Set(broadcasterLogins)],
    pollSeconds: optionalNumber("POLL_SECONDS", 60, 15),
    renotifyCooldownMinutes: optionalNumber("RENOTIFY_COOLDOWN_MINUTES", 15, 0),
  };
}
