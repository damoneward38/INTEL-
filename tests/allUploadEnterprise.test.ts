import http from 'node:http';
import type { AddressInfo } from 'node:net';
import AdmZip from 'adm-zip';
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

describe('All-Upload Optimizer & Enterprise Suite APIs', () => {
  it('returns honest capabilities and safety boundaries', async () => {
    const res = await fetch(`${baseUrl}/api/all-upload/capabilities`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      allowedExtensions: string[];
      notYetIntegrated: string[];
      safety: { medicalDecisions: string; humanReviewRequired: boolean };
    };
    expect(data.allowedExtensions).toContain('.pdf');
    expect(data.allowedExtensions).toContain('.pdb');
    expect(data.notYetIntegrated.length).toBeGreaterThan(2);
    expect(data.safety.medicalDecisions).toBe('Not supported');
    expect(data.safety.humanReviewRequired).toBe(true);
  });

  it('parses CSV missingness & duplicates, rejects unsupported extensions and unsafe zip traversal', async () => {
    // 1. Unsupported extension -> 415
    const badForm = new FormData();
    badForm.append('file', new Blob(['binary'], { type: 'application/octet-stream' }), 'malware.exe');
    const badRes = await fetch(`${baseUrl}/api/all-upload/upload`, {
      method: 'POST',
      body: badForm,
    });
    expect(badRes.status).toBe(415);

    // 2. CSV upload -> exact row, missing cell, and duplicate row profiling
    const csvContent = [
      'sample_id,temp_k,rmsd',
      'S1,300,0.42',
      'S1,300,0.42',
      'S2,,0.51',
    ].join('\n');
    const csvForm = new FormData();
    csvForm.append('file', new Blob([csvContent], { type: 'text/csv' }), 'md_metrics.csv');
    const csvRes = await fetch(`${baseUrl}/api/all-upload/upload`, {
      method: 'POST',
      body: csvForm,
    });
    expect(csvRes.status).toBe(200);
    const csvData = (await csvRes.json()) as {
      uploadId: string;
      sha256: string;
      analysis: {
        scoreWarning: string;
        dataProfile: {
          rows: number;
          columns: number;
          missingCells: number;
          duplicateRows: number;
        };
      };
    };
    expect(csvData.sha256).toHaveLength(64);
    expect(csvData.analysis.scoreWarning).toContain('not a scientific validity');
    expect(csvData.analysis.dataProfile.rows).toBe(3);
    expect(csvData.analysis.dataProfile.columns).toBe(3);
    expect(csvData.analysis.dataProfile.missingCells).toBe(1);
    expect(csvData.analysis.dataProfile.duplicateRows).toBe(1);

    // 3. Unsafe ZIP with path traversal -> 400
    const badZip = new AdmZip();
    badZip.addFile('escape.txt', Buffer.from('traversal attempt', 'utf8'));
    badZip.getEntries()[0].entryName = '../escape.txt';
    const badZipForm = new FormData();
    badZipForm.append(
      'file',
      new Blob([new Uint8Array(badZip.toBuffer())], { type: 'application/zip' }),
      'traversal.zip'
    );
    const badZipRes = await fetch(`${baseUrl}/api/all-upload/upload`, {
      method: 'POST',
      body: badZipForm,
    });
    expect(badZipRes.status).toBe(400);

    // 4. Safe ZIP archive -> inspected manifest
    const goodZip = new AdmZip();
    goodZip.addFile('notes/protocol.txt', Buffer.from('Sample size n = 40 randomized double-blind control group with confidence interval and IRB ethics approval limitations preregistered.', 'utf8'));
    const goodZipForm = new FormData();
    goodZipForm.append(
      'file',
      new Blob([new Uint8Array(goodZip.toBuffer())], { type: 'application/zip' }),
      'study_bundle.zip'
    );
    const goodZipRes = await fetch(`${baseUrl}/api/all-upload/upload`, {
      method: 'POST',
      body: goodZipForm,
    });
    expect(goodZipRes.status).toBe(200);
    const goodZipData = (await goodZipRes.json()) as {
      analysisStatus: string;
      archive: { archiveFileCount: number };
      analysis: { heuristicCompletenessScore: number };
    };
    expect(goodZipData.analysisStatus).toBe('archive_extracted_review_required');
    expect(goodZipData.archive.archiveFileCount).toBe(1);
    expect(goodZipData.analysis.heuristicCompletenessScore).toBe(100);
  });

  it('plans methodology steps and enforces RBAC on All-Upload corpus indexing', async () => {
    const txtForm = new FormData();
    txtForm.append(
      'file',
      new Blob(
        [
          'Randomized double-blind clinical pilot study investigating ligand affinity stability with control group and p-value statistics.',
        ],
        { type: 'text/plain' }
      ),
      'ligand_pilot.txt'
    );
    const uploadRes = await fetch(`${baseUrl}/api/all-upload/upload`, {
      method: 'POST',
      body: txtForm,
    });
    expect(uploadRes.status).toBe(200);
    const uploaded = (await uploadRes.json()) as { uploadId: string };

    const planRes = await fetch(`${baseUrl}/api/all-upload/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        researchQuestion: 'Validate ligand binding variance under NVT thermostatting.',
        domain: 'Biophysics',
        uploadId: uploaded.uploadId,
      }),
    });
    expect(planRes.status).toBe(200);
    const plan = (await planRes.json()) as {
      steps: Array<{ stage: string; action: string }>;
      executionEnabled: boolean;
    };
    expect(plan.steps).toHaveLength(6);
    expect(plan.executionEnabled).toBe(false);

    // Guest cannot index uploaded artifact to shared RAG corpus
    const guestIndex = await fetch(
      `${baseUrl}/api/all-upload/${uploaded.uploadId}/index-corpus`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Ligand Pilot Note',
          authors: 'Lab Team',
          domain: 'Biophysics',
          license: 'CC-BY-4.0',
          sourceUrl: 'https://example.org/ligand-pilot',
        }),
      }
    );
    expect(guestIndex.status).toBe(401);

    const researcherToken = await loginAs('researcher', 'RESEARCH-2026');
    const authIndex = await fetch(
      `${baseUrl}/api/all-upload/${uploaded.uploadId}/index-corpus`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${researcherToken}`,
        },
        body: JSON.stringify({
          title: 'Ligand Pilot Note',
          authors: 'Lab Team',
          domain: 'Biophysics',
          license: 'CC-BY-4.0',
          sourceUrl: 'https://example.org/ligand-pilot',
        }),
      }
    );
    expect(authIndex.status).toBe(201);
  });

  it('computes accurate 3-tier quotes, enforces RBAC on white-label overrides, and grades rubrics', async () => {
    const quoteRes = await fetch(`${baseUrl}/api/enterprise/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier: 'growth',
        numUsers: 20,
        customization: true,
        billingCycle: 'yearly',
      }),
    });
    expect(quoteRes.status).toBe(200);
    const { quote } = (await quoteRes.json()) as {
      quote: {
        baseMonthlyUsd: number;
        seatCostMonthlyUsd: number;
        whiteLabelSetupFeeUsd: number;
        monthlyRecurringUsd: number;
        effectiveMonthlyAfterDiscountUsd: number;
        annualSavingsUsd: number;
      };
    };
    expect(quote.baseMonthlyUsd).toBe(499);
    expect(quote.seatCostMonthlyUsd).toBe(1000);
    expect(quote.whiteLabelSetupFeeUsd).toBe(1499);
    expect(quote.monthlyRecurringUsd).toBe(1499);
    expect(quote.effectiveMonthlyAfterDiscountUsd).toBeCloseTo(1349.1, 1);
    expect(quote.annualSavingsUsd).toBe(Math.round(1499 * 12 * 0.1));

    // Researcher cannot override enterprise white-label settings -> 403
    const researcherToken = await loginAs('researcher', 'RESEARCH-2026');
    const forbiddenWl = await fetch(`${baseUrl}/api/enterprise/whitelabel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({
        enabled: true,
        brandName: 'BioCorp',
        brandNameHe: 'ביו-קורפ',
        tagline: 'Genomics Cloud',
        taglineHe: 'ענן גנומיקה',
        accentColor: 'emerald',
        customDomain: 'app.biocorp.io',
      }),
    });
    expect(forbiddenWl.status).toBe(403);

    // PI succeeds -> 200
    const piToken = await loginAs('principal_investigator', 'PI-LAB-2026');
    const okWl = await fetch(`${baseUrl}/api/enterprise/whitelabel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${piToken}`,
      },
      body: JSON.stringify({
        enabled: true,
        brandName: 'BioCorp',
        brandNameHe: 'ביו-קורפ',
        tagline: 'Genomics Cloud',
        taglineHe: 'ענן גנומיקה',
        accentColor: 'emerald',
        customDomain: 'app.biocorp.io',
      }),
    });
    expect(okWl.status).toBe(200);

    // Rubric grading
    const rubricRes = await fetch(`${baseUrl}/api/enterprise/rubric/grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Quantum Folding Lab #1',
        submissionText:
          'Hypothesis tests primary outcome. Randomized double-blind control group with ANOVA confidence interval and p-value. IRB ethics approval and CC-BY-4.0 license. Limitations and preregistered sha-256 open data documented.',
      }),
    });
    expect(rubricRes.status).toBe(200);
    const { result } = (await rubricRes.json()) as {
      result: { totalScore: number; gradeBand: string };
    };
    expect(result.totalScore).toBeGreaterThanOrEqual(85);
    expect(result.gradeBand).toBe('Exemplary');
  });

  it('enforces tier simulation quota limits without exceeding cap and persists ledger snapshot', async () => {
    const researcherToken = await loginAs('researcher', 'RESEARCH-2026');

    // Switch quota cap to Starter (max 10 simulations)
    const setStarter = await fetch(`${baseUrl}/api/enterprise/quota`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({ tier: 'starter' }),
    });
    expect(setStarter.status).toBe(200);
    const starterBody = (await setStarter.json()) as {
      quota: {
        activeTier: string;
        simulationsUsed: number;
        simulationsMax: number;
        simulationsRemaining: number;
        ledgerPath: string;
      };
    };
    expect(starterBody.quota.activeTier).toBe('starter');
    expect(starterBody.quota.simulationsMax).toBe(10);

    // Exhaust remaining Starter quota cleanly up to the ceiling
    const remaining = starterBody.quota.simulationsRemaining;
    for (let i = 0; i < remaining; i++) {
      const okSim = await fetch(`${baseUrl}/api/simulation/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${researcherToken}`,
        },
        body: JSON.stringify({ engine: 'langevin-md', steps: 100 }),
      });
      expect(okSim.status).toBe(202);
    }

    // Next simulation request must stop BEFORE going past the quota limit (429)
    const overQuotaSim = await fetch(`${baseUrl}/api/simulation/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({ engine: 'langevin-md', steps: 100 }),
    });
    expect(overQuotaSim.status).toBe(429);

    // Next autonomous closed-loop run must also stop before going past quota limit (429)
    const overQuotaAuto = await fetch(`${baseUrl}/api/autonomous/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({
        batchSize: 4,
        replicates: 3,
        maxIterations: 2,
        virtualModeConfirmed: true,
      }),
    });
    expect(overQuotaAuto.status).toBe(429);

    // Upgrade back to Enterprise (Unlimited) so capacity is restored
    const setEnt = await fetch(`${baseUrl}/api/enterprise/quota`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({ tier: 'enterprise' }),
    });
    expect(setEnt.status).toBe(200);
    const entBody = (await setEnt.json()) as {
      quota: { activeTier: string; simulationsMax: number | null };
    };
    expect(entBody.quota.activeTier).toBe('enterprise');
    expect(entBody.quota.simulationsMax).toBeNull();
  });
});
