import crypto from 'node:crypto';
import type { LogEntry } from './types.ts';

const MAX_LOG_ENTRIES = 250;
const logBuffer: LogEntry[] = [];

function pushLog(
  level: LogEntry['level'],
  scope: string,
  message: string,
  details?: Record<string, unknown>
): LogEntry {
  const entry: LogEntry = {
    id: crypto.randomUUID(),
    level,
    scope,
    message,
    details,
    timestamp: new Date().toISOString(),
  };

  logBuffer.unshift(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.length = MAX_LOG_ENTRIES;
  }

  const line = `[${entry.timestamp}] [${level.toUpperCase()}] [${scope}] ${message}`;
  if (level === 'error') {
    console.error(line, details ? JSON.stringify(details) : '');
  } else if (level === 'warn') {
    console.warn(line, details ? JSON.stringify(details) : '');
  } else {
    console.log(line);
  }

  return entry;
}

export const logger = {
  info(scope: string, message: string, details?: Record<string, unknown>) {
    return pushLog('info', scope, message, details);
  },
  warn(scope: string, message: string, details?: Record<string, unknown>) {
    return pushLog('warn', scope, message, details);
  },
  error(scope: string, message: string, details?: Record<string, unknown>) {
    return pushLog('error', scope, message, details);
  },
  getRecent(limit = 100): LogEntry[] {
    return logBuffer.slice(0, Math.min(limit, MAX_LOG_ENTRIES));
  },
  clearForTest() {
    logBuffer.length = 0;
  },
};
