# Twitch API — Contract & Sharp Edges

Covers `src/lib/twitch.ts`. The client is deliberately minimal — app-token flow, two endpoints. Extend it here rather than scattering fetch calls.

## Auth: client-credentials app token

- `POST https://id.twitch.tv/oauth2/token` with `client_id`, `client_secret`, `grant_type=client_credentials` (form-encoded body).
- No user, no scopes, no consent screen — this is why polling was chosen over EventSub websockets (which require a *user* access token).
- Token cached in-memory with expiry; refreshed 60s before expiry; on a 401 from Helix the token is dropped and refetched once, then the request retried. Two 401s in a row = real error (revoked app / bad secret).

## Endpoints used

| Call | Notes |
|---|---|
| `GET /helix/users?login=a&login=b` | ≤100 logins per request (client chunks). Well-formed unknown logins are silently absent from `data`. |
| `GET /helix/streams?user_login=a&user_login=b&first=100` | Returns ONLY currently-live streams; offline = absent, not a status field. Same 100-login chunking. |

Headers on every Helix call: `Client-Id` + `Authorization: Bearer <token>`.

## Sharp edges (each of these was verified, some the hard way)

- **One malformed login 400s the whole request.** Values with spaces, `@`, URLs, or any char outside `[a-zA-Z0-9_]` don't get skipped — Helix rejects the entire batched request, killing detection for every broadcaster. Defense lives in `config.ts` (normalize then regex-validate at startup). Never bypass it.
- **Offline is absence.** There is no `live: false`. Detection logic keys on presence-in-response + `type === "live"`.
- **`type` can be values other than `"live"`** (historically `"rerun"`, and error states); the notifier filters on it.
- **`thumbnail_url` is a template** containing literal `{width}`/`{height}` placeholders — replace both (announcement code uses 1280×720) and append a cache-buster query param, or Discord shows a stale CDN frame.
- **Stream ids change on reconnect.** A dropped-and-restarted broadcast gets a NEW stream id — this is exactly why the notifier needs the cooldown layer on top of id dedupe.
- **`started_at`** is ISO 8601 UTC; feed it to `new Date()` for the embed timestamp, no TZ math.
- **Rate limits are a non-issue at this scale**: app tokens get an 800-point/min bucket, Helix GETs cost 1; one poll = 1 request per 100 broadcasters. Don't add rate-limit machinery without evidence.

## Preview/placeholder URL trick (used by `testNotify.ts`)

`https://static-cdn.jtvnw.net/previews-ttv/live_user_<login>-{width}x{height}.jpg` serves the live preview when the channel is live and a generic placeholder when offline — useful for synthetic test announcements.

## If credentials break

`pnpm check` isolates the failure: it validates the token mint, then user resolution, then live-stream fetch, with per-step OK/FAIL lines. Client ID + secret come from https://dev.twitch.tv/console/apps.
