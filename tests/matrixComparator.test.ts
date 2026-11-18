import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server.ts';
import { ROBOTICS_RESULTS_DIR } from '../server/commandPipeline/roboticsBridge.ts';

let server: http.Server;
let baseUrl = '';
let tempDbPath = '';
const createdRoboticsJobIds: string[] = [];

beforeAll(async () => {
  tempDbPath = path.join(os.tmpdir(), `intel-matrix-test-${Date.now()}.sqlite3`);
  process.env.INTEL_PIPELINE_DB_PATH = tempDbPath;

  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const jobId of createdRoboticsJobIds) {
    for (const suffix of ['.json', '.events.json']) {
      const p = path.join(ROBOTICS_RESULTS_DIR, `${jobId}${suffix}`);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
  if (tempDbPath && fs.existsSync(tempDbPath)) {
    fs.unlinkSync(tempDbPath);
  }
  delete process.env.INTEL_PIPELINE_DB_PATH;
});

describe('Multi-Matrix Diff & Parameter Sweep Workbench', () => {
  it('lists all 3 built-in matrix presets via GET /api/pipeline/matrix-presets', async () => {
    const res = await fetch(`${baseUrl}/api/pipeline/matrix-presets`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { presets: Array<{ id: string; matrices: unknown[] }> };
    expect(data.presets).toHaveLength(3);
    expect(data.presets.map((p) => p.id)).toEqual([
      'formulation-three-matrix',
      'robotics-parameter-sweep',
      'thermal-process-sweep',
    ]);
  });

  it('evaluates three-matrix formulation study, identifies Pareto winner, rejects thermal stress rows with fixes, and logs SHA-256 audit entry', async () => {
    const presetsRes = await fetch(`${baseUrl}/api/pipeline/matrix-presets`);
    const { presets } = (await presetsRes.json()) as { presets: Array<any> };
    const formulationPreset = presets.find((p) => p.id === 'formulation-three-matrix');
    expect(formulationPreset).toBeTruthy();

    const cmpRes = await fetch(`${baseUrl}/api/pipeline/compare-matrices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matrices: formulationPreset.matrices,
        domain: formulationPreset.domain,
        simulatorId: formulationPreset.simulatorId,
        replicates: 4,
      }),
    });

    expect(cmpRes.status).toBe(200);
    const { comparison } = (await cmpRes.json()) as { comparison: any };

    expect(comparison.evaluatedCandidates).toHaveLength(6);
    expect(comparison.paretoCandidateIds.length).toBeGreaterThanOrEqual(1);
    expect(comparison.winnerCandidateId).toBeTruthy();
    expect(comparison.sha256).toMatch(/^[a-f0-9]{64}$/);

    const winner = comparison.evaluatedCandidates.find(
      (c: any) => c.candidateId === comparison.winnerCandidateId
    );
    expect(winner?.status).toBe('selected');

    const thermalRows = comparison.evaluatedCandidates.filter(
      (c: any) => c.matrixName === 'Matrix C (Thermal Stress)'
    );
    expect(thermalRows).toHaveLength(2);
    for (const row of thermalRows) {
      expect(row.status).toBe('rejected');
      expect(typeof row.recommendedFix).toBe('string');
      expect(row.recommendedFix.length).toBeGreaterThan(10);
    }

    const auditRes = await fetch(
      `${baseUrl}/api/pipeline/audit?jobId=${encodeURIComponent(comparison.comparisonId)}`
    );
    expect(auditRes.status).toBe(200);
    const auditData = (await auditRes.json()) as {
      entries: Array<{ jobId: string; eventType: string; stage: string }>;
      verification: { valid: boolean };
    };
    expect(auditData.verification.valid).toBe(true);
    expect(auditData.entries.some((e) => e.jobId === comparison.comparisonId)).toBe(true);
  });

  it('detects structural parameter differences (missingInMatrices) and returns HTTP 400 when fewer than 2 matrices are submitted', async () => {
    const badRes = await fetch(`${baseUrl}/api/pipeline/compare-matrices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matrices: [{ name: 'Only One', rows: [{ temperature: 300 }] }],
      }),
    });
    expect(badRes.status).toBe(400);

    const diffRes = await fetch(`${baseUrl}/api/pipeline/compare-matrices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'Formulation & Stability',
        simulatorId: 'langevin-md-adapter',
        replicates: 3,
        matrices: [
          {
            name: 'Matrix Alpha',
            rows: [{ temperature: 300, pressure: 1.0, pH: 7.1, ionicStrength: 0.14 }],
          },
          {
            name: 'Matrix Beta',
            rows: [{ temperature: 310, pressure: 1.2, pH: 7.0, customAdditive: 0.25 }],
          },
        ],
      }),
    });

    expect(diffRes.status).toBe(200);
    const { comparison } = (await diffRes.json()) as { comparison: any };
    const additiveDiff = comparison.parameterDiffs.find(
      (d: any) => d.parameter === 'customAdditive'
    );
    expect(additiveDiff).toBeTruthy();
    expect(additiveDiff.presentInMatrices).toEqual(['Matrix Beta']);
    expect(additiveDiff.missingInMatrices).toEqual(['Matrix Alpha']);
  });

  it('runs robotics sweep with verifyWithRoboticsPython=true and returns a verified simulation_only Python report', async () => {
    const presetsRes = await fetch(`${baseUrl}/api/pipeline/matrix-presets`);
    const { presets } = (await presetsRes.json()) as { presets: Array<any> };
    const roboticsPreset = presets.find((p) => p.id === 'robotics-parameter-sweep');
    expect(roboticsPreset).toBeTruthy();

    const cmpRes = await fetch(`${baseUrl}/api/pipeline/compare-matrices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matrices: roboticsPreset.matrices,
        domain: roboticsPreset.domain,
        simulatorId: roboticsPreset.simulatorId,
        replicates: 3,
        verifyWithRoboticsPython: true,
      }),
    });

    expect(cmpRes.status).toBe(200);
    const { comparison } = (await cmpRes.json()) as { comparison: any };
    expect(comparison.roboticsVerificationReport).toBeTruthy();
    expect(comparison.roboticsVerificationReport.simulation_only).toBe(true);
    expect(comparison.roboticsVerificationReport.sha256).toMatch(/^[a-f0-9]{64}$/);
    if (comparison.roboticsVerificationReport.job_id) {
      createdRoboticsJobIds.push(comparison.roboticsVerificationReport.job_id);
    }
  });
});
