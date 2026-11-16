import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { listCorpusChunks } from '../corpusIndex.ts';
import { listFeedback } from '../feedbackStore.ts';
import { logger } from '../logger.ts';
import { listProvenance, recordProvenance } from '../provenance.ts';
import { listSimulationJobs } from '../simulationEngine.ts';
import { listAllUploads } from './allUploadService.ts';
import { getFluxStats, listFluxEvents, publishFluxEvent } from './knowledgeFlux.ts';
import type {
  AuthSession,
  EnterpriseCheckoutOrder,
  EnterpriseOverviewResponse,
  EnterpriseQuotaStatus,
  EnterpriseQuoteResult,
  EnterpriseTierId,
  LaunchChecklistItem,
  PartnerPayoutRecord,
  PartnerPayoutTotals,
  PartnershipStage,
  PricingTierSpec,
  RubricCriterionResult,
  RubricGradeResult,
  UsageAnalyticsSummary,
  WhiteLabelConfig,
} from '../types.ts';

const COMMERCIAL_LEDGER_FILENAME = process.env.VITEST
  ? 'commercial_ledger.vitest.json'
  : 'commercial_ledger.json';
const COMMERCIAL_LEDGER_PATH = path.resolve(
  process.cwd(),
  'data',
  COMMERCIAL_LEDGER_FILENAME
);
const COMMERCIAL_LEDGER_REL = `data/${COMMERCIAL_LEDGER_FILENAME}`;

const TIER_QUOTAS: Record<
  EnterpriseTierId,
  { name: string; simulationsMax: number | null; vectorQuotaMb: number }
> = {
  starter: { name: 'Starter', simulationsMax: 10, vectorQuotaMb: 1024 },
  growth: { name: 'Growth', simulationsMax: 100, vectorQuotaMb: 102400 },
  enterprise: { name: 'Enterprise', simulationsMax: null, vectorQuotaMb: 1048576 },
};

export const PRICING_TIERS: PricingTierSpec[] = [
  {
    id: 'starter',
    name: 'Starter',
    targetAudience: 'Start-ups & independent research labs',
    monthlyBaseUsd: 49,
    vectorQuotaLabel: '1 GB vector DB',
    simulationsQuotaLabel: '10 simulations / month',
    coreFeatures: [
      'Core grounded RAG + 3D spatial workspace',
      '1 GB vector DB',
      '10 isolated simulations / month',
      'All-Upload file analyzer & CSV profiler',
    ],
    addOns: ['Custom voice tweaks'],
    trialDays: 90,
    yearlyDiscountPct: 10,
  },
  {
    id: 'growth',
    name: 'Growth',
    targetAudience: 'SMEs & academic research consortia',
    monthlyBaseUsd: 499,
    vectorQuotaLabel: '100 GB vector DB',
    simulationsQuotaLabel: '100 simulations / month',
    coreFeatures: [
      'Unlimited RAG queries & 100 GB vector DB',
      '100 simulations / month',
      'Basic white-labeling (logo, accent color, tagline)',
      'Collaborative Yjs CRDT experiment sandbox',
    ],
    addOns: ['API access & priority SLA support'],
    trialDays: 90,
    yearlyDiscountPct: 10,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    targetAudience: 'Pharmaceutical & biopharma data organizations',
    monthlyBaseUsd: 4999,
    vectorQuotaLabel: 'Unlimited data + 1 TB vector DB',
    simulationsQuotaLabel: 'Unlimited simulations',
    coreFeatures: [
      'Unlimited data + 1 TB dedicated vector DB',
      'Unlimited isolated worker simulations',
      'Full white-label + custom modules + PGx AES-256-GCM vault',
      'HIPAA / ISO 27001 readiness compliance suite',
    ],
    addOns: ['Enterprise SSO, immutable audit export, private-cloud / on-prem deployment'],
    trialDays: 90,
    yearlyDiscountPct: 10,
  },
];

const WHITE_LABEL_SETUP_USD = 1499;
const PER_USER_MONTHLY_USD = 50;

let brandConfig: WhiteLabelConfig = {
  enabled: false,
  brandName: 'INTEL',
  brandNameHe: 'אינטל',
  tagline: 'Research Intelligence Command Center',
  taglineHe: 'מרכז פיקוד ומחקר מדעי',
  accentColor: 'cyan',
  customDomain: 'intel.research-lab.local',
  complianceSuite: {
    hipaaReady: true,
    iso27001Controls: true,
    auditRetentionDays: 365,
  },
  updatedBy: 'system',
  updatedAt: new Date().toISOString(),
};

const PARTNERSHIP_PLAYBOOK: PartnershipStage[] = [
  {
    step: 1,
    phase: 'Discovery Call',
    timeline: 'Week 1',
    focus: 'Identify highest-leverage data, genomic, or molecular bottleneck.',
    deliverable: 'Workflow & compliance boundary brief',
    commercialModel: 'No cost — covered by 90-day pilot framework',
  },
  {
    step: 2,
    phase: 'Proof of Concept (PoC)',
    timeline: '2 Weeks',
    focus: 'Build 1 customized INTEL module with partner corpus or CSV/FASTA dataset.',
    deliverable: 'Live bilingual sandbox & SHA-256 audited telemetry report',
    commercialModel: 'Pre-scoped pilot SLA',
  },
  {
    step: 3,
    phase: 'Pilot Evaluation',
    timeline: '30 Days',
    focus: 'Gather quantitative benchmarks (time saved, citation precision, simulation parity).',
    deliverable: 'Executive ROI & governance validation scorecard',
    commercialModel: '90-day evaluation window',
  },
  {
    step: 4,
    phase: 'Co-Development Agreement',
    timeline: '6 Months',
    focus: 'Define joint IP boundaries, white-label overrides, and custom connector adapters.',
    deliverable: 'Signed Co-Dev MSA + HIPAA/ISO 27001 addendum',
    commercialModel: 'Starter / Growth / Enterprise base + $1,499 white-label setup',
  },
  {
    step: 5,
    phase: 'Revenue Split',
    timeline: 'Ongoing Commercialization',
    focus: 'Transparent joint distribution across consortia and institutional seats.',
    deliverable: 'Automated quarterly usage ledger export',
    commercialModel: '55% INTEL Platform / 45% Domain Partner',
  },
  {
    step: 6,
    phase: 'Support & Uptime SLAs',
    timeline: '24/7 Operations',
    focus: 'Clear escalation paths, telemetry health checks, and bug resolution.',
    deliverable: '99.9% API uptime target + incident audit trail',
    commercialModel: 'Included in Growth Priority / Enterprise SLA',
  },
];

const launchChecklist: LaunchChecklistItem[] = [
  {
    id: 'chk-pricing',
    category: 'Pricing & Contracts',
    task: 'Finalize tier quotes, 90-day pilot terms, and 10% yearly billing schedule',
    done: true,
  },
  {
    id: 'chk-whitelabel',
    category: 'White-Label Kit',
    task: 'Verify brand override (logo text, accent color, tagline, custom domain)',
    done: true,
  },
  {
    id: 'chk-compliance',
    category: 'Security & Compliance',
    task: 'Validate SHA-256 provenance ledger, RBAC roles, and AES-256-GCM consent gates',
    done: true,
  },
  {
    id: 'chk-all-upload',
    category: 'All-Upload Optimizer',
    task: 'Stress-test PDF/DOCX/CSV/ZIP extraction limits and path-traversal guardrails',
    done: true,
  },
  {
    id: 'chk-partners',
    category: 'Go-to-Market Pilot',
    task: 'Publish 2-week PoC agreement for initial university or biotech design partner',
    done: false,
  },
];

export function calculateEnterpriseQuote(params: {
  tier: EnterpriseTierId;
  numUsers: number;
  customization: boolean;
  billingCycle: 'monthly' | 'yearly';
}): EnterpriseQuoteResult {
  const tierSpec =
    PRICING_TIERS.find((t) => t.id === params.tier) ?? PRICING_TIERS[1];
  const safeUsers = Math.max(1, Math.min(10000, Math.round(params.numUsers)));

  const baseMonthlyUsd = tierSpec.monthlyBaseUsd;
  const seatCostMonthlyUsd = safeUsers * PER_USER_MONTHLY_USD;
  const whiteLabelSetupFeeUsd = params.customization ? WHITE_LABEL_SETUP_USD : 0;

  const monthlyRecurringUsd = baseMonthlyUsd + seatCostMonthlyUsd;
  const discountMultiplier =
    params.billingCycle === 'yearly'
      ? 1 - tierSpec.yearlyDiscountPct / 100
      : 1;
  const effectiveMonthlyAfterDiscountUsd = Number(
    (monthlyRecurringUsd * discountMultiplier).toFixed(2)
  );
  const annualRecurringBeforeDiscount = monthlyRecurringUsd * 12;
  const annualContractUsd = Math.round(
    annualRecurringBeforeDiscount * discountMultiplier + whiteLabelSetupFeeUsd
  );
  const annualSavingsUsd =
    params.billingCycle === 'yearly'
      ? Math.round(annualRecurringBeforeDiscount * (tierSpec.yearlyDiscountPct / 100))
      : 0;
  const firstMonthTotalUsd = Math.round(
    effectiveMonthlyAfterDiscountUsd + whiteLabelSetupFeeUsd
  );

  return {
    tier: tierSpec.id,
    tierName: tierSpec.name,
    numUsers: safeUsers,
    customization: params.customization,
    billingCycle: params.billingCycle,
    baseMonthlyUsd,
    perUserMonthlyUsd: PER_USER_MONTHLY_USD,
    seatCostMonthlyUsd,
    whiteLabelSetupFeeUsd,
    monthlyRecurringUsd,
    effectiveMonthlyAfterDiscountUsd,
    firstMonthTotalUsd,
    annualContractUsd,
    annualSavingsUsd,
    trialDays: tierSpec.trialDays,
  };
}

export function getBrandConfig(): WhiteLabelConfig {
  return {
    ...brandConfig,
    complianceSuite: { ...brandConfig.complianceSuite },
  };
}

export function updateBrandConfig(
  updates: {
    enabled: boolean;
    brandName: string;
    brandNameHe: string;
    tagline: string;
    taglineHe: string;
    accentColor: WhiteLabelConfig['accentColor'];
    customDomain: string;
    hipaaReady?: boolean;
    iso27001Controls?: boolean;
  },
  session: AuthSession
): WhiteLabelConfig {
  brandConfig = {
    enabled: updates.enabled,
    brandName: updates.brandName.trim() || 'INTEL',
    brandNameHe: updates.brandNameHe.trim() || 'אינטל',
    tagline: updates.tagline.trim() || 'Research Intelligence Command Center',
    taglineHe: updates.taglineHe.trim() || 'מרכז פיקוד ומחקר מדעי',
    accentColor: updates.accentColor,
    customDomain: updates.customDomain.trim().toLowerCase() || 'intel.research-lab.local',
    complianceSuite: {
      hipaaReady: updates.hipaaReady ?? brandConfig.complianceSuite.hipaaReady,
      iso27001Controls:
        updates.iso27001Controls ?? brandConfig.complianceSuite.iso27001Controls,
      auditRetentionDays: brandConfig.complianceSuite.auditRetentionDays,
    },
    updatedBy: session.userId,
    updatedAt: new Date().toISOString(),
  };

  recordProvenance({
    kind: 'auth',
    actorId: session.userId,
    actorRole: session.role,
    action: 'enterprise:whitelabel-override',
    rawInput: JSON.stringify(brandConfig),
    modelOrEngine: 'white-label-registry',
    licenses: ['Enterprise Tenant Configuration'],
    sourceUrls: [],
    metadata: {
      enabled: brandConfig.enabled,
      customDomain: brandConfig.customDomain,
      accentColor: brandConfig.accentColor,
    },
  });

  publishFluxEvent({
    topic: 'governance.audit',
    key: 'white-label',
    actorRole: session.role,
    summary: `Updated white-label override (${brandConfig.brandName} · ${brandConfig.customDomain})`,
    payload: {
      enabled: brandConfig.enabled,
      brandName: brandConfig.brandName,
      customDomain: brandConfig.customDomain,
    },
  });

  logger.info('enterprise', 'White-label brand override updated', {
    actor: session.userId,
    enabled: brandConfig.enabled,
    domain: brandConfig.customDomain,
  });

  persistCommercialLedger();
  return getBrandConfig();
}

export function toggleLaunchChecklistItem(
  itemId: string,
  session: AuthSession
): LaunchChecklistItem[] | null {
  const item = launchChecklist.find((entry) => entry.id === itemId);
  if (!item) return null;
  item.done = !item.done;

  recordProvenance({
    kind: 'auth',
    actorId: session.userId,
    actorRole: session.role,
    action: 'enterprise:checklist-toggle',
    rawInput: `${item.id}:${item.done}`,
    modelOrEngine: 'launch-checklist',
    licenses: ['Internal Operations'],
    sourceUrls: [],
  });

  persistCommercialLedger();
  return launchChecklist.map((entry) => ({ ...entry }));
}

export function computeLiveUsageAnalytics(): UsageAnalyticsSummary {
  const corpusChunks = listCorpusChunks().length;
  const totalUploads = listAllUploads(100).length;
  const simulationsCompleted = listSimulationJobs().filter(
    (job) => job.state === 'completed'
  ).length;
  const provenanceEvents = listProvenance(300).length;
  const peerReviewsSubmitted = listFeedback(100).length;
  const fluxEventsTotal = getFluxStats().totalEvents;

  const estimatedHoursSaved = Number(
    (
      totalUploads * 0.75 +
      simulationsCompleted * 1.4 +
      peerReviewsSubmitted * 0.5 +
      Math.min(40, corpusChunks * 0.25)
    ).toFixed(1)
  );

  return {
    corpusChunks,
    totalUploads,
    simulationsCompleted,
    provenanceEvents,
    peerReviewsSubmitted,
    fluxEventsTotal,
    estimatedHoursSaved,
  };
}

export function generateSmartPlatformAlerts(): EnterpriseOverviewResponse['alerts'] {
  const alerts: EnterpriseOverviewResponse['alerts'] = [];
  const chunks = listCorpusChunks();
  const unverifiedDocs = new Set(
    chunks.filter((c) => !c.licenseRecord.verified).map((c) => c.docId)
  );
  if (unverifiedDocs.size > 0) {
    alerts.push({
      id: `al-lic-${crypto.createHash('md5').update(String(unverifiedDocs.size)).digest('hex').slice(0, 6)}`,
      level: 'warn',
      title: `${unverifiedDocs.size} indexed document(s) pending SPDX license verification`,
      detail: 'Compliance Auditor or PI sign-off recommended before commercial training export.',
    });
  }

  const uploads = listAllUploads(10);
  const lowCompleteness = uploads.filter(
    (u) => u.analysis && u.analysis.heuristicCompletenessScore < 50
  );
  if (lowCompleteness.length > 0) {
    alerts.push({
      id: 'al-upl-score',
      level: 'warn',
      title: `${lowCompleteness.length} recent upload(s) flagged missing methodology sections`,
      detail: `Latest: ${lowCompleteness[0].filename} (${lowCompleteness[0].analysis?.heuristicCompletenessScore}% keyword indicator).`,
    });
  }

  const recentFlux = listFluxEvents(5);
  if (recentFlux.length > 0) {
    alerts.push({
      id: 'al-flux-latest',
      level: 'info',
      title: `Latest Knowledge Flux event on ${recentFlux[0].topic}`,
      detail: recentFlux[0].summary,
    });
  }

  return alerts;
}

export function gradeSubmissionWithRubric(params: {
  title: string;
  submissionText: string;
}): RubricGradeResult {
  const lower = params.submissionText.toLowerCase();

  const evalRules: Array<{
    criterion: string;
    maxPoints: number;
    strongTerms: string[];
    partialTerms: string[];
    guidance: string;
  }> = [
    {
      criterion: 'Testable Hypothesis & Primary Outcome',
      maxPoints: 20,
      strongTerms: ['hypothesis', 'primary outcome', 'endpoint', 'null hypothesis'],
      partialTerms: ['objective', 'goal', 'investigate', 'aim'],
      guidance: 'State a falsifiable hypothesis and specify a measurable primary endpoint.',
    },
    {
      criterion: 'Experimental Controls & Design Rigor',
      maxPoints: 20,
      strongTerms: ['control group', 'placebo', 'negative control', 'randomized', 'blinded'],
      partialTerms: ['control', 'baseline', 'comparison', 'sample size'],
      guidance: 'Explicitly justify negative/baseline controls, randomization, and sample size.',
    },
    {
      criterion: 'Statistical Methods & Uncertainty',
      maxPoints: 20,
      strongTerms: ['confidence interval', 'p-value', 'anova', 'regression', 'standard deviation'],
      partialTerms: ['statistics', 'variance', 'error bar', 'mean'],
      guidance: 'Pre-specify statistical tests, effect sizes, and uncertainty bounds.',
    },
    {
      criterion: 'Ethics, Governance & Licensing',
      maxPoints: 20,
      strongTerms: ['irb', 'ethics approval', 'informed consent', 'cc-by', 'mit', 'spdx'],
      partialTerms: ['consent', 'ethics', 'license', 'attribution'],
      guidance: 'Include IRB/consent status and machine-readable SPDX source licenses.',
    },
    {
      criterion: 'Limitations & Reproducibility',
      maxPoints: 20,
      strongTerms: ['limitations', 'reproducibility', 'preregistered', 'sha-256', 'open data'],
      partialTerms: ['bias', 'uncertainty', 'assumption', 'code'],
      guidance: 'Add a dedicated limitations section plus artifact checksums or repository links.',
    },
  ];

  const criteria: RubricCriterionResult[] = evalRules.map((rule) => {
    const strongHits = rule.strongTerms.filter((t) => lower.includes(t)).length;
    const partialHits = rule.partialTerms.filter((t) => lower.includes(t)).length;

    let earnedPoints = 0;
    let status: RubricCriterionResult['status'] = 'missing';
    let feedback = rule.guidance;

    if (strongHits >= 2 || (strongHits >= 1 && partialHits >= 1)) {
      earnedPoints = rule.maxPoints;
      status = 'met';
      feedback = 'Clear methodological evidence detected in submission.';
    } else if (strongHits === 1 || partialHits >= 1) {
      earnedPoints = Math.round(rule.maxPoints * 0.6);
      status = 'partial';
      feedback = `Partially addressed. ${rule.guidance}`;
    }

    return {
      criterion: rule.criterion,
      maxPoints: rule.maxPoints,
      earnedPoints,
      status,
      feedback,
    };
  });

  const totalScore = criteria.reduce((acc, c) => acc + c.earnedPoints, 0);
  const gradeBand: RubricGradeResult['gradeBand'] =
    totalScore >= 85
      ? 'Exemplary'
      : totalScore >= 65
        ? 'Proficient'
        : totalScore >= 40
          ? 'Developing'
          : 'Needs Revision';

  return {
    title: params.title.trim() || 'Untitled Research Submission',
    totalScore,
    maxScore: 100,
    gradeBand,
    criteria,
    evaluatedAt: new Date().toISOString(),
  };
}

let activeTier: EnterpriseTierId = 'growth';
let simulationsConsumed = 0;
let ledgerPersistedAt = new Date().toISOString();
const checkoutOrders: EnterpriseCheckoutOrder[] = [];
const partnerPayouts: PartnerPayoutRecord[] = [];

function persistCommercialLedger(): void {
  try {
    fs.mkdirSync(path.dirname(COMMERCIAL_LEDGER_PATH), { recursive: true });
    ledgerPersistedAt = new Date().toISOString();
    fs.writeFileSync(
      COMMERCIAL_LEDGER_PATH,
      JSON.stringify(
        {
          activeTier,
          simulationsConsumed,
          brandConfig,
          launchChecklist,
          checkoutOrders,
          partnerPayouts,
          persistedAt: ledgerPersistedAt,
        },
        null,
        2
      ),
      'utf8'
    );
  } catch (err) {
    logger.warn('enterprise', 'Failed writing commercial ledger snapshot', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function loadCommercialLedger(): void {
  if (process.env.VITEST) return;
  try {
    if (!fs.existsSync(COMMERCIAL_LEDGER_PATH)) return;
    const raw = fs.readFileSync(COMMERCIAL_LEDGER_PATH, 'utf8');
    const parsed = JSON.parse(raw) as {
      activeTier?: EnterpriseTierId;
      simulationsConsumed?: number;
      brandConfig?: WhiteLabelConfig;
      launchChecklist?: LaunchChecklistItem[];
      checkoutOrders?: EnterpriseCheckoutOrder[];
      partnerPayouts?: PartnerPayoutRecord[];
      persistedAt?: string;
    };
    if (parsed.activeTier && TIER_QUOTAS[parsed.activeTier]) {
      activeTier = parsed.activeTier;
    }
    if (typeof parsed.simulationsConsumed === 'number' && parsed.simulationsConsumed >= 0) {
      simulationsConsumed = parsed.simulationsConsumed;
    }
    if (parsed.brandConfig) {
      brandConfig = parsed.brandConfig;
    }
    if (Array.isArray(parsed.launchChecklist) && parsed.launchChecklist.length > 0) {
      launchChecklist.splice(0, launchChecklist.length, ...parsed.launchChecklist);
    }
    if (Array.isArray(parsed.checkoutOrders)) {
      checkoutOrders.splice(0, checkoutOrders.length, ...parsed.checkoutOrders);
    }
    if (Array.isArray(parsed.partnerPayouts)) {
      partnerPayouts.splice(0, partnerPayouts.length, ...parsed.partnerPayouts);
    }
    if (parsed.persistedAt) {
      ledgerPersistedAt = parsed.persistedAt;
    }
  } catch (err) {
    logger.warn('enterprise', 'Could not reload commercial ledger snapshot', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

loadCommercialLedger();

export class CommercialSuiteError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function getQuotaStatus(): EnterpriseQuotaStatus {
  const tierSpec = TIER_QUOTAS[activeTier];
  const uploads = listAllUploads(500);
  const uploadMb = uploads.reduce((sum, u) => sum + u.sizeBytes / (1024 * 1024), 0);
  const corpusMb = listCorpusChunks().length * 0.05;
  const storageUsedMb = Number((uploadMb + corpusMb).toFixed(2));
  const simulationsRemaining =
    tierSpec.simulationsMax === null
      ? null
      : Math.max(0, tierSpec.simulationsMax - simulationsConsumed);
  const utilizationPct =
    tierSpec.simulationsMax === null
      ? 0
      : Math.min(100, Math.round((simulationsConsumed / tierSpec.simulationsMax) * 100));

  return {
    activeTier,
    activeTierName: tierSpec.name,
    simulationsUsed: simulationsConsumed,
    simulationsMax: tierSpec.simulationsMax,
    simulationsRemaining,
    vectorQuotaMb: tierSpec.vectorQuotaMb,
    storageUsedMb,
    utilizationPct,
    ledgerPath: COMMERCIAL_LEDGER_REL,
    persistedAt: ledgerPersistedAt,
  };
}

export function assertQuotaAvailable(unitsRequested = 1): EnterpriseQuotaStatus {
  const status = getQuotaStatus();
  if (
    status.simulationsMax !== null &&
    status.simulationsUsed + unitsRequested > status.simulationsMax
  ) {
    throw new CommercialSuiteError(
      429,
      `Active ${status.activeTierName} simulation quota reached (${status.simulationsUsed}/${status.simulationsMax}). Stopping before exceeding limit so existing work is preserved.`
    );
  }
  return status;
}

export function consumeSimulationQuota(units = 1): EnterpriseQuotaStatus {
  assertQuotaAvailable(units);
  simulationsConsumed += units;
  persistCommercialLedger();
  return getQuotaStatus();
}

export function updateActiveQuotaTier(
  tier: EnterpriseTierId,
  session: AuthSession
): EnterpriseQuotaStatus {
  activeTier = tier;
  persistCommercialLedger();
  recordProvenance({
    kind: 'auth',
    actorId: session.userId,
    actorRole: session.role,
    action: 'enterprise:quota-tier-updated',
    rawInput: JSON.stringify({ tier, simulationsUsed: simulationsConsumed }),
    modelOrEngine: 'quota-guardrail',
    licenses: ['Enterprise Commercial Terms'],
    sourceUrls: [],
  });
  return getQuotaStatus();
}

export function createCheckoutOrder(
  input: {
    tier: EnterpriseTierId;
    numUsers: number;
    customization: boolean;
    billingCycle: 'monthly' | 'yearly';
    organization: string;
    billingEmail: string;
    partnerName?: string;
    partnerEmail?: string;
    activateTrialFirst: boolean;
  },
  session: AuthSession
): {
  order: EnterpriseCheckoutOrder;
  payout: PartnerPayoutRecord;
  quote: EnterpriseQuoteResult;
} {
  const quote = calculateEnterpriseQuote({
    tier: input.tier,
    numUsers: input.numUsers,
    customization: input.customization,
    billingCycle: input.billingCycle,
  });

  const contractTotalUsd =
    input.billingCycle === 'yearly' ? quote.annualContractUsd : quote.firstMonthTotalUsd;
  const dueTodayUsd = input.activateTrialFirst ? 0 : contractTotalUsd;
  const trialStatus: EnterpriseCheckoutOrder['trialStatus'] = input.activateTrialFirst
    ? 'active_90d_trial'
    : 'invoiced_immediate';

  const nowIso = new Date().toISOString();
  const orderId = `ord-${crypto.randomUUID().slice(0, 8)}`;
  const invoiceNumber = `INV-2026-${String(checkoutOrders.length + 1001)}`;
  const organization = input.organization.trim() || session.organization || 'Partner Organization';
  const billingEmail = input.billingEmail.trim().toLowerCase() || session.email;
  const partnerName = input.partnerName?.trim() || organization;
  const partnerEmail = input.partnerEmail?.trim().toLowerCase() || billingEmail;

  const receiptDigestSha256 = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        orderId,
        invoiceNumber,
        buyerUserId: session.userId,
        organization,
        tier: quote.tier,
        contractTotalUsd,
        dueTodayUsd,
        nowIso,
      })
    )
    .digest('hex');

  const order: EnterpriseCheckoutOrder = {
    orderId,
    invoiceNumber,
    buyerUserId: session.userId,
    buyerRole: session.role,
    organization,
    billingEmail,
    partnerName,
    tier: quote.tier,
    tierName: quote.tierName,
    numUsers: quote.numUsers,
    customization: quote.customization,
    billingCycle: quote.billingCycle,
    trialStatus,
    dueTodayUsd,
    contractTotalUsd,
    paymentMode: 'internal_sandbox_ledger',
    billingNotice:
      'Recorded in internal sandbox billing ledger (no external Stripe/bank card charge executed without STRIPE_SECRET_KEY).',
    receiptDigestSha256,
    createdAt: nowIso,
  };
  checkoutOrders.unshift(order);

  const platformShareUsd = Number((contractTotalUsd * 0.55).toFixed(2));
  const partnerShareUsd = Number((contractTotalUsd - platformShareUsd).toFixed(2));

  const payout: PartnerPayoutRecord = {
    payoutId: `pay-${crypto.randomUUID().slice(0, 8)}`,
    orderId,
    invoiceNumber,
    partnerName,
    partnerEmail,
    grossUsd: contractTotalUsd,
    platformShareUsd,
    partnerShareUsd,
    splitRatio: '55/45',
    status: 'pending_payout',
    settlementMode: 'internal_sandbox_ledger',
    createdAt: nowIso,
  };
  partnerPayouts.unshift(payout);

  recordProvenance({
    kind: 'auth',
    actorId: session.userId,
    actorRole: session.role,
    action: 'enterprise:checkout',
    rawInput: JSON.stringify({ orderId, invoiceNumber, contractTotalUsd, partnerName }),
    modelOrEngine: 'commercial-sandbox-ledger',
    licenses: ['Enterprise Commercial Terms'],
    sourceUrls: [],
    metadata: {
      orderId,
      invoiceNumber,
      tier: quote.tier,
      contractTotalUsd,
      partnerShareUsd,
    },
  });

  publishFluxEvent({
    topic: 'market.transaction',
    key: orderId,
    actorRole: session.role,
    summary: `Checkout ${invoiceNumber} (${quote.tierName}, $${contractTotalUsd}) · 45% partner split $${partnerShareUsd} accrued for ${partnerName}`,
    payload: {
      orderId,
      invoiceNumber,
      payoutId: payout.payoutId,
      grossUsd: contractTotalUsd,
      platformShareUsd,
      partnerShareUsd,
      trialStatus,
    },
  });

  activeTier = quote.tier;
  persistCommercialLedger();

  logger.info('enterprise', 'Enterprise checkout order & 55/45 payout recorded', {
    orderId,
    invoiceNumber,
    contractTotalUsd,
    payoutId: payout.payoutId,
  });

  return { order, payout, quote };
}

export function settlePartnerPayout(
  payoutId: string,
  session: AuthSession
): PartnerPayoutRecord {
  const payout = partnerPayouts.find((p) => p.payoutId === payoutId);
  if (!payout) {
    throw new CommercialSuiteError(404, `Partner payout '${payoutId}' not found.`);
  }
  if (payout.status === 'settled') {
    throw new CommercialSuiteError(
      409,
      `Partner payout '${payoutId}' is already settled (${payout.settlementReference}).`
    );
  }

  payout.status = 'settled';
  payout.settledBy = session.userId;
  payout.settledAt = new Date().toISOString();
  payout.settlementReference = `STL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  recordProvenance({
    kind: 'auth',
    actorId: session.userId,
    actorRole: session.role,
    action: 'enterprise:payout-settled',
    rawInput: JSON.stringify({
      payoutId: payout.payoutId,
      settlementReference: payout.settlementReference,
      partnerShareUsd: payout.partnerShareUsd,
    }),
    modelOrEngine: 'partner-payout-settlement-ledger',
    licenses: ['55/45 Partner Distribution'],
    sourceUrls: [],
    metadata: {
      payoutId: payout.payoutId,
      partnerShareUsd: payout.partnerShareUsd,
      settlementReference: payout.settlementReference,
    },
  });

  publishFluxEvent({
    topic: 'market.transaction',
    key: payout.payoutId,
    actorRole: session.role,
    summary: `Settled 45% partner payout $${payout.partnerShareUsd} to ${payout.partnerName} (${payout.settlementReference})`,
    payload: {
      payoutId: payout.payoutId,
      orderId: payout.orderId,
      settlementReference: payout.settlementReference,
      partnerShareUsd: payout.partnerShareUsd,
      settlementMode: payout.settlementMode,
    },
  });

  persistCommercialLedger();

  logger.info('enterprise', 'Partner payout marked settled in sandbox ledger', {
    payoutId: payout.payoutId,
    settlementReference: payout.settlementReference,
    actor: session.userId,
  });

  return { ...payout };
}

export function computePayoutTotals(): PartnerPayoutTotals {
  let grossUsd = 0;
  let platform55Usd = 0;
  let partner45Usd = 0;
  let pendingUsd = 0;
  let settledUsd = 0;
  let settledCount = 0;

  for (const p of partnerPayouts) {
    grossUsd += p.grossUsd;
    platform55Usd += p.platformShareUsd;
    partner45Usd += p.partnerShareUsd;
    if (p.status === 'settled') {
      settledUsd += p.partnerShareUsd;
      settledCount += 1;
    } else {
      pendingUsd += p.partnerShareUsd;
    }
  }

  return {
    grossUsd: Number(grossUsd.toFixed(2)),
    platform55Usd: Number(platform55Usd.toFixed(2)),
    partner45Usd: Number(partner45Usd.toFixed(2)),
    pendingUsd: Number(pendingUsd.toFixed(2)),
    settledUsd: Number(settledUsd.toFixed(2)),
    orderCount: checkoutOrders.length,
    settledCount,
  };
}

export function getEnterpriseOverview(): EnterpriseOverviewResponse {
  return {
    tiers: PRICING_TIERS,
    whiteLabel: getBrandConfig(),
    partnershipPlaybook: PARTNERSHIP_PLAYBOOK,
    checklist: launchChecklist.map((item) => ({ ...item })),
    analytics: computeLiveUsageAnalytics(),
    alerts: generateSmartPlatformAlerts(),
    orders: checkoutOrders.map((o) => ({ ...o })),
    payouts: partnerPayouts.map((p) => ({ ...p })),
    payoutTotals: computePayoutTotals(),
    quota: getQuotaStatus(),
  };
}
