# Coding Patterns

Mechanical patterns for this repo, with the shipped code as the canonical example. When these conflict with memory or a tutorial, these win.

## ESM / NodeNext

- `package.json` has `"type": "module"`; tsconfig uses `module: NodeNext`. Every relative import needs a `.js` suffix, even importing a `.ts` file: `import { loadConfig } from "./config.js"`.
- Top-level await is fine in `src/` entry scripts (`index.ts`, `check.ts`, `testNotify.ts`). It is NOT available in files run from outside the project tree (no `package.json` with `type: module` above them — this bit us with a scratchpad script; keep one-off scripts inside the repo and delete after).
- Scripts run via `tsx` in dev (`pnpm dev` = `tsx watch src/index.ts`); production is `tsc` → `node dist/index.js`.

## Feature module lifecycle (`src/features/streamNotifier.ts` is the template)

```ts
export class MyFeature {
  #client: Client;
  #config: Config;
  constructor(client: Client, config: Config) { … }
  async start(): Promise<void> { … }   // called from index.ts inside ClientReady
  async stop(): Promise<void> { … }    // called from shutdown BEFORE client.destroy()
}
```

- Features own their state, scheduling, and persistence. `index.ts` only constructs, starts, and stops them.
- A feature's transient runtime errors never escape to crash the process; its config-shaped errors throw at startup.

## discord.js specifics

- **Listeners before login.** `Events.ClientReady` can fire while `await client.login()` is still pending. Pattern used in `check.ts`/`testNotify.ts`:
  ```ts
  const ready = new Promise<void>((r) => client.once(Events.ClientReady, () => r()));
  await client.login(token);
  if (!client.isReady()) await ready;   // race a timeout around this in scripts
  ```
- Intents: `[GatewayIntentBits.Guilds]` only.
- Sends: fetch the channel, check `channel.isSendable()`, throw an actionable error otherwise. Always set `allowedMentions` — `{ roles: [roleId] }` when pinging, `{ parse: [] }` otherwise. Stream titles are untrusted text; explicit allowedMentions is the injection guard.
- Shutdown (see `src/index.ts::shutdown`): re-entry-guarded boolean; `await notifier.stop()` (drains in-flight work) → `await client.destroy()` → `process.exit()`. Ordering is load-bearing: destroy first and an in-flight announcement loses its state write.

## Scheduling

- Recurring work is a `setTimeout` chain, not `setInterval` (no overlapping runs, natural drift tolerance):
  ```ts
  #scheduleNext(): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(async () => {
      try { await this.#runPoll(); } catch (e) { console.error("[notifier] Poll failed:", e); }
      this.#scheduleNext();
    }, this.#config.pollSeconds * 1000);
  }
  ```
- The in-flight promise is tracked (`#currentPoll`) so `stop()` can drain it with a bounded `Promise.race` (10s cap).

## Persistence (`data/`)

- Atomic writes: write `file.tmp`, then `rename` over the target. `mkdir` with `recursive: true` first.
- Loads sanitize field-by-field into a fresh object (see `#loadState`): structural corruption degrades to "start fresh", never to a runtime TypeError. Truthiness checks are not validation.
- `data/` is gitignored.

## Config (`src/config.ts`)

- The only file that touches `process.env`. Pattern: `requireEnv` (throws with the fix in the message), `optionalNumber` (default + minimum clamp), normalize-then-validate for external identifiers.
- Twitch logins: lowercase, strip `@` and `twitch.tv/` URL prefixes, then `/^[a-z0-9_]{1,25}$/` — because one malformed login makes Helix 400 the entire batched request.
- Every var appears in `.env.example` with a comment stating what it is and its default.

## HTTP / external APIs

- Global `fetch` only (Node 18+). No HTTP client dependencies.
- API clients follow `src/lib/twitch.ts`: lazy token, refresh-before-expiry margin, one forced-refresh retry on 401, typed response interfaces, batched requests chunked to the API's documented limit (100 for Helix), errors that include status + response body.

## Verification loop

- After edits: `pnpm typecheck`.
- After env/integration changes: `pnpm check` (posts nothing).
- `pnpm test-notify` only with the owner's knowledge — it pings.
