const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const HELIX_BASE = "https://api.twitch.tv/helix";

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

export interface TwitchStream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_name: string;
  title: string;
  type: string;
  started_at: string;
  thumbnail_url: string;
}

/**
 * Minimal Twitch Helix client using the client-credentials (app access token) flow.
 * Tokens are fetched lazily and refreshed automatically on expiry or 401.
 */
export class TwitchClient {
  #clientId: string;
  #clientSecret: string;
  #token: string | null = null;
  #tokenExpiresAt = 0;

  constructor(clientId: string, clientSecret: string) {
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
  }

  async #getToken(): Promise<string> {
    // Refresh 60s before actual expiry to avoid using a token that dies mid-request.
    if (this.#token && Date.now() < this.#tokenExpiresAt - 60_000) {
      return this.#token;
    }

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.#clientId,
        client_secret: this.#clientSecret,
        grant_type: "client_credentials",
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Twitch token request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.#token = data.access_token;
    this.#tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.#token;
  }

  async #helix<T>(path: string, params: URLSearchParams): Promise<T[]> {
    let token = await this.#getToken();

    let response = await this.#request(path, params, token);
    if (response.status === 401) {
      // Token was revoked or expired early — force a refresh and retry once.
      this.#token = null;
      token = await this.#getToken();
      response = await this.#request(path, params, token);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Twitch API ${path} failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as { data: T[] };
    return payload.data;
  }

  #request(path: string, params: URLSearchParams, token: string): Promise<Response> {
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return fetch(`${HELIX_BASE}${path}${query}`, {
      headers: {
        "Client-Id": this.#clientId,
        Authorization: `Bearer ${token}`,
      },
    });
  }

  /**
   * Resolve login names to user records. Well-formed but unknown logins are
   * silently absent from the result; a malformed login (characters outside
   * [a-z0-9_]) makes Helix reject the entire request with a 400.
   */
  async getUsersByLogin(logins: string[]): Promise<TwitchUser[]> {
    const users: TwitchUser[] = [];
    for (const chunk of chunked(logins, 100)) {
      const params = new URLSearchParams();
      for (const login of chunk) params.append("login", login);
      users.push(...(await this.#helix<TwitchUser>("/users", params)));
    }
    return users;
  }

  /** Return currently-live streams for the given logins. Offline channels are simply not in the result. */
  async getLiveStreams(logins: string[]): Promise<TwitchStream[]> {
    const streams: TwitchStream[] = [];
    for (const chunk of chunked(logins, 100)) {
      const params = new URLSearchParams();
      for (const login of chunk) params.append("user_login", login);
      params.set("first", "100");
      streams.push(...(await this.#helix<TwitchStream>("/streams", params)));
    }
    return streams;
  }
}

function* chunked<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}
