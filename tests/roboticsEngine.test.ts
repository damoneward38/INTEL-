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
    expect(clearData.report.engine_version).toBe('1.1.0');
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
    const simStage = done.stages.find((s: any) => s.id === 'virtual-simulation');
    expect(simStage?.data?.roboticsReport?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('serves robotics_pipeline_manifest.json, runs research_upload_example.json, and integrates uploaded robotics JSON into Command Center', async () => {
    const manifestRes = await fetch(`${baseUrl}/api/robotics/manifest`);
    expect(manifestRes.status).toBe(200);
    const manifestData = (await manifestRes.json()) as {
      manifest: any;
      configs: Array<{ name: string; config: any }>;
    };

    expect(manifestData.manifest.domain).toBe('robotics');
    expect(manifestData.manifest.version).toBe('1.1.0');
    expect(manifestData.manifest.execution_mode).toBe('virtual_simulation_only');
    expect(manifestData.manifest.pipeline).toHaveLength(24);
    expect(manifestData.manifest.supported_initial_models).toEqual([
      'differential_drive',
      'two_link_arm',
      'quadrotor_3d',
    ]);
    expect(manifestData.manifest.hardware_execution.enabled).toBe(false);
    expect(manifestData.manifest.future_simulator_adapters.every((a: any) => a.enabled === false)).toBe(
      true
    );
    expect(manifestData.configs.map((c) => c.name)).toEqual([
      'aerial_quadrotor_inspection.json',
      'mobile_robot_avoidance.json',
      'mobile_robot_navigation.json',
      'research_upload_example.json',
      'robotic_arm_reach.json',
    ]);

    const uploadCfg = manifestData.configs.find((c) => c.name === 'research_upload_example.json')!.config;
    const runRes = await fetch(`${baseUrl}/api/robotics/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(uploadCfg),
    });
    expect(runRes.status).toBe(201);
    const runData = (await runRes.json()) as { report: any };
    createdRoboticsJobIds.push(runData.report.job_id);
    expect(runData.report.robot.name).toBe('Uploaded Research Robot');
    expect(runData.report.trials).toHaveLength(10);
    expect(runData.report.sha256).toMatch(/^[a-f0-9]{64}$/);

    // Upload the JSON config into /api/upload and run through 30-stage /api/command
    const artRes = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'research_upload_example.json',
        mimeType: 'application/json',
        content: JSON.stringify(uploadCfg),
      }),
    });
    expect(artRes.status).toBe(201);
    const { artifact } = (await artRes.json()) as { artifact: any };

    const cmdRes = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: 'Analyze Uploaded Research Robot navigation dataset and evaluate stability.',
        inputMode: 'file',
        uploadId: artifact.uploadId,
      }),
    });
    expect(cmdRes.status).toBe(202);
    const { job } = (await cmdRes.json()) as { job: any };
    const done = await waitForPipelineJob(job.jobId);
    expect(done.status).toBe('completed');
    expect(done.reportMarkdown).toContain('Virtual Robotics Engine Report');
    const simStage = done.stages.find((s: any) => s.id === 'virtual-simulation');
    if (simStage?.data?.roboticsReport?.job_id) {
      createdRoboticsJobIds.push(simStage.data.roboticsReport.job_id);
    }
    expect(simStage?.data?.roboticsReport?.trialCount).toBe(10);
  });

  it('navigates around obstacles with potential_field planner, plans multi-waypoint arm trajectories, and simulates quadrotor_3d missions', async () => {
    const manifestRes = await fetch(`${baseUrl}/api/robotics/manifest`);
    const manifestData = (await manifestRes.json()) as {
      configs: Array<{ name: string; config: any }>;
    };

    // 1. Potential-field mobile avoidance around obstacles at [2,2] and [3.2,2.5]
    const avoidCfg = manifestData.configs.find((c) => c.name === 'mobile_robot_avoidance.json')!.config;
    const avoidRes = await fetch(`${baseUrl}/api/robotics/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(avoidCfg),
    });
    expect(avoidRes.status).toBe(201);
    const avoidData = (await avoidRes.json()) as { report: any };
    createdRoboticsJobIds.push(avoidData.report.job_id);
    expect(avoidData.report.simulation.planner).toBe('potential_field');
    expect(avoidData.report.evaluation.collision_events).toBe(0);
    expect(avoidData.report.evaluation.completion_rate).toBe(1);
    expect(avoidData.report.evaluation.score).toBeGreaterThan(80);
    expect(avoidData.report.trials[0].trajectory.length).toBeGreaterThan(5);

    // 2. Multi-waypoint 2-link arm with elbow_up IK
    const armWpRes = await fetch(`${baseUrl}/api/robotics/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        robot: {
          ...DEFAULT_ARM_ROBOT_CONFIG.robot,
          elbow_config: 'elbow_up',
        },
        environment: {
          waypoints: [
            [0.6, 0.2],
            [0.45, 0.45],
            [0.2, 0.65],
          ],
        },
      }),
    });
    expect(armWpRes.status).toBe(201);
    const armWp = (await armWpRes.json()) as { report: any };
    createdRoboticsJobIds.push(armWp.report.job_id);
    expect(armWp.report.trials[0].elbow_config).toBe('elbow_up');
    expect(armWp.report.trials[0].waypoints_count).toBe(3);
    expect(armWp.report.trials[0].joint_angles_deg[1]).toBeLessThan(0);
    expect(armWp.report.trials[0].trajectory.length).toBeGreaterThan(8);

    // 3. 3D Quadrotor waypoint flight with obstacle clearance & battery reserve
    const quadCfg = manifestData.configs.find(
      (c) => c.name === 'aerial_quadrotor_inspection.json'
    )!.config;
    const quadRes = await fetch(`${baseUrl}/api/robotics/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quadCfg),
    });
    expect(quadRes.status).toBe(201);
    const quad = (await quadRes.json()) as { report: any };
    createdRoboticsJobIds.push(quad.report.job_id);
    expect(quad.report.robot.robot_type).toBe('quadrotor_3d');
    expect(quad.report.evaluation.collision_events).toBe(0);
    expect(quad.report.evaluation.completion_rate).toBe(1);
    expect(quad.report.evaluation.mean_battery_remaining_pct).toBeGreaterThan(95);
    expect(quad.report.trials[0].trajectory[0]).toHaveLength(3);

    // 4. Command Center quadrotor_3d pipeline execution attaches full 3D Twin report telemetry
    const cmdRes = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText:
          'Simulate quadrotor_3d potential_field waypoint trajectory optimizing max_speed and obstacle_margin_m.',
        inputMode: 'text',
      }),
    });
    expect(cmdRes.status).toBe(202);
    const { job } = (await cmdRes.json()) as { job: any };
    const done = await waitForPipelineJob(job.jobId);
    expect(done.status).toBe('completed');
    const simStage = done.stages.find((s: any) => s.id === 'virtual-simulation');
    if (simStage?.data?.roboticsReport?.job_id) {
      createdRoboticsJobIds.push(simStage.data.roboticsReport.job_id);
    }
    expect(simStage?.data?.roboticsReport?.robot?.robot_type).toBe('quadrotor_3d');
    expect(simStage?.data?.roboticsReport?.trials?.[0]?.trajectory?.length).toBeGreaterThan(5);
  });
});
