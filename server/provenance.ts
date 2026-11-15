import crypto from 'node:crypto';
import type { ProvenanceRecord, UserRole } from './types.ts';

const MAX_RECORDS = 300;
const provenanceLog: ProvenanceRecord[] = [];

export function computeSha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function recordProvenance(params: {
  kind: ProvenanceRecord['kind'];
  actorId: string;
  actorRole: UserRole;
  action: string;
  rawInput: string;
  modelOrEngine: string;
  licenses: string[];
  sourceUrls: string[];
  metadata?: Record<string, string | number | boolean>;
}): ProvenanceRecord {
  const record: ProvenanceRecord = {
    id: `prov-${crypto.randomUUID().slice(0, 8)}`,
    kind: params.kind,
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: params.action,
    digestSha256: computeSha256(params.rawInput),
    modelOrEngine: params.modelOrEngine,
    licenses: Array.from(new Set(params.licenses.filter(Boolean))),
    sourceUrls: Array.from(new Set(params.sourceUrls.filter(Boolean))),
    metadata: params.metadata ?? {},
    timestamp: new Date().toISOString(),
  };

  provenanceLog.unshift(record);
  if (provenanceLog.length > MAX_RECORDS) {
    provenanceLog.length = MAX_RECORDS;
  }

  return record;
}

export function listProvenance(limit = 100): ProvenanceRecord[] {
  return provenanceLog.slice(0, Math.min(limit, MAX_RECORDS));
}

export function clearProvenanceForTest(): void {
  provenanceLog.length = 0;
}
