import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { createApp } from '../server.ts';
import { subscribeToPipelineJob } from '../server/commandPipeline/orchestrator.ts';
import { getJobRecord, listJobEvents } from '../server/commandPipeline/sqliteStore.ts';
import { PIPELINE_STAGE_DEFINITIONS } from '../server/commandPipeline/stages.ts';

let server: http.Server;
let baseUrl = '';
let wsBaseUrl = '';
let tempDbPath = '';

beforeAll(async () => {
  tempDbPath = path.join(os.tmpdir(), `intel-pipeline-test-${Date.now()}.sqlite3`);
  process.env.INTEL_PIPELINE_DB_PATH = tempDbPath;

  const app = createApp();
  server = http.createServer(app);

  const jobsWss = new WebSocketServer({ noServer: true });
  jobsWss.on(
    'connection',
    (
      socket: WebSocket,
      _req: http.IncomingMessage,
      info: { jobId: string; afterSequence: number }
    ) => {
      let lastSeq = info.afterSequence;
      for (const ev of listJobEvents(info.jobId, info.afterSequence)) {
        socket.send(JSON.stringify(ev));
        lastSeq = Math.max(lastSeq, ev.sequence);
      }
      const unsub = subscribeToPipelineJob(info.jobId, (ev) => {
        if (ev.sequence <= lastSeq) return;
        lastSeq = ev.sequence;
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(ev));
        }
      });
      socket.on('close', () => unsub());
    }
  );

  server.on('upgrade', (request, socket, head) => {
    const reqUrl = request.url || '';
    const match = reqUrl.match(/^\/ws\/jobs\/([^/?#]+)(\?.*)?$/);
    if (match) {
      const jobId = decodeURIComponent(match[1]);
      const params = new URLSearchParams(match[2] || '');
      const afterSequence = Number(params.get('afterSequence') || '0') || 0;
      jobsWss.handleUpgrade(request, socket, head, (ws) => {
        jobsWss.emit('connection', ws, request, { jobId, afterSequence });
      });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      wsBaseUrl = `ws://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  for (const suffix of ['', '-wal', '-shm']) {
    const f = `${tempDbPath}${suffix}`;
    if (fs.existsSync(f)) {
      try {
        fs.unlinkSync(f);
      } catch {
        // Ignore cleanup locks
      }
    }
  }
});

async function waitForJobTerminal(jobId: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    const data = (await res.json()) as { job: ReturnType<typeof getJobRecord> };
    const st = data.job?.status;
    if (st === 'completed' || st === 'failed' || st === 'cancelled' || st === 'needs_review') {
      return data.job!;
    }
    await new Promise((r) => setTimeout(r, 35));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

describe('Command Center — 30-Stage Autonomous Formulation, Pipeline & WebSocket Replay', () => {
  it('exposes 30 documented stages, registered simulators, and enriched health check', async () => {
    const [stagesRes, simsRes, healthRes] = await Promise.all([
      fetch(`${baseUrl}/api/pipeline/stages`),
      fetch(`${baseUrl}/api/simulators`),
      fetch(`${baseUrl}/api/health`),
    ]);
    expect(stagesRes.status).toBe(200);
    expect(simsRes.status).toBe(200);
    expect(healthRes.status).toBe(200);

    const stagesJson = (await stagesRes.json()) as { stages: typeof PIPELINE_STAGE_DEFINITIONS };
    expect(stagesJson.stages.length).toBe(30);
    expect(stagesJson.stages[0].id).toBe('command-ingest');
    expect(stagesJson.stages[29].id).toBe('3d-visualization');

    const simsJson = (await simsRes.json()) as { simulators: Array<{ id: string }> };
    expect(simsJson.simulators.length).toBeGreaterThanOrEqual(4);

    const healthJson = (await healthRes.json()) as {
      commandPipeline: { sqliteReady: boolean; stageCount: number };
    };
    expect(healthJson.commandPipeline.sqliteReady).toBe(true);
    expect(healthJson.commandPipeline.stageCount).toBe(30);
  });

  it('executes full formulation optimization via /api/upload + /api/command, rejects unsafe candidate, refines Batch 2, verifies report & audit chain, and replays WS events', async () => {
    // 1. Upload CSV matrix containing both nominal and unsafe boundary parameters
    const csvContent = [
      'temperature,pressure,pH,ionicStrength',
      '306,1.1,7.1,0.15',
      '322,1.5,6.9,0.20',
      '418,14.0,4.2,0.48',
    ].join('\n');

    const uploadRes = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'formulation_matrix.csv',
        content: csvContent,
        mimeType: 'text/csv',
      }),
    });
    expect(uploadRes.status).toBe(201);
    const { artifact } = (await uploadRes.json()) as {
      artifact: { uploadId: string; parsedRowsCount: number; detectedFormat: string };
    };
    expect(artifact.detectedFormat).toBe('csv');
    expect(artifact.parsedRowsCount).toBe(3);

    // 2. Submit command with idempotency key
    const idemKey = `test-idem-${Date.now()}`;
    const cmdRes = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Analyze this formulation and find a safer, more stable candidate.',
        inputMode: 'voice',
        uploadId: artifact.uploadId,
        idempotencyKey: idemKey,
      }),
    });
    expect(cmdRes.status).toBe(202);
    const { job: initialJob } = (await cmdRes.json()) as {
      job: { jobId: string; intent: string };
    };
    expect(initialJob.intent).toBe('formulation');

    // Verify idempotency deduplication
    const dupRes = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Analyze this formulation and find a safer, more stable candidate.',
        idempotencyKey: idemKey,
      }),
    });
    expect(dupRes.status).toBe(200);
    const dupJson = (await dupRes.json()) as { deduplicated: boolean; job: { jobId: string } };
    expect(dupJson.deduplicated).toBe(true);
    expect(dupJson.job.jobId).toBe(initialJob.jobId);

    // 3. Connect WebSocket to capture live streamed events
    const streamedEvents: Array<{ sequence: number; type: string }> = [];
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`${wsBaseUrl}/ws/jobs/${initialJob.jobId}`);
      ws.on('message', (raw) => {
        const evt = JSON.parse(raw.toString()) as { sequence: number; type: string };
        streamedEvents.push(evt);
        if (evt.type === 'job.completed') {
          ws.close();
          resolve();
        }
      });
    });

    const completedJob = await waitForJobTerminal(initialJob.jobId);
    expect(completedJob.status).toBe('completed');
    expect(completedJob.stages.length).toBe(30);
    expect(completedJob.stages.every((s) => s.status !== 'waiting' && s.status !== 'failed')).toBe(
      true
    );

    // Verify rejected unsafe candidate + refined Batch 2 + selected winner with CI95
    const rejected = completedJob.candidates.filter((c) => c.status === 'rejected');
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    expect(completedJob.selectedCandidateId).toBeTruthy();
    const winner = completedJob.candidates.find(
      (c) => c.candidateId === completedJob.selectedCandidateId
    );
    expect(winner?.confidenceInterval95).toHaveLength(2);
    expect(completedJob.optimizationHistory.length).toBe(2);

    // Verify required event types streamed & persisted monotonically
    const eventTypes = new Set(streamedEvents.map((e) => e.type));
    expect(eventTypes.has('stage.started')).toBe(true);
    expect(eventTypes.has('candidate.rejected')).toBe(true);
    expect(eventTypes.has('optimization.started')).toBe(true);
    expect(eventTypes.has('validation.completed')).toBe(true);
    expect(eventTypes.has('report.created')).toBe(true);
    expect(eventTypes.has('audit.recorded')).toBe(true);
    expect(eventTypes.has('job.completed')).toBe(true);

    // 4. Test WebSocket reconnect + replay using ?afterSequence=N
    const midSeq = Math.floor(streamedEvents.length / 2);
    const replayedEvents: Array<{ sequence: number }> = [];
    await new Promise<void>((resolve) => {
      const ws2 = new WebSocket(
        `${wsBaseUrl}/ws/jobs/${initialJob.jobId}?afterSequence=${midSeq}`
      );
      ws2.on('message', (raw) => {
        const evt = JSON.parse(raw.toString()) as { sequence: number };
        replayedEvents.push(evt);
      });
      setTimeout(() => {
        ws2.close();
        resolve();
      }, 150);
    });
    expect(replayedEvents.length).toBeGreaterThan(0);
    expect(replayedEvents.every((e) => e.sequence > midSeq)).toBe(true);

    // 5. Verify report and SHA-256 audit chain integrity
    const [reportRes, auditRes] = await Promise.all([
      fetch(`${baseUrl}/api/jobs/${initialJob.jobId}/report`),
      fetch(`${baseUrl}/api/pipeline/audit`),
    ]);
    expect(reportRes.status).toBe(200);
    const reportJson = (await reportRes.json()) as { reportMarkdown: string };
    expect(reportJson.reportMarkdown).toContain(initialJob.jobId);

    const auditJson = (await auditRes.json()) as {
      verification: { valid: boolean; totalEntries: number };
    };
    expect(auditJson.verification.valid).toBe(true);
    expect(auditJson.verification.totalEntries).toBeGreaterThanOrEqual(1);
  });

  it('prevents informational requests from triggering simulations and pauses human-authorization directives until approved', async () => {
    // Information request must NOT execute candidates
    const infoRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'What does our safety policy state about thermal drift bounds?',
        inputMode: 'text',
      }),
    });
    expect(infoRes.status).toBe(201);
    const infoJson = (await infoRes.json()) as { job: { jobId: string; intent: string } };
    expect(infoJson.job.intent).toBe('information');
    const doneInfo = await waitForJobTerminal(infoJson.job.jobId);
    expect(doneInfo.status).toBe('completed');
    expect(doneInfo.candidates.length).toBe(0);

    // Physical directive pauses at safety-policy until qualified role approves
    const authRes = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Execute on physical robot actuator immediately for clinical dosing.',
        inputMode: 'text',
      }),
    });
    const authJob = ((await authRes.json()) as { job: { jobId: string } }).job;
    const paused = await waitForJobTerminal(authJob.jobId);
    expect(paused.status).toBe('needs_review');

    // Guest cannot approve
    const guestApprove = await fetch(`${baseUrl}/api/jobs/${authJob.jobId}/approve`, {
      method: 'POST',
    });
    expect(guestApprove.status).toBe(401);

    // Unsupported simulator target is honestly blocked without fabricating metrics
    const unsupportedRes = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Optimize cryo-fpga hardware actuator timing via unsupported-sim kernel.',
        inputMode: 'text',
      }),
    });
    const unsupJob = ((await unsupportedRes.json()) as { job: { jobId: string } }).job;
    const blocked = await waitForJobTerminal(unsupJob.jobId);
    expect(blocked.status).toBe('failed');
    expect(blocked.blockedReason).toContain('No verified virtual simulator adapter');
    expect(blocked.candidates.length).toBe(0);
  });

  it('supports operator cancellation via /api/jobs/:jobId/cancel', async () => {
    const res = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Optimize Langevin dynamics stability across temperature matrix.',
        inputMode: 'matrix',
      }),
    });
    const created = ((await res.json()) as { job: { jobId: string } }).job;
    const cancelRes = await fetch(`${baseUrl}/api/jobs/${created.jobId}/cancel`, {
      method: 'POST',
    });
    expect(cancelRes.status).toBe(200);
    const cancelledJson = (await cancelRes.json()) as { job: { status: string } };
    expect(cancelledJson.job.status).toBe('cancelled');
  });
});
