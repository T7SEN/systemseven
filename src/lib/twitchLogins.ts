// Twitch logins are letters/numbers/underscores; anything else makes Helix
// reject the entire streams/users request with a 400, not just skip the value.
export const TWITCH_LOGIN_RE = /^[a-z0-9_]{1,25}$/;

/** Lowercase and strip common paste formats: "@name", "twitch.tv/name", full URLs. */
export function normalizeTwitchLogin(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/^(?:https?:\/\/)?(?:www\.)?twitch\.tv\//, "");
}

export function isValidTwitchLogin(login: string): boolean {
  return TWITCH_LOGIN_RE.test(login);
}
