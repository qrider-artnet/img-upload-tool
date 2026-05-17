/**
 * Supported structured log severity.
 */
export type LogLevel = 'error' | 'info' | 'warn';

/**
 * Structured log payload supplied by request handlers.
 */
export type LogEntry = Record<string, unknown> & {
  readonly eventCode: string;
};

/**
 * Structured request logger. Cloud Run captures stdout/stderr as log records.
 */
export interface Logger {
  error(entry: LogEntry): void;
  info(entry: LogEntry): void;
  warn(entry: LogEntry): void;
}

/**
 * Creates a structured logger bound to a single request ID.
 */
export const createLogger = (requestId: string): Logger => {
  const write = (level: LogLevel, entry: LogEntry): void => {
    const payload = JSON.stringify({ severity: level.toUpperCase(), requestId, ...entry });

    if (level === 'error') {
      console.error(payload);
      return;
    }

    if (level === 'warn') {
      console.warn(payload);
      return;
    }

    console.info(payload);
  };

  return {
    error: (entry) => {
      write('error', entry);
    },
    info: (entry) => {
      write('info', entry);
    },
    warn: (entry) => {
      write('warn', entry);
    },
  };
};
