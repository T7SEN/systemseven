import "dotenv/config";

export interface Config {
  discordToken: string;
  announceChannelId: string;
  mentionRoleId: string | null;
  twitchClientId: string;
  twitchClientSecret: string;
  broadcasterLogins: string[];
  pollSeconds: number;
  renotifyCooldownMinutes: number;
}

// Twitch logins are letters/numbers/underscores; anything else makes Helix
// reject the entire streams/users request with a 400, not just skip the value.
const TWITCH_LOGIN_RE = /^[a-z0-9_]{1,25}$/;

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
  const broadcasterLogins = requireEnv("TWITCH_BROADCASTERS")
    .split(",")
    .map((raw) => raw.trim().toLowerCase())
    // Tolerate common paste formats: "@name", "twitch.tv/name", full URLs.
    .map((login) => login.replace(/^@/, "").replace(/^(?:https?:\/\/)?(?:www\.)?twitch\.tv\//, ""))
    .filter((login) => login.length > 0);

  if (broadcasterLogins.length === 0) {
    throw new Error("TWITCH_BROADCASTERS must contain at least one Twitch login name.");
  }

  const invalid = broadcasterLogins.filter((login) => !TWITCH_LOGIN_RE.test(login));
  if (invalid.length > 0) {
    throw new Error(
      `TWITCH_BROADCASTERS contains invalid Twitch login name(s): ${invalid.join(", ")}. ` +
        `Logins may only contain letters, numbers, and underscores (max 25 chars) — ` +
        `use the name from the channel URL, e.g. "somechannel".`,
    );
  }

  return {
    discordToken: requireEnv("DISCORD_TOKEN"),
    announceChannelId: requireEnv("ANNOUNCE_CHANNEL_ID"),
    mentionRoleId: process.env.MENTION_ROLE_ID?.trim() || null,
    twitchClientId: requireEnv("TWITCH_CLIENT_ID"),
    twitchClientSecret: requireEnv("TWITCH_CLIENT_SECRET"),
    broadcasterLogins: [...new Set(broadcasterLogins)],
    pollSeconds: optionalNumber("POLL_SECONDS", 60, 15),
    renotifyCooldownMinutes: optionalNumber("RENOTIFY_COOLDOWN_MINUTES", 15, 0),
  };
}
