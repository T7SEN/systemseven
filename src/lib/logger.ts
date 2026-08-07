export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEvent {
  level: LogLevel;
  subsystem: string;
  message: string;
  /** Structured context — safe to serialize; never put secrets here. */
  context?: Record<string, unknown>;
  /** The originating error, when there is one. */
  error?: unknown;
  timestamp: Date;
}

export interface LogSink {
  handle(event: LogEvent): void;
}

/** Preserves the established console format: `[subsystem] message`. */
const consoleSink: LogSink = {
  handle(event) {
    const line = `[${event.subsystem}] ${event.message}`;
    const args: unknown[] = [line];
    if (event.context && Object.keys(event.context).length > 0) args.push(event.context);
    if (event.error !== undefined) args.push(event.error);
    if (event.level === "error") console.error(...args);
    else if (event.level === "warn") console.warn(...args);
    else console.log(...args);
  },
};

const sinks: LogSink[] = [consoleSink];

/**
 * Register an additional sink (e.g. Sentry). A sink that throws is isolated —
 * logging must never take the bot down.
 */
export function addLogSink(sink: LogSink): void {
  sinks.push(sink);
}

function emit(event: LogEvent): void {
  for (const sink of sinks) {
    try {
      sink.handle(event);
    } catch {
      // A broken sink must not break logging (or the bot).
    }
  }
}

export class Logger {
  readonly #subsystem: string;

  constructor(subsystem: string) {
    this.#subsystem = subsystem;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    emit({ level: "debug", subsystem: this.#subsystem, message, context, timestamp: new Date() });
  }

  info(message: string, context?: Record<string, unknown>): void {
    emit({ level: "info", subsystem: this.#subsystem, message, context, timestamp: new Date() });
  }

  warn(message: string, context?: Record<string, unknown>, error?: unknown): void {
    emit({ level: "warn", subsystem: this.#subsystem, message, context, error, timestamp: new Date() });
  }

  error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    emit({ level: "error", subsystem: this.#subsystem, message, context, error, timestamp: new Date() });
  }
}

/** One logger per subsystem; the prefix becomes the bracketed tag in output. */
export function createLogger(subsystem: string): Logger {
  return new Logger(subsystem);
}
