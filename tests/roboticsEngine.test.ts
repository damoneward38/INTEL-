import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server.ts';
import {
  DEFAULT_ARM_ROBOT_CONFIG,
  DEFAULT_MOBILE_ROBOT_CONFIG,
  ROBOTICS_RESULTS_DIR,
} from '../server/commandPipeline/roboticsBridge.ts';

let server: http.Server;
let baseUrl = '';
let tempDbPath = '';
const createdRoboticsJobIds: string[] = [];

beforeAll(async () => {
  tempDbPath = path.join(os.tmpdir(), `intel-robotics-test-${Date.now()}.sqlite3`);
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

async function waitForPipelineJob(jobId: string, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    const data = (await res.json()) as { job: any };
    if (['completed', 'failed', 'cancelled'].includes(data.job.status)) {
      return data.job;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`Timed out waiting for pipeline job ${jobId}`);
}

describe('Virtual Robotics Research Engine (robotics_engine.py + Command Center)', () => {
  it('runs Python differential_drive clear path AND Research Mobile Robot obstacle collision via POST /api/robotics/run', async () => {
    // 1. Clear-path mobile robot simulation
    const clearRes = await fetch(`${baseUrl}/api/robotics/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...DEFAULT_MOBILE_ROBOT_CONFIG,
        environment: {
          start: [0, 0],
          goal: [4, 4],
          obstacles: [{ center: [1.4, 2.2], radius: 0.35 }],
        },
      }),
    });

    expect(clearRes.status).toBe(201);
    const clearData = (await clearRes.json()) as {
      report: any;
      events: any[];
      sha256Verified: boolean;
    };

    createdRoboticsJobIds.push(clearData.report.job_id);

    expect(clearData.report.simulation_only).toBe(true);
    expect(clearData.report.engine_version).toBe('1.0.0');
    expect(clearData.report.robot.robot_type).toBe('differential_drive');
    expect(clearData.report.trials).toHaveLength(5);
    expect(clearData.report.trials[0].completed).toBe(true);
    expect(clearData.report.trials[0].collision_events).toBe(0);
    expect(clearData.report.evaluation.completion_rate).toBe(1.0);
    expect(clearData.report.evaluation.score).toBeGreaterThan(90);
    expect(clearData.report.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(clearData.sha256Verified).toBe(true);
    expect(clearData.events.some((e) => e.stage === 'report_generation')).toBe(true);

    const lookupRes = await fetch(`${baseUrl}/api/robotics/runs/${clearData.report.job_id}`);
    expect(lookupRes.status).toBe(200);
    const lookup = (await lookupRes.json()) as { report: any; events: any[] };
    expect(lookup.report.sha256).toBe(clearData.report.sha256);
    expect(lookup.events.length).toBeGreaterThanOrEqual(8);

    // 2. Research Mobile Robot preset with obstacle at [2, 2] directly on diagonal path
    const collisionRes = await fetch(`${baseUrl}/api/robotics/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DEFAULT_MOBILE_ROBOT_CONFIG),
    });
    expect(collisionRes.status).toBe(201);
    const collided = (await collisionRes.json()) as { report: any };
    createdRoboticsJobIds.push(collided.report.job_id);
    expect(collided.report.robot.name).toBe('Research Mobile Robot');
    expect(collided.report.evaluation.collision_events).toBe(5);
    expect(collided.report.evaluation.completion_rate).toBe(0);
  });

  it('computes 2-link arm inverse kinematics and detects out-of-reach targets cleanly', async () => {
    const reachableRes = await fetch(`${baseUrl}/api/robotics/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DEFAULT_ARM_ROBOT_CONFIG),
    });
    expect(reachableRes.status).toBe(201);
    const reachable = (await reachableRes.json()) as { report: any };
    createdRoboticsJobIds.push(reachable.report.job_id);
    expect(reachable.report.trials[0].reachable).toBe(true);
    expect(reachable.report.trials[0].within_joint_limits).toBe(true);
    expect(reachable.report.evaluation.score).toBe(100);

    const unreachableRes = await fetch(`${baseUrl}/api/robotics/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...DEFAULT_ARM_ROBOT_CONFIG,
        environment: { target: [3.5, 3.5] },
      }),
    });
    expect(unreachableRes.status).toBe(201);
    const unreachable = (await unreachableRes.json()) as { report: any };
    createdRoboticsJobIds.push(unreachable.report.job_id);
    expect(unreachable.report.trials[0].reachable).toBe(false);
    expect(unreachable.report.evaluation.score).toBe(0);
  });

  it('routes robotics command center requests to robotics-kinematics-adapter across 30 stages', async () => {
    const res = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText:
          'Run differential_drive robotics virtual simulation optimizing max_speed and obstacle_margin_m.',
        inputMode: 'text',
      }),
    });
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as { job: any };

    const done = await waitForPipelineJob(job.jobId);
    expect(done.status).toBe('completed');
    expect(done.domain).toBe('Robotics & Autonomous Kinematics');
    expect(done.simulatorId).toBe('robotics-kinematics-adapter');
    expect(done.stages.every((s: any) => ['completed', 'selected', 'optimization'].includes(s.status))).toBe(
      true
    );
    expect(done.candidates.some((c: any) => c.status === 'rejected')).toBe(true);
    expect(done.candidates.some((c: any) => c.status === 'selected')).toBe(true);
  });
});
