import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server.ts';

describe('Master 9-Stage Orchestrator & Safe UI Coverage Audit API', () => {
  let server: http.Server;
  let baseUrl = '';
  let piToken = '';

  beforeAll(async () => {
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roleOrEmail: 'principal_investigator',
        accessCode: 'PI-LAB-2026',
      }),
    });
    const loginBody = (await loginRes.json()) as { token: string };
    piToken = loginBody.token;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('skips simulation and refuses protocol lock by default unless enableSimulator is explicitly opted in, and excludes sensitive raw text from audit JSONL', async () => {
    const guestRes = await fetch(`${baseUrl}/api/orchestrator/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Unauthorized guest orchestrator test payload.' }),
    });
    expect(guestRes.status).toBe(401);

    const sensitivePhrase = 'CONFIDENTIAL_SECRET_MARKER_XYZ_987';
    const safeRunRes = await fetch(`${baseUrl}/api/orchestrator/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${piToken}`,
      },
      body: JSON.stringify({
        filename: 'safe_default_test.txt',
        text: `Study evaluated at 300 K with ${sensitivePhrase} under DOI 10.1021/acs.jpcb.3c06662.`,
        engine: 'langevin-md',
        enableSimulator: false,
        lockIfBest: true,
      }),
    });
    expect(safeRunRes.status).toBe(201);
    const skippedResult = (await safeRunRes.json()) as {
      auditUuid: string;
      auditLogPath: string;
      reportPath: string;
      simulatorEnabled: boolean;
      evaluationStatus: string;
      locked: boolean;
      reward: number | null;
      stages: Array<{ stage: string; status: string }>;
    };

    expect(skippedResult.simulatorEnabled).toBe(false);
    expect(skippedResult.evaluationStatus).toBe('not_evaluated');
    expect(skippedResult.reward).toBeNull();
    expect(skippedResult.locked).toBe(false);
    expect(skippedResult.stages.find((s) => s.stage === 'execute')?.status).toBe('skipped');
    expect(skippedResult.stages.find((s) => s.stage === 'evaluate')?.status).toBe('skipped');

    const reportAbs = path.resolve(process.cwd(), skippedResult.reportPath);
    expect(fs.existsSync(reportAbs)).toBe(true);

    const auditAbs = path.resolve(process.cwd(), skippedResult.auditLogPath);
    const matchingLines = fs
      .readFileSync(auditAbs, 'utf8')
      .split('\n')
      .filter((line) => line.includes(skippedResult.auditUuid))
      .join('\n');
    expect(matchingLines).not.toContain(sensitivePhrase);
    expect(matchingLines).not.toContain('PI-LAB-2026');
  });

  it('executes all 9 orchestrated stages when enableSimulator is explicitly enabled, locks best protocol, and writes JSON report', async () => {
    const sampleText =
      'Principal investigator evaluation (pi@intel-lab.org, 2026) under DOI 10.1021/acs.jpcb.3c06662 tested Langevin dynamics at 300 K and 1 atm with 95.4% retention. Code: https://github.com/openmm/openmm';
    const form = new FormData();
    form.append(
      'file',
      new Blob([sampleText], { type: 'text/plain' }),
      'orchestrator_e2e_test.txt'
    );
    form.append('engine', 'langevin-md');
    form.append('safetyLimit', '0.8');
    form.append('enableSimulator', 'true');
    form.append('lockIfBest', 'true');

    const runRes = await fetch(`${baseUrl}/api/orchestrator/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${piToken}` },
      body: form,
    });
    expect(runRes.status).toBe(201);

    const result = (await runRes.json()) as {
      auditUuid: string;
      auditLogPath: string;
      reportPath: string;
      simulatorEnabled: boolean;
      evaluationStatus: string;
      filename: string;
      language: string;
      entitiesCount: number;
      embeddingDimensions: number;
      protocolId: string;
      simulationJobId?: string;
      reward: number | null;
      safetyPassed: boolean;
      locked: boolean;
      stages: Array<{ stage: string; status: string }>;
      reportMarkdown: string;
    };

    expect(result.auditUuid.startsWith('aud-')).toBe(true);
    expect(result.simulatorEnabled).toBe(true);
    expect(result.evaluationStatus).toBe('evaluated');
    expect(result.filename).toBe('orchestrator_e2e_test.txt');
    expect(result.language).toBe('en');
    expect(result.entitiesCount).toBeGreaterThanOrEqual(4);
    expect(result.embeddingDimensions).toBeGreaterThanOrEqual(64);
    expect(result.simulationJobId?.startsWith('sim-')).toBe(true);
    expect(result.safetyPassed).toBe(true);
    expect(result.reward ?? 0).toBeGreaterThan(0.5);
    expect(result.locked).toBe(true);
    expect(result.stages.map((s) => s.stage)).toEqual([
      'ingest',
      'detect_lang',
      'extract_entities',
      'embed_text',
      'link_graph',
      'plan_policy',
      'execute',
      'evaluate',
      'learn_and_lock',
    ]);
    expect(fs.existsSync(path.resolve(process.cwd(), result.reportPath))).toBe(true);
  });

  it('persists and retrieves safe UI button coverage audit reports with SKIPPED_UNMARKED enforcement', async () => {
    const postRes = await fetch(`${baseUrl}/api/orchestrator/ui-audit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${piToken}`,
      },
      body: JSON.stringify({
        harnessMode: 'dom-live-sweep',
        targetUrl: baseUrl,
        viewsVisited: ['workspace', 'upload', 'lab:orchestrator'],
        results: [
          { view: 'workspace', label: 'Command Center', disabled: false, safeMarked: true, status: 'CLICKED' },
          { view: 'upload', label: 'Delete Artifact', disabled: false, safeMarked: false, status: 'SKIPPED_UNMARKED' },
        ],
      }),
    });
    expect(postRes.status).toBe(201);
    const saved = (await postRes.json()) as {
      summary: { auditUuid: string; passedCount: number; guardedDisabledCount: number };
    };
    expect(saved.summary.auditUuid.startsWith('ui-')).toBe(true);
    expect(saved.summary.passedCount).toBe(1);
    expect(saved.summary.guardedDisabledCount).toBe(1);

    const overviewRes = await fetch(`${baseUrl}/api/orchestrator/audits`);
    expect(overviewRes.status).toBe(200);
    const overview = (await overviewRes.json()) as {
      uiAudits: Array<{ auditUuid: string }>;
      auditRecords: Array<{ uuid: string }>;
    };
    expect(overview.uiAudits.some((u) => u.auditUuid === saved.summary.auditUuid)).toBe(true);
    expect(overview.auditRecords.some((a) => a.uuid === saved.summary.auditUuid)).toBe(true);
  });
});
