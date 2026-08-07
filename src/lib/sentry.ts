import type { Config } from "../config.js";
import { addLogSink, createLogger } from "./logger.js";

const log = createLogger("sentry");

let sentry: typeof import("@sentry/node") | null = null;

/**
 * Optional Sentry transport behind the logger seam. No-op when SENTRY_DSN is
 * unset — the SDK isn't even loaded. When enabled: logger errors become Sentry
 * events (with subsystem + context attached) and info/warn lines become
 * breadcrumbs, so every event arrives with the log trail that led up to it.
 * Feature code never imports @sentry/node — this file is the only touchpoint.
 */
export async function initSentry(config: Config): Promise<void> {
  if (!config.sentryDsn) {
    log.info("SENTRY_DSN not set — Sentry disabled");
    return;
  }

  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn: config.sentryDsn,
    // Explicit-capture only. tracesSampleRate stays UNSET: even 0 counts as
    // "tracing enabled at 0%" and loads the whole auto-perf integration set.
    // Two default integrations are dropped because they fight the logger sink:
    //  - OnUnhandledRejection: captures before index.ts's handler, stripping
    //    our subsystem context (Error reasons) or double-reporting (non-Error
    //    reasons). The logger sink is the single reporter.
    //  - Console: would re-breadcrumb every console line the sink already
    //    breadcrumbs under its proper subsystem category.
    integrations: (defaults) =>
      defaults.filter(
        (integration) => integration.name !== "OnUnhandledRejection" && integration.name !== "Console",
      ),
  });
  sentry = Sentry;

  addLogSink({
    handle(event) {
      if (event.level === "error") {
        const context = { subsystem: event.subsystem, ...event.context };
        if (event.error instanceof Error) {
          Sentry.captureException(event.error, {
            extra: { ...context, logMessage: event.message },
          });
        } else {
          const suffix = event.error !== undefined ? `: ${String(event.error)}` : "";
          Sentry.captureMessage(`[${event.subsystem}] ${event.message}${suffix}`, {
            level: "error",
            extra: context,
          });
        }
      } else if (event.level === "warn" || event.level === "info") {
        Sentry.addBreadcrumb({
          category: event.subsystem,
          message: event.message,
          level: event.level === "warn" ? "warning" : "info",
          data: event.context,
        });
      }
    },
  });

  log.info("Sentry error monitoring enabled");
}

/** Flush pending events on shutdown (bounded — never hangs the exit). */
export async function closeSentry(): Promise<void> {
  if (!sentry) return;
  await sentry.close(2000).catch(() => {});
}
