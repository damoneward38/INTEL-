#!/usr/bin/env tsx
/**
 * run.ts — Local-first INTEL Master Pipeline CLI & Safe UI Audit Runner
 *
 * Safety rules:
 *   - Isolated simulator is DISABLED unless --enable-simulator is supplied.
 *   - No physical laboratory execution is implemented.
 *   - No protocol is locked without a verified evaluation.
 *   - UI testing (--test-ui) only clicks controls marked data-testid="safe-ui-test"
 *     and skips destructive, unmarked, hidden, or disabled controls.
 *
 * Usage:
 *   npx tsx run.ts <path-to-file>
 *   npx tsx run.ts <path-to-file> --enable-simulator
 *   npx tsx run.ts <path-to-file> --enable-simulator --test-ui
 */

import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const BASE_URL = process.env.INTEL_SERVER_URL || 'http://127.0.0.1:3000';
const LOGIN_ROLE = process.env.INTEL_ROLE || 'principal_investigator';
const ACCESS_CODE = process.env.INTEL_ACCESS_CODE || 'PI-LAB-2026';
const ENGINE = process.env.INTEL_SIM_ENGINE || 'langevin-md';
const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'run.log');

function logLine(message: string): void {
  const line = `${new Date().toISOString()} [run.ts] ${message}`;
  console.log(line);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
  } catch {
    // Non-fatal if fs is read-only
  }
}

async function authenticate(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleOrEmail: LOGIN_ROLE, accessCode: ACCESS_CODE }),
  });
  if (!res.ok) {
    throw new Error(`Authentication failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { token: string; session: { role: string } };
  logLine(`Authenticated as ${data.session.role}`);
  return data.token;
}

async function runPipeline(filePath: string, token: string, enableSimulator: boolean) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Input file does not exist: ${absPath}`);
  }
  const buffer = fs.readFileSync(absPath);
  if (buffer.byteLength <= 0) {
    throw new Error(`Input file is empty: ${absPath}`);
  }
  const filename = path.basename(absPath);
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  form.append('engine', ENGINE);
  form.append('enableSimulator', String(enableSimulator));
  form.append('lockIfBest', String(enableSimulator));

  logLine(
    `Submitting "${filename}" (${buffer.byteLength} bytes, simulator=${enableSimulator}) to POST /api/orchestrator/run`
  );
  const res = await fetch(`${BASE_URL}/api/orchestrator/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const payload = (await res.json()) as {
    auditUuid?: string;
    reportPath?: string;
    reward?: number | null;
    simulationJobId?: string;
    evaluationStatus?: string;
    locked?: boolean;
    stages?: Array<{ stage: string; status: string; durationMs: number; summary: string }>;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(`Master pipeline failed (${res.status}): ${payload.error || 'Unknown error'}`);
  }

  for (const s of payload.stages ?? []) {
    logLine(`  [${s.stage}:${s.status}] (${s.durationMs}ms) ${s.summary}`);
  }
  logLine(
    `Pipeline completed: auditUuid=${payload.auditUuid}, report=${payload.reportPath}, evaluation=${payload.evaluationStatus}, reward=${payload.reward}, locked=${payload.locked}`
  );
  return payload;
}

async function runSafeUiAudit(token: string) {
  try {
    const pwModuleName = 'playwright';
    const pw = (await import(/* @vite-ignore */ pwModuleName)) as {
      chromium: {
        launch: (opts: { headless: boolean }) => Promise<{
          newPage: () => Promise<{
            goto: (u: string, opts?: { waitUntil?: string }) => Promise<void>;
            querySelectorAll: (sel: string) => Promise<
              Array<{
                innerText: () => Promise<string>;
                isVisible: () => Promise<boolean>;
                isEnabled: () => Promise<boolean>;
                click: () => Promise<void>;
              }>
            >;
          }>;
          close: () => Promise<void>;
        }>;
      };
    };

    const browser = await pw.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    // Strictly target safe opt-in controls only
    const safeButtons = await page.querySelectorAll('button[data-testid="safe-ui-test"]');
    const allButtons = await page.querySelectorAll('button');
    const results: Array<{
      view: string;
      label: string;
      disabled: boolean;
      safeMarked: boolean;
      status: 'CLICKED' | 'SKIPPED_NOT_VISIBLE' | 'SKIPPED_DISABLED' | 'SKIPPED_UNMARKED' | 'FAIL';
      detail?: string;
    }> = [];

    for (const btn of safeButtons) {
      const label = (await btn.innerText()).trim() || '(safe icon button)';
      if (!(await btn.isVisible())) {
        results.push({
          view: 'landing',
          label,
          disabled: false,
          safeMarked: true,
          status: 'SKIPPED_NOT_VISIBLE',
        });
        continue;
      }
      if (!(await btn.isEnabled())) {
        results.push({
          view: 'landing',
          label,
          disabled: true,
          safeMarked: true,
          status: 'SKIPPED_DISABLED',
        });
        continue;
      }
      try {
        await btn.click();
        results.push({
          view: 'landing',
          label,
          disabled: false,
          safeMarked: true,
          status: 'CLICKED',
        });
      } catch (err) {
        results.push({
          view: 'landing',
          label,
          disabled: false,
          safeMarked: true,
          status: 'FAIL',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const unmarkedCount = Math.max(0, allButtons.length - safeButtons.length);
    if (unmarkedCount > 0) {
      results.push({
        view: 'landing',
        label: `${unmarkedCount} unmarked / mutating button(s)`,
        disabled: false,
        safeMarked: false,
        status: 'SKIPPED_UNMARKED',
        detail: 'Skipped by safe UI audit policy',
      });
    }

    await browser.close();

    const auditRes = await fetch(`${BASE_URL}/api/orchestrator/ui-audit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        harnessMode: 'playwright-chromium',
        targetUrl: BASE_URL,
        viewsVisited: ['landing'],
        results,
      }),
    });
    const auditJson = await auditRes.json();
    logLine(`Playwright safe UI audit stored: ${JSON.stringify(auditJson)}`);
    return;
  } catch {
    logLine('Playwright Chromium not installed in runtime; executing read-only HTTP + WebSocket contract probe.');
  }

  const probes = [
    '/api/health',
    '/api/corpus',
    '/api/all-upload/capabilities',
    '/api/enterprise/overview',
    '/api/auto-optimize/status',
    '/api/orchestrator/audits',
  ];

  const results: Array<{
    view: string;
    label: string;
    disabled: boolean;
    safeMarked: boolean;
    status: 'OK' | 'FAIL';
    detail?: string;
  }> = [];

  for (const endpoint of probes) {
    try {
      const r = await fetch(`${BASE_URL}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      results.push({
        view: endpoint,
        label: `GET ${endpoint}`,
        disabled: false,
        safeMarked: true,
        status: r.ok ? 'OK' : 'FAIL',
        detail: `HTTP ${r.status}`,
      });
    } catch (err) {
      results.push({
        view: endpoint,
        label: `GET ${endpoint}`,
        disabled: false,
        safeMarked: true,
        status: 'FAIL',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const wsStatus = await new Promise<'OK' | 'FAIL'>((resolve) => {
    const wsUrl = BASE_URL.replace(/^http/, 'ws') + '/ws/flux';
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.terminate();
      resolve('FAIL');
    }, 3000);
    ws.on('message', () => {
      clearTimeout(timer);
      ws.close();
      resolve('OK');
    });
    ws.on('error', () => {
      clearTimeout(timer);
      resolve('FAIL');
    });
  });

  results.push({
    view: '/ws/flux',
    label: 'WS /ws/flux',
    disabled: false,
    safeMarked: true,
    status: wsStatus,
    detail: wsStatus === 'OK' ? 'init frame received' : 'timeout/error',
  });

  const savedRes = await fetch(`${BASE_URL}/api/orchestrator/ui-audit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      harnessMode: 'http-ws-contract-probe',
      targetUrl: BASE_URL,
      viewsVisited: [...probes, '/ws/flux'],
      results,
    }),
  });
  const saved = (await savedRes.json()) as {
    summary?: { auditUuid: string; passedCount: number; totalButtons: number };
  };
  logLine(
    `Safe contract probe saved: auditUuid=${saved.summary?.auditUuid} (${saved.summary?.passedCount}/${saved.summary?.totalButtons} OK)`
  );
}

async function main() {
  const args = process.argv.slice(2);
  const enableSimulator = args.includes('--enable-simulator');
  const testUi = args.includes('--test-ui');
  const positional = args.filter((a) => !a.startsWith('--'));
  const targetFile = positional[0];

  if (!targetFile) {
    console.error(
      'Usage: npx tsx run.ts <path-to-file> [--enable-simulator] [--test-ui]'
    );
    process.exit(1);
  }

  const token = await authenticate();
  const runResult = await runPipeline(targetFile, token, enableSimulator);
  if (testUi) {
    await runSafeUiAudit(token);
  }

  console.log(
    JSON.stringify(
      {
        status: 'COMPLETED',
        auditUuid: runResult.auditUuid,
        reportPath: runResult.reportPath,
        simulatorEnabled: enableSimulator,
        evaluationStatus: runResult.evaluationStatus,
        locked: runResult.locked,
        physicalExecution: false,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      {
        status: 'FAILED',
        error: err instanceof Error ? err.message : String(err),
        physicalExecution: false,
      },
      null,
      2
    )
  );
  process.exit(1);
});
