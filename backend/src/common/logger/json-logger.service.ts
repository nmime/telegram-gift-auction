import type { LoggerService, LogLevel } from "@nestjs/common";

export class JsonLoggerService implements LoggerService {
  private readonly isProduction: boolean;

  constructor() {
    this.isProduction = process.env.NODE_ENV === "production";
  }

  log(message: unknown, context?: string): void {
    this.writeLog("info", message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.writeLog("error", message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.writeLog("warn", message, context);
  }

  debug(message: unknown, context?: string): void {
    this.writeLog("debug", message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.writeLog("verbose", message, context);
  }

  fatal(message: unknown, context?: string): void {
    this.writeLog("fatal", message, context);
  }

  setLogLevels?(_levels: LogLevel[]): void {
    // Optional implementation
  }

  private writeLog(
    level: string,
    message: unknown,
    context?: string,
    trace?: string,
  ): void {
    const timestamp = new Date().toISOString();

    if (this.isProduction) {
      const logEntry: Record<string, unknown> = {
        timestamp,
        level,
        context:
          context !== undefined && context !== "" ? context : "Application",
        message: this.formatMessage(message),
      };

      if (trace !== undefined && trace !== "") {
        logEntry.trace = trace;
      }

      // eslint-disable-next-line no-console
      console.log(JSON.stringify(logEntry));
    } else {
      const contextStr =
        context !== undefined && context !== "" ? `[${context}]` : "";
      const levelColor = this.getLevelColor(level);
      const msg = this.formatMessage(message);
      // eslint-disable-next-line no-console
      console.log(
        `${timestamp} ${levelColor}${level.toUpperCase()}\x1b[0m ${contextStr} ${msg}`,
      );
      if (trace !== undefined && trace !== "") {
        // eslint-disable-next-line no-console
        console.log(trace);
      }
    }
  }

  private formatMessage(message: unknown): string {
    if (typeof message === "string") {
      return message;
    }
    if (message instanceof Error) {
      return message.message;
    }
    return JSON.stringify(message);
  }

  private getLevelColor(level: string): string {
    const colors: Record<string, string> = {
      info: "\x1b[32m",
      error: "\x1b[31m",
      warn: "\x1b[33m",
      debug: "\x1b[36m",
      verbose: "\x1b[35m",
      fatal: "\x1b[31m\x1b[1m",
    };
    return colors[level] ?? "";
  }
}
