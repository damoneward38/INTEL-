import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapConfidenceInterval,
  rewardFromMetrics,
  validateParameters,
} from '../server/modules/autonomousController.ts';
import { createApp } from '../server.ts';

let server: http.Server;
let baseUrl = '';

async function httpJson(
  endpoint: string,
  options: RequestInit & { token?: string } = {}
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  const res = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

describe('Closed-Loop Autonomous Virtual Simulation Controller', () => {
  beforeAll(async () => {
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('validates parameter keys, finiteness, and bounds strictly', () => {
    expect(() =>
      validateParameters({
        parameter_a: 0.5,
        parameter_b: 0.3,
        parameter_c: 0.8,
      })
    ).not.toThrow();

    expect(() =>
      validateParameters({
        parameter_a: 0.5,
        parameter_b: 0.3,
        unknown_param: 0.2,
      })
    ).toThrow(/do not match/i);

    expect(() =>
      validateParameters({
        parameter_a: 1.25,
        parameter_b: 0.3,
        parameter_c: 0.5,
      })
    ).toThrow(/outside configured bounds/i);

    expect(() =>
      validateParameters({
        parameter_a: Number.NaN,
        parameter_b: 0.3,
        parameter_c: 0.5,
      })
    ).toThrow(/finite number/i);
  });

  it('computes reward and deterministic bootstrap confidence intervals', () => {
    const reward = rewardFromMetrics({ yield: 0.9, toxicity: 0.2, cost: 0.4 });
    expect(reward).toBeCloseTo(0.84, 5);

    const values = [0.72, 0.78, 0.75, 0.81];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const ci1 = bootstrapConfidenceInterval(values, 0.95, 500, 42);
    const ci2 = bootstrapConfidenceInterval(values, 0.95, 500, 42);
    expect(ci1).toEqual(ci2);
    expect(ci1[0]).toBeLessThan(mean);
    expect(ci1[1]).toBeGreaterThan(mean);

    expect(() => bootstrapConfidenceInterval([0.5, 0.6], 0.95, 200, 42)).toThrow(
      /not enough successful replicates/i
    );
  });

  it('enforces RBAC and virtual-only opt-in on /api/autonomous/run, converges with valid SHA-256 chain', async () => {
    // 1. Unauthenticated / guest blocked
    const unauth = await httpJson('/api/autonomous/run', {
      method: 'POST',
      body: JSON.stringify({ virtualModeConfirmed: true }),
    });
    expect(unauth.status).toBe(401);

    // Sign in as Researcher
    const login = await httpJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        roleOrEmail: 'maya.benami@intel-lab.org',
        accessCode: 'RESEARCH-2026',
      }),
    });
    expect(login.status).toBe(200);
    const token = login.body.token as string;
    expect(token).toBeTruthy();

    // 2. Missing explicit virtualModeConfirmed=true rejected
    const unconfirmed = await httpJson('/api/autonomous/run', {
      method: 'POST',
      token,
      body: JSON.stringify({ virtualModeConfirmed: false }),
    });
    expect(unconfirmed.status).toBe(400);

    // 3. Execute bounded closed-loop virtual run
    const runRes = await httpJson('/api/autonomous/run', {
      method: 'POST',
      token,
      body: JSON.stringify({
        batchSize: 6,
        replicates: 3,
        maxIterations: 8,
        maxParallelSimulations: 4,
        targetReward: 0.74,
        confidenceLevel: 0.95,
        minSuccessfulReplicates: 3,
        maxConfidenceIntervalWidth: 0.25,
        convergencePatience: 4,
        randomSeed: 42,
        bootstrapSamples: 600,
        virtualModeConfirmed: true,
      }),
    });
    expect(runRes.status).toBe(201);
    const run = runRes.body.run as Record<string, unknown>;
    expect(run.physicalExecution).toBe(false);
    expect(run.auditChainValid).toBe(true);
    expect(run.bestReward).toBeTypeOf('number');
    expect((run.bestReward as number) > 0.7).toBe(true);
    expect(
      ['converged', 'max_iterations_reached', 'stopped_no_improvement']
    ).toContain(run.status);

    // Verify reproducible JSON report file created on disk
    const reportPath = path.resolve(process.cwd(), run.reportPath as string);
    expect(fs.existsSync(reportPath)).toBe(true);

    // 4. Verify audit hash chain endpoint
    const verifyRes = await httpJson(
      `/api/autonomous/verify?runId=${encodeURIComponent(run.runId as string)}`
    );
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.valid).toBe(true);
    expect((verifyRes.body.checkedEvents as number) >= 4).toBe(true);

    // 5. Verify overview includes run
    const overviewRes = await httpJson('/api/autonomous/overview');
    expect(overviewRes.status).toBe(200);
    expect(overviewRes.body.auditChainValid).toBe(true);
    const runs = overviewRes.body.runs as Array<{ runId: string }>;
    expect(runs.some((r) => r.runId === run.runId)).toBe(true);
  });

  it('supports Python autonomous_controller.py HTTP endpoints /plan, /simulate, /update and blocks physical_execution=true', async () => {
    const planRes = await httpJson('/plan', {
      method: 'POST',
      body: JSON.stringify({
        run_id: 'py_test_run_01',
        iteration: 1,
        batch_size: 3,
        best_reward: null,
        best_candidate: null,
        parameter_bounds: {
          parameter_a: [0, 1],
          parameter_b: [0, 1],
          parameter_c: [0, 1],
        },
        mode: 'virtual_simulation',
      }),
    });
    expect(planRes.status).toBe(200);
    const batch = planRes.body.batch as Array<{
      parameters: Record<string, number>;
    }>;
    expect(batch).toHaveLength(3);

    // Simulate rejects physical_execution: true
    const blockedSim = await httpJson('/simulate', {
      method: 'POST',
      body: JSON.stringify({
        candidate_id: 'cand_1',
        iteration: 1,
        replicate: 1,
        parameters: batch[0].parameters,
        mode: 'physical',
        physical_execution: true,
      }),
    });
    expect(blockedSim.status).toBe(400);

    // Simulate succeeds with physical_execution: false
    const okSim = await httpJson('/simulate', {
      method: 'POST',
      body: JSON.stringify({
        candidate_id: 'cand_1',
        iteration: 1,
        replicate: 1,
        parameters: batch[0].parameters,
        mode: 'virtual',
        physical_execution: false,
      }),
    });
    expect(okSim.status).toBe(200);
    expect(okSim.body.metrics).toBeDefined();

    // Update feedback returns recorded confirmation
    const updateRes = await httpJson('/update', {
      method: 'POST',
      body: JSON.stringify({
        run_id: 'py_test_run_01',
        candidate_id: 'cand_1',
        parameters: batch[0].parameters,
        reward: 0.78,
        confidence_interval: [0.74, 0.82],
        metrics_mean: okSim.body.metrics,
        replicates: 3,
      }),
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.acknowledged).toBe(true);
    expect(updateRes.body.observedEvaluations).toBeGreaterThanOrEqual(1);
  });
});
