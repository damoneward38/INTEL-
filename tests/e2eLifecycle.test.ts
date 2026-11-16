import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server.ts';
import { buildPdfReportBytes } from '../src/utils/exportReport.ts';

describe('Full Lifecycle E2E: Sign Up -> Research/Upload/Sim -> Checkout -> 55/45 Payout Settlement', () => {
  let server: http.Server;
  let baseUrl = '';

  beforeAll(async () => {
    const app = createApp();
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('completes end-to-end onboarding, pipeline execution, checkout, invoicing, and 55/45 payout settlement', async () => {
    const uniq = Date.now();
    const researcherEmail = `researcher.${uniq}@biolab-e2e.org`;
    const piEmail = `pi.${uniq}@biolab-e2e.org`;

    // 1. Self-Service Sign Up (Researcher)
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Dr. Jordan Rivera',
        email: researcherEmail,
        organization: 'BioSystems E2E Lab',
        role: 'researcher',
        accessCode: 'E2E-SECRET-99',
      }),
    });
    expect(signupRes.status).toBe(201);
    const signupBody = (await signupRes.json()) as {
      token: string;
      session: { userId: string; role: string; organization?: string; email: string };
    };
    expect(signupBody.token).toContain('.');
    expect(signupBody.session.role).toBe('researcher');
    expect(signupBody.session.organization).toBe('BioSystems E2E Lab');

    // Duplicate email rejected with 409 Conflict
    const dupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Duplicate User',
        email: researcherEmail,
        role: 'researcher',
        accessCode: 'ANOTHER-PASS-1',
      }),
    });
    expect(dupRes.status).toBe(409);

    // Wrong password rejected; correct login returns new signed token
    const badLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roleOrEmail: researcherEmail,
        accessCode: 'WRONG-CODE',
      }),
    });
    expect(badLoginRes.status).toBe(401);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roleOrEmail: researcherEmail,
        accessCode: 'E2E-SECRET-99',
      }),
    });
    expect(loginRes.status).toBe(200);
    const loginBody = (await loginRes.json()) as { token: string };
    const researcherToken = loginBody.token;

    // 2. Scientific Upload -> Master Pipeline (with simulator enabled) -> Research & PDF Export
    const form = new FormData();
    const csvSample = new Blob(
      [
        'sample_id,temperature_k,yield_pct,stability_idx\nS1,300,91.4,0.88\nS2,310,94.2,0.92\n',
      ],
      { type: 'text/csv' }
    );
    form.append('file', csvSample, 'kinetics_e2e.csv');

    const uploadRes = await fetch(`${baseUrl}/api/all-upload/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${researcherToken}` },
      body: form,
    });
    expect(uploadRes.status).toBe(200);
    const uploadData = (await uploadRes.json()) as {
      uploadId: string;
      analysis: { dataProfile: { rows: number } | null };
    };
    expect(uploadData.analysis.dataProfile?.rows).toBe(2);

    const orchRes = await fetch(`${baseUrl}/api/orchestrator/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({
        uploadId: uploadData.uploadId,
        engine: 'langevin-md',
        safetyLimit: 0.75,
        enableSimulator: true,
        lockIfBest: false,
      }),
    });
    expect(orchRes.status).toBe(201);
    const orchData = (await orchRes.json()) as {
      auditUuid: string;
      evaluationStatus: string;
      reward: number | null;
      simulationJobId?: string;
    };
    expect(orchData.evaluationStatus).toBe('evaluated');
    expect(typeof orchData.reward).toBe('number');
    expect(orchData.simulationJobId).toBeTruthy();

    const retrievalRes = await fetch(
      `${baseUrl}/api/retrieval/search?q=Langevin&limit=4`
    );
    expect(retrievalRes.status).toBe(200);
    const retrievalBody = (await retrievalRes.json()) as {
      results: Array<{ id: string; title: string; license: string; sourceUrl: string; text: string; score: number; origin: 'indexed_corpus' | 'google_search' }>;
    };
    expect(retrievalBody.results.length).toBeGreaterThan(0);

    const planRes = await fetch(`${baseUrl}/api/all-upload/plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({
        researchQuestion: 'Compare Langevin thermostatting stability at 300 K across kinetics CSV',
        domain: 'biophysics',
        context: 'Verified CSV metrics and Lennard-Jones thermostat runs.',
        uploadId: uploadData.uploadId,
      }),
    });
    expect(planRes.status).toBe(200);

    const simRes = await fetch(`${baseUrl}/api/simulation/${orchData.simulationJobId}`);
    expect(simRes.status).toBe(200);
    const simJob = (await simRes.json()) as Parameters<typeof buildPdfReportBytes>[1];
    expect(simJob?.state).toBe('completed');

    const researchRes = await fetch(`${baseUrl}/api/research`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({
        query: 'Compare Langevin thermostatting stability at 300 K',
        language: 'en',
        depth: 'standard',
      }),
    });
    // Without GEMINI_API_KEY configured in test environment, research returns honest 502; with key, returns 200
    expect([200, 502]).toContain(researchRes.status);

    // Voice & Chatbot Console endpoint (/api/research/chat)
    const badChatRes = await fetch(`${baseUrl}/api/research/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'x', persona: 'invalid_persona' }),
    });
    expect(badChatRes.status).toBe(400);

    const chatRes = await fetch(`${baseUrl}/api/research/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({
        message: 'Read through the kinetics file and suggest controls.',
        persona: 'protocol',
        language: 'en',
        history: [],
        artifactContext: {
          filename: 'kinetics_run.csv',
          summary: 'Completeness 65%, domain biophysics',
          excerpt: 'step,temp,yield\n1,300,0.82\n2,310,0.91',
        },
      }),
    });
    expect([200, 502]).toContain(chatRes.status);

    const pdfBytes = buildPdfReportBytes(
      {
        provenanceId: orchData.auditUuid,
        query: 'Compare Langevin thermostatting stability at 300 K',
        language: 'en',
        depth: 'standard',
        model: 'deterministic-retrieval',
        answer: 'Grounded corpus retrieval + isolated Langevin-MD verification.',
        sources: retrievalBody.results,
        corpusHits: retrievalBody.results.length,
        webHits: 0,
        durationMs: 120,
        reviewStatus: 'pending_human_review',
        createdAt: new Date().toISOString(),
      },
      simJob
    );
    expect(new TextDecoder().decode(new Uint8Array(pdfBytes).slice(0, 5))).toBe('%PDF-');
    expect(pdfBytes.byteLength).toBeGreaterThan(500);

    // 3. Enterprise Quote -> Checkout (Immediate & 90-Day Trial)
    // Guest cannot run checkout
    const guestCheckoutRes = await fetch(`${baseUrl}/api/enterprise/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier: 'growth',
        numUsers: 20,
        customization: true,
        billingCycle: 'monthly',
        organization: 'Guest Org',
        billingEmail: 'guest@example.org',
        activateTrialFirst: false,
      }),
    });
    expect(guestCheckoutRes.status).toBe(401);

    const quoteRes = await fetch(`${baseUrl}/api/enterprise/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier: 'growth',
        numUsers: 20,
        customization: true,
        billingCycle: 'monthly',
      }),
    });
    expect(quoteRes.status).toBe(200);
    const quoteBody = (await quoteRes.json()) as {
      quote: { firstMonthTotalUsd: number; whiteLabelSetupFeeUsd: number };
    };
    expect(quoteBody.quote.whiteLabelSetupFeeUsd).toBe(1499);
    expect(quoteBody.quote.firstMonthTotalUsd).toBe(499 + 20 * 50 + 1499); // 2998

    const checkoutRes = await fetch(`${baseUrl}/api/enterprise/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({
        tier: 'growth',
        numUsers: 20,
        customization: true,
        billingCycle: 'monthly',
        organization: 'BioSystems E2E Lab',
        billingEmail: researcherEmail,
        partnerName: 'BioSystems Consortium Partner',
        activateTrialFirst: false,
      }),
    });
    expect(checkoutRes.status).toBe(201);
    const checkoutBody = (await checkoutRes.json()) as {
      order: {
        orderId: string;
        invoiceNumber: string;
        dueTodayUsd: number;
        contractTotalUsd: number;
        paymentMode: string;
        trialStatus: string;
        receiptDigestSha256: string;
      };
      payout: {
        payoutId: string;
        grossUsd: number;
        platformShareUsd: number;
        partnerShareUsd: number;
        status: string;
      };
    };
    expect(checkoutBody.order.invoiceNumber).toMatch(/^INV-2026-/);
    expect(checkoutBody.order.paymentMode).toBe('internal_sandbox_ledger');
    expect(checkoutBody.order.trialStatus).toBe('invoiced_immediate');
    expect(checkoutBody.order.dueTodayUsd).toBe(2998);
    expect(checkoutBody.order.receiptDigestSha256).toHaveLength(64);
    expect(checkoutBody.payout.status).toBe('pending_payout');
    expect(checkoutBody.payout.grossUsd).toBe(2998);
    expect(checkoutBody.payout.platformShareUsd).toBe(1648.9);
    expect(checkoutBody.payout.partnerShareUsd).toBe(1349.1);
    expect(
      Number(
        (checkoutBody.payout.platformShareUsd + checkoutBody.payout.partnerShareUsd).toFixed(2)
      )
    ).toBe(2998);

    // Trial checkout ($0 due today, commitment accrued)
    const trialCheckoutRes = await fetch(`${baseUrl}/api/enterprise/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${researcherToken}`,
      },
      body: JSON.stringify({
        tier: 'starter',
        numUsers: 5,
        customization: false,
        billingCycle: 'yearly',
        organization: 'BioSystems Pilot Team',
        billingEmail: researcherEmail,
        activateTrialFirst: true,
      }),
    });
    expect(trialCheckoutRes.status).toBe(201);
    const trialBody = (await trialCheckoutRes.json()) as {
      order: { trialStatus: string; dueTodayUsd: number; contractTotalUsd: number };
    };
    expect(trialBody.order.trialStatus).toBe('active_90d_trial');
    expect(trialBody.order.dueTodayUsd).toBe(0);
    expect(trialBody.order.contractTotalUsd).toBeGreaterThan(0);

    // 4. Payout Settlement (RBAC blocked for Researcher, allowed for PI / Auditor)
    const forbiddenSettleRes = await fetch(
      `${baseUrl}/api/enterprise/payouts/${checkoutBody.payout.payoutId}/settle`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${researcherToken}` },
      }
    );
    expect(forbiddenSettleRes.status).toBe(403);

    // Sign up PI partner account and settle the 45% payout
    const piSignupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Prof. Elena Partner PI',
        email: piEmail,
        organization: 'BioSystems E2E Lab',
        role: 'principal_investigator',
        accessCode: 'PI-SECRET-2026',
      }),
    });
    expect(piSignupRes.status).toBe(201);
    const piBody = (await piSignupRes.json()) as { token: string };

    const settleRes = await fetch(
      `${baseUrl}/api/enterprise/payouts/${checkoutBody.payout.payoutId}/settle`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${piBody.token}` },
      }
    );
    expect(settleRes.status).toBe(200);
    const settledBody = (await settleRes.json()) as {
      payout: { status: string; settlementReference: string; partnerShareUsd: number };
    };
    expect(settledBody.payout.status).toBe('settled');
    expect(settledBody.payout.settlementReference).toMatch(/^STL-/);
    expect(settledBody.payout.partnerShareUsd).toBe(1349.1);

    // Duplicate settlement returns 409 Conflict
    const dupSettleRes = await fetch(
      `${baseUrl}/api/enterprise/payouts/${checkoutBody.payout.payoutId}/settle`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${piBody.token}` },
      }
    );
    expect(dupSettleRes.status).toBe(409);

    // 5. Verify Overview, Provenance, and Knowledge Flux reflect full lifecycle
    const overviewRes = await fetch(`${baseUrl}/api/enterprise/overview`);
    expect(overviewRes.status).toBe(200);
    const overview = (await overviewRes.json()) as {
      orders: Array<{ orderId: string }>;
      payouts: Array<{ payoutId: string; status: string }>;
      payoutTotals: {
        orderCount: number;
        settledCount: number;
        settledUsd: number;
        pendingUsd: number;
      };
    };
    expect(overview.payoutTotals.orderCount).toBeGreaterThanOrEqual(2);
    expect(overview.payoutTotals.settledCount).toBeGreaterThanOrEqual(1);
    expect(overview.payoutTotals.settledUsd).toBeGreaterThanOrEqual(1349.1);
    expect(overview.payoutTotals.pendingUsd).toBeGreaterThan(0);

    const fluxRes = await fetch(`${baseUrl}/api/flux/events?topic=market.transaction`);
    expect(fluxRes.status).toBe(200);
    const fluxBody = (await fluxRes.json()) as {
      events: Array<{ summary: string }>;
    };
    expect(fluxBody.events.some((e) => e.summary.includes('Settled 45% partner payout'))).toBe(
      true
    );
  });
});
