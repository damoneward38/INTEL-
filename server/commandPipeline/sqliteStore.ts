import crypto from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type {
  AuditChainEntry,
  PipelineEvent,
  PipelineJobRecord,
  PipelineSystemSettings,
  UploadedArtifactRecord,
} from './types.ts';

const DEFAULT_SETTINGS: PipelineSystemSettings = {
  maxConcurrentJobs: 2,
  defaultReplicates: 4,
  defaultRetryLimit: 2,
  voiceAutoSpeak: true,
  enforceMedicalSafetyGate: true,
  preferredModel: 'gemini-4-hydrogen',
  updatedAt: new Date().toISOString(),
};

let dbInstance: DatabaseSync | null = null;
let activeDbPath = '';

function resolveDbPath(): string {
  return (
    process.env.INTEL_PIPELINE_DB_PATH ||
    path.join(process.cwd(), 'data', 'command_pipeline.sqlite3')
  );
}

export function getPipelineDb(): DatabaseSync {
  const targetPath = resolveDbPath();
  if (dbInstance && activeDbPath === targetPath) {
    return dbInstance;
  }
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // Ignore close failures when switching paths in tests
    }
    dbInstance = null;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const db = new DatabaseSync(targetPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      idempotency_key TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;

    CREATE TABLE IF NOT EXISTS job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      job_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL,
      message TEXT NOT NULL,
      data_json TEXT NOT NULL,
      UNIQUE(job_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_job_events_job_seq ON job_events(job_id, sequence ASC);

    CREATE TABLE IF NOT EXISTS uploads (
      upload_id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_chain (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id TEXT NOT NULL UNIQUE,
      job_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      stage TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      entry_hash TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS protocol_registry (
      protocol_id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      simulator_id TEXT NOT NULL,
      parameters_json TEXT NOT NULL,
      confidence_json TEXT NOT NULL,
      registered_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
  `);

  dbInstance = db;
  activeDbPath = targetPath;
  return db;
}

export function saveJobRecord(job: PipelineJobRecord): void {
  const db = getPipelineDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO jobs (job_id, idempotency_key, status, created_at, updated_at, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      status = excluded.status,
      updated_at = excluded.updated_at,
      payload_json = excluded.payload_json
  `);
  stmt.run(
    job.jobId,
    job.idempotencyKey ?? null,
    job.status,
    job.createdAt,
    now,
    JSON.stringify(job)
  );
}

export function getJobRecord(jobId: string): PipelineJobRecord | null {
  const db = getPipelineDb();
  const row = db
    .prepare('SELECT payload_json FROM jobs WHERE job_id = ?')
    .get(jobId) as { payload_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.payload_json) as PipelineJobRecord;
}

export function getJobByIdempotencyKey(key: string): PipelineJobRecord | null {
  const db = getPipelineDb();
  const row = db
    .prepare('SELECT payload_json FROM jobs WHERE idempotency_key = ?')
    .get(key) as { payload_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.payload_json) as PipelineJobRecord;
}

export function listJobRecords(limit = 40): PipelineJobRecord[] {
  const db = getPipelineDb();
  const rows = db
    .prepare('SELECT payload_json FROM jobs ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Array<{ payload_json: string }>;
  return rows.map((r) => JSON.parse(r.payload_json) as PipelineJobRecord);
}

export function appendJobEvent(
  eventWithoutSeq: Omit<PipelineEvent, 'sequence'>
): PipelineEvent {
  const db = getPipelineDb();
  const maxRow = db
    .prepare('SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM job_events WHERE job_id = ?')
    .get(eventWithoutSeq.job_id) as { max_seq: number };
  const sequence = (maxRow?.max_seq ?? 0) + 1;

  const event: PipelineEvent = {
    ...eventWithoutSeq,
    sequence,
  };

  db.prepare(`
    INSERT INTO job_events (
      event_id, job_id, sequence, timestamp, type, stage, status, progress, message, data_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.event_id,
    event.job_id,
    event.sequence,
    event.timestamp,
    event.type,
    event.stage,
    event.status,
    event.progress,
    event.message,
    JSON.stringify(event.data ?? {})
  );

  return event;
}

export function listJobEvents(jobId: string, afterSequence = 0): PipelineEvent[] {
  const db = getPipelineDb();
  const rows = db
    .prepare(
      `SELECT event_id, job_id, sequence, timestamp, type, stage, status, progress, message, data_json
       FROM job_events
       WHERE job_id = ? AND sequence > ?
       ORDER BY sequence ASC`
    )
    .all(jobId, afterSequence) as Array<{
    event_id: string;
    job_id: string;
    sequence: number;
    timestamp: string;
    type: PipelineEvent['type'];
    stage: PipelineEvent['stage'];
    status: PipelineEvent['status'];
    progress: number;
    message: string;
    data_json: string;
  }>;

  return rows.map((r) => ({
    event_id: r.event_id,
    job_id: r.job_id,
    sequence: r.sequence,
    timestamp: r.timestamp,
    type: r.type,
    stage: r.stage,
    status: r.status,
    progress: r.progress,
    message: r.message,
    data: JSON.parse(r.data_json) as Record<string, unknown>,
  }));
}

export function saveUploadedArtifact(artifact: UploadedArtifactRecord): void {
  const db = getPipelineDb();
  db.prepare(`
    INSERT INTO uploads (upload_id, filename, created_at, payload_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(upload_id) DO UPDATE SET payload_json = excluded.payload_json
  `).run(artifact.uploadId, artifact.filename, artifact.createdAt, JSON.stringify(artifact));
}

export function getUploadedArtifact(uploadId: string): UploadedArtifactRecord | null {
  const db = getPipelineDb();
  const row = db
    .prepare('SELECT payload_json FROM uploads WHERE upload_id = ?')
    .get(uploadId) as { payload_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.payload_json) as UploadedArtifactRecord;
}

export function listUploadedArtifacts(limit = 30): UploadedArtifactRecord[] {
  const db = getPipelineDb();
  const rows = db
    .prepare('SELECT payload_json FROM uploads ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Array<{ payload_json: string }>;
  return rows.map((r) => JSON.parse(r.payload_json) as UploadedArtifactRecord);
}

export function appendAuditChainEntry(input: {
  jobId: string;
  eventType: string;
  stage: string;
  actorId: string;
  summary: string;
}): AuditChainEntry {
  const db = getPipelineDb();
  const prevRow = db
    .prepare('SELECT entry_hash FROM audit_chain ORDER BY seq DESC LIMIT 1')
    .get() as { entry_hash: string } | undefined;
  const prevHash = prevRow?.entry_hash ?? 'GENESIS-00000000';
  const auditId = `aud-${crypto.randomUUID().slice(0, 8)}`;
  const timestamp = new Date().toISOString();
  const canonical = JSON.stringify({
    auditId,
    jobId: input.jobId,
    eventType: input.eventType,
    stage: input.stage,
    actorId: input.actorId,
    summary: input.summary,
    prevHash,
    timestamp,
  });
  const entryHash = crypto.createHash('sha256').update(canonical).digest('hex');

  const res = db
    .prepare(
      `INSERT INTO audit_chain (
        audit_id, job_id, event_type, stage, actor_id, summary, prev_hash, entry_hash, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      auditId,
      input.jobId,
      input.eventType,
      input.stage,
      input.actorId,
      input.summary,
      prevHash,
      entryHash,
      timestamp
    );

  return {
    seq: Number(res.lastInsertRowid),
    auditId,
    jobId: input.jobId,
    eventType: input.eventType,
    stage: input.stage,
    actorId: input.actorId,
    summary: input.summary,
    prevHash,
    entryHash,
    timestamp,
  };
}

export function listAuditChainEntries(jobId?: string, limit = 150): AuditChainEntry[] {
  const db = getPipelineDb();
  const rows = (
    jobId
      ? db
          .prepare('SELECT * FROM audit_chain WHERE job_id = ? ORDER BY seq ASC LIMIT ?')
          .all(jobId, limit)
      : db.prepare('SELECT * FROM audit_chain ORDER BY seq DESC LIMIT ?').all(limit)
  ) as Array<{
    seq: number;
    audit_id: string;
    job_id: string;
    event_type: string;
    stage: string;
    actor_id: string;
    summary: string;
    prev_hash: string;
    entry_hash: string;
    timestamp: string;
  }>;

  return rows.map((r) => ({
    seq: r.seq,
    auditId: r.audit_id,
    jobId: r.job_id,
    eventType: r.event_type,
    stage: r.stage,
    actorId: r.actor_id,
    summary: r.summary,
    prevHash: r.prev_hash,
    entryHash: r.entry_hash,
    timestamp: r.timestamp,
  }));
}

export function verifyAuditChainIntegrity(): {
  valid: boolean;
  totalEntries: number;
  brokenAtSeq: number | null;
  headHash: string | null;
} {
  const db = getPipelineDb();
  const rows = db.prepare('SELECT * FROM audit_chain ORDER BY seq ASC').all() as Array<{
    seq: number;
    audit_id: string;
    job_id: string;
    event_type: string;
    stage: string;
    actor_id: string;
    summary: string;
    prev_hash: string;
    entry_hash: string;
    timestamp: string;
  }>;

  let expectedPrev = 'GENESIS-00000000';
  for (const r of rows) {
    if (r.prev_hash !== expectedPrev) {
      return {
        valid: false,
        totalEntries: rows.length,
        brokenAtSeq: r.seq,
        headHash: rows[rows.length - 1]?.entry_hash ?? null,
      };
    }
    const canonical = JSON.stringify({
      auditId: r.audit_id,
      jobId: r.job_id,
      eventType: r.event_type,
      stage: r.stage,
      actorId: r.actor_id,
      summary: r.summary,
      prevHash: r.prev_hash,
      timestamp: r.timestamp,
    });
    const recomputed = crypto.createHash('sha256').update(canonical).digest('hex');
    if (recomputed !== r.entry_hash) {
      return {
        valid: false,
        totalEntries: rows.length,
        brokenAtSeq: r.seq,
        headHash: rows[rows.length - 1]?.entry_hash ?? null,
      };
    }
    expectedPrev = r.entry_hash;
  }

  return {
    valid: true,
    totalEntries: rows.length,
    brokenAtSeq: null,
    headHash: rows.length > 0 ? rows[rows.length - 1].entry_hash : null,
  };
}

export function registerWinningProtocol(input: {
  jobId: string;
  candidateId: string;
  domain: string;
  simulatorId: string;
  parameters: Record<string, number>;
  confidenceInterval95: [number, number] | null;
}): string {
  const db = getPipelineDb();
  const protocolId = `reg-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO protocol_registry (
      protocol_id, job_id, candidate_id, domain, simulator_id, parameters_json, confidence_json, registered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    protocolId,
    input.jobId,
    input.candidateId,
    input.domain,
    input.simulatorId,
    JSON.stringify(input.parameters),
    JSON.stringify(input.confidenceInterval95),
    new Date().toISOString()
  );
  return protocolId;
}

export function getPipelineSettings(): PipelineSystemSettings {
  const db = getPipelineDb();
  const row = db
    .prepare("SELECT value_json FROM system_settings WHERE key = 'pipeline_settings'")
    .get() as { value_json: string } | undefined;
  if (!row) {
    savePipelineSettings(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
  return {
    ...DEFAULT_SETTINGS,
    ...(JSON.parse(row.value_json) as Partial<PipelineSystemSettings>),
  };
}

export function savePipelineSettings(
  updates: Partial<PipelineSystemSettings>
): PipelineSystemSettings {
  const db = getPipelineDb();
  const existingRow = db
    .prepare("SELECT value_json FROM system_settings WHERE key = 'pipeline_settings'")
    .get() as { value_json: string } | undefined;
  const current = existingRow
    ? ({ ...DEFAULT_SETTINGS, ...JSON.parse(existingRow.value_json) } as PipelineSystemSettings)
    : DEFAULT_SETTINGS;

  const merged: PipelineSystemSettings = {
    ...current,
    ...updates,
    maxConcurrentJobs: Math.max(1, Math.min(8, Number(updates.maxConcurrentJobs ?? current.maxConcurrentJobs))),
    defaultReplicates: Math.max(2, Math.min(12, Number(updates.defaultReplicates ?? current.defaultReplicates))),
    defaultRetryLimit: Math.max(0, Math.min(5, Number(updates.defaultRetryLimit ?? current.defaultRetryLimit))),
    updatedAt: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO system_settings (key, value_json) VALUES ('pipeline_settings', ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
  `).run(JSON.stringify(merged));

  return merged;
}

export function recoverInterruptedJobs(): number {
  const db = getPipelineDb();
  const rows = db
    .prepare("SELECT payload_json FROM jobs WHERE status IN ('running', 'queued')")
    .all() as Array<{ payload_json: string }>;

  let recovered = 0;
  for (const row of rows) {
    const job = JSON.parse(row.payload_json) as PipelineJobRecord;
    job.status = 'failed';
    job.error = 'Worker restarted before job completed. Use retry/resubmit or inspect partial stage events.';
    job.completedAt = new Date().toISOString();
    for (const stage of job.stages) {
      if (stage.status === 'processing') {
        stage.status = 'failed';
        stage.errorCount += 1;
        stage.summary = 'Interrupted by worker restart.';
        stage.completedAt = job.completedAt;
      }
    }
    saveJobRecord(job);
    appendJobEvent({
      event_id: crypto.randomUUID(),
      job_id: job.jobId,
      timestamp: job.completedAt,
      type: 'job.failed',
      stage: 'system',
      status: 'failed',
      progress: job.progress,
      message: 'Worker restart recovery marked interrupted job as failed safely.',
      data: { recovered: true },
    });
    recovered += 1;
  }
  return recovered;
}
