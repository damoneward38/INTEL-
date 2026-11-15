import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FluxEvent, FluxTopic, UserRole } from '../types.ts';

const MAX_IN_MEMORY_EVENTS = 250;
const DATA_DIR = path.resolve(process.cwd(), 'data');
const FLUX_LOG_PATH = path.join(DATA_DIR, 'flux-events.jsonl');

const topicOffsets = new Map<FluxTopic, number>();
const seenContentHashes = new Set<string>();
const recentEvents: FluxEvent[] = [];
const listeners = new Set<(event: FluxEvent) => void>();

function computePartition(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash % 3;
}

export function computeContentSha256(text: string): string {
  return crypto.createHash('sha256').update(text.trim(), 'utf8').digest('hex');
}

export function isContentDuplicate(content: string): boolean {
  return seenContentHashes.has(computeContentSha256(content));
}

export function registerContentDigest(content: string): string {
  const hash = computeContentSha256(content);
  seenContentHashes.add(hash);
  return hash;
}

export function publishFluxEvent(params: {
  topic: FluxTopic;
  key: string;
  actorRole: UserRole;
  summary: string;
  payload: Record<string, unknown>;
}): FluxEvent {
  const nextOffset = (topicOffsets.get(params.topic) ?? 0) + 1;
  topicOffsets.set(params.topic, nextOffset);

  const event: FluxEvent = {
    id: `flx-${crypto.randomUUID().slice(0, 8)}`,
    topic: params.topic,
    partition: computePartition(params.key),
    offset: nextOffset,
    key: params.key,
    actorRole: params.actorRole,
    summary: params.summary,
    payload: params.payload,
    digestSha256: computeContentSha256(JSON.stringify(params.payload)),
    timestamp: new Date().toISOString(),
  };

  recentEvents.unshift(event);
  if (recentEvents.length > MAX_IN_MEMORY_EVENTS) {
    recentEvents.length = MAX_IN_MEMORY_EVENTS;
  }

  try {
    if (process.env.NODE_ENV !== 'test') {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.appendFileSync(FLUX_LOG_PATH, `${JSON.stringify(event)}\n`, 'utf8');
    }
  } catch {
    // Non-fatal if read-only filesystem
  }

  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Ignore closed subscriber errors
    }
  }

  return event;
}

export function subscribeToFlux(listener: (event: FluxEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listFluxEvents(limit = 60, topicFilter?: string): FluxEvent[] {
  const filtered =
    topicFilter && topicFilter !== 'all'
      ? recentEvents.filter((ev) => ev.topic === topicFilter)
      : recentEvents;
  return filtered.slice(0, Math.min(limit, MAX_IN_MEMORY_EVENTS));
}

export function getFluxStats(): {
  totalEvents: number;
  topics: Record<string, number>;
  deduplicatedDigests: number;
} {
  const topics: Record<string, number> = {};
  for (const [topic, offset] of topicOffsets.entries()) {
    topics[topic] = offset;
  }
  return {
    totalEvents: recentEvents.length,
    topics,
    deduplicatedDigests: seenContentHashes.size,
  };
}
