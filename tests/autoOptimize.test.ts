import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server.ts';
import { initializeCorpus } from '../server/corpusIndex.ts';

let server: http.Server;
let baseUrl = '';

beforeAll(async () => {
  initializeCorpus();
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
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

async function loginAs(roleOrEmail: string, accessCode: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleOrEmail, accessCode }),
  });
  expect(res.status).toBe(200);
  const data = (await res.json()) as { token: string };
  return data.token;
}

describe('AutoOptimizeAI Constrained Optimizer & Entity Graph', () => {
  it('enforces approval gate, bounded proposals, hard safety constraints, and registry lock RBAC', async () => {
    const statusRes = await fetch(`${baseUrl}/api/auto-optimize/status`);
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as {
      physicalExecution: boolean;
      notClaimed: string[];
    };
    expect(status.physicalExecution).toBe(false);
    expect(status.notClaimed.length).toBeGreaterThanOrEqual(4);

    // Guest blocked from creating protocol
    const guestCreate = await fetch(`${baseUrl}/api/auto-optimize/protocols`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Unauthorized Demo',
        objective: 'maximize',
        parameter: {
          name: 'temp',
          initial: 20,
          minimum: 10,
          maximum: 30,
          step: 1,
          unit: 'C',
        },
        budget: 50,
        maximumExperiments: 10,
        maximumCostPerExperiment: 10,
        safetyLimit: 0.8,
        safetyAcknowledged: true,
      }),
    });
    expect(guestCreate.status).toBe(401);

    const researcherToken = await loginAs('researcher', 'RESEARCH-2026');

    // Invalid bounds rejected with 400
    const badBounds = await fetch(`${baseUrl}/api/auto-optimize/protocols`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({
        name: 'Bad Bounds Demo',
        objective: 'maximize',
        parameter: {
          name: 'temp',
          initial: 15,
          minimum: 20,
          maximum: 10,
          step: 1,
          unit: 'C',
        },
        budget: 50,
        maximumExperiments: 10,
        maximumCostPerExperiment: 10,
        safetyLimit: 0.8,
        safetyAcknowledged: true,
      }),
    });
    expect(badBounds.status).toBe(400);

    // Valid protocol creation
    const createRes = await fetch(`${baseUrl}/api/auto-optimize/protocols`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({
        name: 'Constrained Reaction Yield Study',
        objective: 'maximize',
        parameter: {
          name: 'catalyst_pct',
          initial: 2.0,
          minimum: 0.5,
          maximum: 2.2,
          step: 0.3,
          unit: 'pct',
        },
        budget: 40,
        maximumExperiments: 8,
        maximumCostPerExperiment: 10,
        safetyLimit: 0.8,
        safetyAcknowledged: true,
      }),
    });
    expect(createRes.status).toBe(201);
    const { protocol } = (await createRes.json()) as {
      protocol: { id: string; status: string };
    };
    expect(protocol.status).toBe('draft_pending_approval');

    // Unapproved protocol cannot propose increments
    const blockedPropose = await fetch(
      `${baseUrl}/api/auto-optimize/protocols/${protocol.id}/propose`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${researcherToken}` },
      }
    );
    expect(blockedPropose.status).toBe(403);

    // Human approve
    const approveRes = await fetch(
      `${baseUrl}/api/auto-optimize/protocols/${protocol.id}/approve`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${researcherToken}` },
      }
    );
    expect(approveRes.status).toBe(200);

    // Propose step clamps safely within [0.5, 2.2] (2.0 + 0.3 = 2.3 > 2.2, clamps down)
    const propRes = await fetch(
      `${baseUrl}/api/auto-optimize/protocols/${protocol.id}/propose`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${researcherToken}` },
      }
    );
    expect(propRes.status).toBe(200);
    const propData = (await propRes.json()) as {
      proposal: { newValue: number; physicalExecution: boolean; executionMode: string };
    };
    expect(propData.proposal.physicalExecution).toBe(false);
    expect(propData.proposal.executionMode).toBe('software_only');
    expect(propData.proposal.newValue).toBeGreaterThanOrEqual(0.5);
    expect(propData.proposal.newValue).toBeLessThanOrEqual(2.2);

    // Unsafe measurement (safety < 0.80) rejected with 422
    const unsafeRes = await fetch(
      `${baseUrl}/api/auto-optimize/protocols/${protocol.id}/results`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${researcherToken}`,
        },
        body: JSON.stringify({
          measurements: { efficiency: 0.95, safety: 0.72, cost: 0.1, novelty: 0.5 },
          experimentCost: 2,
        }),
      }
    );
    expect(unsafeRes.status).toBe(422);

    // Safe measurement recorded and sets bestReward
    const safeRes = await fetch(
      `${baseUrl}/api/auto-optimize/protocols/${protocol.id}/results`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${researcherToken}`,
        },
        body: JSON.stringify({
          measurements: { efficiency: 0.9, safety: 0.9, cost: 0.2, novelty: 0.4 },
          experimentCost: 2,
        }),
      }
    );
    expect(safeRes.status).toBe(201);
    const safeData = (await safeRes.json()) as {
      run: { reward: number };
      isNewBest: boolean;
    };
    expect(safeData.isNewBest).toBe(true);
    // 0.5*0.9 + 0.3*0.9 + 0.05*0.4 - 0.15*0.2 = 0.45 + 0.27 + 0.02 - 0.03 = 0.71
    expect(safeData.run.reward).toBeCloseTo(0.71, 3);

    // Researcher blocked from registry lock -> 403; PI succeeds -> 200
    const resLock = await fetch(
      `${baseUrl}/api/auto-optimize/protocols/${protocol.id}/lock`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${researcherToken}` },
      }
    );
    expect(resLock.status).toBe(403);

    const piToken = await loginAs('principal_investigator', 'PI-LAB-2026');
    const piLock = await fetch(
      `${baseUrl}/api/auto-optimize/protocols/${protocol.id}/lock`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${piToken}` },
      }
    );
    expect(piLock.status).toBe(200);
    const lockedData = (await piLock.json()) as { protocol: { locked: boolean } };
    expect(lockedData.protocol.locked).toBe(true);
  });

  it('extracts structured DOI/email/URL entities and searches the knowledge entity graph', async () => {
    const ingestRes = await fetch(`${baseUrl}/api/auto-optimize/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: 'enzyme_study.txt',
        text: 'Lead investigator pi@university.edu published DOI 10.1038/s41586-026-00001 in 2026 at 300 K via https://example.org/data reporting 92% yield.',
      }),
    });
    expect(ingestRes.status).toBe(201);
    const { document } = (await ingestRes.json()) as {
      document: {
        language: string;
        entitiesCount: number;
        entities: Array<{ type: string; text: string }>;
      };
    };
    expect(document.language).toBe('en');
    expect(document.entities.some((e) => e.type === 'doi')).toBe(true);
    expect(document.entities.some((e) => e.type === 'email')).toBe(true);

    const graphRes = await fetch(`${baseUrl}/api/auto-optimize/graph?q=10.1038`);
    expect(graphRes.status).toBe(200);
    const graphData = (await graphRes.json()) as {
      matches: Array<{ entityType: string; name: string }>;
    };
    expect(graphData.matches.some((m) => m.name.includes('10.1038'))).toBe(true);
  });
});
