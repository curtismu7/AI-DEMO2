/**
 * Logger Service
 * Provides structured logging with levels: debug, info, warn, error
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
  error?: string;
}

class Logger {
  private currentLevel: LogLevel;
  private levelOrder: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(level: LogLevel = "info") {
    this.currentLevel = level;
  }

  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelOrder[level] >= this.levelOrder[this.currentLevel];
  }

  private format(entry: LogEntry): string {
    const json = JSON.stringify(entry);
    return json;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("debug")) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: "debug",
        message,
        ...(data && { data }),
      };
      console.log(this.format(entry));
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("info")) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: "info",
        message,
        ...(data && { data }),
      };
      console.log(this.format(entry));
    }
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("warn")) {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: "warn",
        message,
        ...(data && { data }),
      };
      console.warn(this.format(entry));
    }
  }

  error(message: string, error?: Error | string, data?: Record<string, unknown>): void {
    if (this.shouldLog("error")) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: "error",
        message,
        ...(data && { data }),
        ...(errorMsg && { error: errorMsg }),
      };
      console.error(this.format(entry));
    }
  }
}

// Singleton instance
const logger = new Logger(
  (process.env.LOG_LEVEL as LogLevel) || "info"
);

export { Logger, logger, LogLevel };
