import { useEffect, useState } from 'react';
import {
  BarChart3,
  Building2,
  Calculator,
  CheckCircle2,
  CheckSquare,
  CreditCard,
  Download,
  GraduationCap,
  Handshake,
  Paintbrush,
  ShieldCheck,
  Square,
  Wallet,
} from 'lucide-react';
import {
  calculateEnterpriseQuoteApi,
  fetchEnterpriseOverviewApi,
  gradeRubricSubmissionApi,
  settlePartnerPayoutApi,
  submitEnterpriseCheckoutApi,
  toggleChecklistItemApi,
  updateEnterpriseQuotaTierApi,
  updateWhiteLabelConfigApi,
} from '../../services/api';
import type {
  AuthSession,
  EnterpriseCheckoutOrder,
  EnterpriseOverviewResponse,
  EnterpriseQuoteResult,
  EnterpriseTierId,
  PartnerPayoutRecord,
  RubricGradeResult,
  UserRole,
  WhiteLabelConfig,
} from '../../types';
import { triggerFileDownload } from '../../utils/exportReport';

interface Props {
  language: 'en' | 'he';
  userRole: UserRole;
  session: AuthSession;
  onBrandUpdated: (config: WhiteLabelConfig) => void;
}

export default function EnterpriseSuiteView({
  language,
  userRole,
  session,
  onBrandUpdated,
}: Props) {
  const isHe = language === 'he';
  const [overview, setOverview] = useState<EnterpriseOverviewResponse | null>(null);
  const [quote, setQuote] = useState<EnterpriseQuoteResult | null>(null);

  // Quote controls
  const [tier, setTier] = useState<EnterpriseTierId>('growth');
  const [numUsers, setNumUsers] = useState(20);
  const [customization, setCustomization] = useState(true);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  // White-label controls
  const [wlEnabled, setWlEnabled] = useState(false);
  const [brandName, setBrandName] = useState('INTEL');
  const [brandNameHe, setBrandNameHe] = useState('אינטל');
  const [tagline, setTagline] = useState('Research Intelligence Command Center');
  const [taglineHe, setTaglineHe] = useState('מרכז פיקוד ומחקר מדעי');
  const [accentColor, setAccentColor] = useState<WhiteLabelConfig['accentColor']>('cyan');
  const [customDomain, setCustomDomain] = useState('app.yourcorp.io');
  const [hipaaReady, setHipaaReady] = useState(true);
  const [iso27001Controls, setIso27001Controls] = useState(true);
  const [wlStatus, setWlStatus] = useState<string | null>(null);
  const [wlError, setWlError] = useState<string | null>(null);

  // Embedded Teaching Rubric Toolkit
  const [rubricTitle, setRubricTitle] = useState(
    'Enzyme Kinetics Benchmark Lab Report #4'
  );
  const [rubricText, setRubricText] = useState(
    'Hypothesis: Lowering temperature reduces barrier variance around the primary outcome. Control group uses negative control buffer without substrate under randomized blinding. Statistical analysis reports confidence interval and p-value < 0.01. IRB ethics approval and CC-BY-4.0 license verified. Limitations and reproducibility SHA-256 checksums documented.'
  );
  const [rubricResult, setRubricResult] = useState<RubricGradeResult | null>(null);

  // Checkout & Partner Payout controls
  const [organization, setOrganization] = useState(
    session.organization || 'BioSystems Partner Lab'
  );
  const [billingEmail, setBillingEmail] = useState(
    session.role === 'guest' ? 'billing@partner-lab.org' : session.email
  );
  const [partnerName, setPartnerName] = useState(
    session.organization || 'Partner Research Consortium'
  );
  const [activateTrialFirst, setActivateTrialFirst] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [latestOrder, setLatestOrder] = useState<{
    order: EnterpriseCheckoutOrder;
    payout: PartnerPayoutRecord;
  } | null>(null);
  const [settlingPayoutId, setSettlingPayoutId] = useState<string | null>(null);
  const [payoutNotice, setPayoutNotice] = useState<string | null>(null);

  useEffect(() => {
    if (session.role !== 'guest') {
      if (session.organization) {
        setOrganization(session.organization);
        setPartnerName(session.organization);
      }
      if (session.email) {
        setBillingEmail(session.email);
      }
    }
  }, [session.email, session.organization, session.role]);

  const canConfigureWhiteLabel =
    userRole === 'principal_investigator' || userRole === 'auditor';
  const isAuthenticated = userRole !== 'guest';

  async function loadAll() {
    try {
      const data = await fetchEnterpriseOverviewApi();
      setOverview(data);
      setWlEnabled(data.whiteLabel.enabled);
      setBrandName(data.whiteLabel.brandName);
      setBrandNameHe(data.whiteLabel.brandNameHe);
      setTagline(data.whiteLabel.tagline);
      setTaglineHe(data.whiteLabel.taglineHe);
      setAccentColor(data.whiteLabel.accentColor);
      setCustomDomain(data.whiteLabel.customDomain);
      setHipaaReady(data.whiteLabel.complianceSuite.hipaaReady);
      setIso27001Controls(data.whiteLabel.complianceSuite.iso27001Controls);
    } catch {
      // Ignore initial error
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    let active = true;
    calculateEnterpriseQuoteApi({ tier, numUsers, customization, billingCycle })
      .then((res) => {
        if (active) setQuote(res.quote);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [tier, numUsers, customization, billingCycle]);

  async function handleSaveWhiteLabel() {
    setWlStatus(null);
    setWlError(null);
    try {
      const res = await updateWhiteLabelConfigApi({
        enabled: wlEnabled,
        brandName,
        brandNameHe,
        tagline,
        taglineHe,
        accentColor,
        customDomain,
        hipaaReady,
        iso27001Controls,
      });
      onBrandUpdated(res.whiteLabel);
      setWlStatus(
        `Applied ${res.whiteLabel.enabled ? 'active white-label override' : 'default INTEL branding'} for ${res.whiteLabel.customDomain}.`
      );
      await loadAll();
    } catch (err) {
      setWlError(
        err instanceof Error
          ? err.message
          : 'Principal Investigator or Auditor login required.'
      );
    }
  }

  async function handleToggleChecklist(itemId: string) {
    try {
      const res = await toggleChecklistItemApi(itemId);
      setOverview((prev) => (prev ? { ...prev, checklist: res.checklist } : prev));
    } catch (err) {
      setWlError(
        err instanceof Error
          ? err.message
          : 'Principal Investigator or Auditor login required.'
      );
    }
  }

  async function handleRunRubric() {
    const res = await gradeRubricSubmissionApi({
      title: rubricTitle,
      submissionText: rubricText,
    });
    setRubricResult(res.result);
  }

  async function handleCompleteCheckout(e: React.FormEvent) {
    e.preventDefault();
    setCheckoutError(null);
    setPayoutNotice(null);
    setCheckoutBusy(true);
    try {
      const res = await submitEnterpriseCheckoutApi({
        tier,
        numUsers,
        customization,
        billingCycle,
        organization,
        billingEmail,
        partnerName,
        partnerEmail: billingEmail,
        activateTrialFirst,
      });
      setLatestOrder({ order: res.order, payout: res.payout });
      await loadAll();
    } catch (err) {
      setCheckoutError(
        err instanceof Error
          ? err.message
          : 'Sign in or create an account before completing checkout.'
      );
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function handleSettlePayout(payoutId: string) {
    setCheckoutError(null);
    setPayoutNotice(null);
    setSettlingPayoutId(payoutId);
    try {
      const res = await settlePartnerPayoutApi(payoutId);
      setPayoutNotice(
        `Settled payout ${res.payout.payoutId} ($${res.payout.partnerShareUsd.toLocaleString()} to ${res.payout.partnerName}) · Ref: ${res.payout.settlementReference}`
      );
      await loadAll();
    } catch (err) {
      setCheckoutError(
        err instanceof Error
          ? err.message
          : 'Principal Investigator or Compliance Auditor role required to settle payouts.'
      );
    } finally {
      setSettlingPayoutId(null);
    }
  }

  async function handleSwitchQuotaTier(nextTier: EnterpriseTierId) {
    setCheckoutError(null);
    setPayoutNotice(null);
    try {
      const res = await updateEnterpriseQuotaTierApi(nextTier);
      setPayoutNotice(
        isHe
          ? `תקרת המכסה עודכנה לשכבת ${res.quota.activeTierName} (${res.quota.simulationsMax ?? 'ללא הגבלה'} סימולציות) ונשמרה בדיסק.`
          : `Active quota ceiling set to ${res.quota.activeTierName} (${res.quota.simulationsMax ?? 'Unlimited'} simulations) and persisted to ${res.quota.ledgerPath}.`
      );
      await loadAll();
    } catch (err) {
      setCheckoutError(
        err instanceof Error
          ? err.message
          : 'Authentication required to update active quota tier.'
      );
    }
  }

  function downloadInvoiceMarkdown(order: EnterpriseCheckoutOrder, payout?: PartnerPayoutRecord) {
    const md = [
      `# INTEL Enterprise Commercial Invoice & Receipt`,
      ``,
      `- **Invoice Number**: ${order.invoiceNumber}`,
      `- **Order ID**: ${order.orderId}`,
      `- **Issued At**: ${order.createdAt}`,
      `- **Organization**: ${order.organization}`,
      `- **Billing Email**: ${order.billingEmail}`,
      `- **Domain Partner (45%)**: ${order.partnerName}`,
      `- **Selected Tier**: ${order.tierName} (${order.numUsers} seats, ${order.billingCycle})`,
      `- **White-Label Setup Included**: ${order.customization ? 'Yes ($1,499)' : 'No'}`,
      `- **Trial / Billing Mode**: ${order.trialStatus}`,
      `- **Due Today (Sandbox Ledger)**: $${order.dueTodayUsd.toLocaleString()}`,
      `- **Contract Value**: $${order.contractTotalUsd.toLocaleString()}`,
      payout
        ? `- **55/45 Revenue Split**: Platform $${payout.platformShareUsd.toLocaleString()} (55%) / Partner $${payout.partnerShareUsd.toLocaleString()} (45%) · Status: ${payout.status}`
        : '',
      `- **Receipt SHA-256 Digest**: \`${order.receiptDigestSha256}\``,
      ``,
      `> ${order.billingNotice}`,
    ]
      .filter(Boolean)
      .join('\n');
    triggerFileDownload(`${order.invoiceNumber}.md`, md, 'text/markdown');
  }

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-cyan-400" />
            <span>
              {isHe
                ? 'חבילת ארגון, תמחור, White-Label ומסחור'
                : 'Enterprise Commercialization, White-Label & Analytics Suite'}
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isHe
              ? 'מודל 3 שכבות (90 ימי ניסיון, 10% הנחה שנתית), מיתוג מותאם בזמן אמת, אנליטיקת שימוש חיה, וערכת בדיקת רובריקה.'
              : '3-tier SaaS packaging (90-day trial, 10% yearly discount), live tenant white-label override, 55/45 partner playbook, real-time analytics, and teaching rubric scorer.'}
          </p>
        </div>

        {overview && (
          <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-slate-300">
            <span>Corpus: {overview.analytics.corpusChunks} chunks</span>
            <span>·</span>
            <span>Uploads: {overview.analytics.totalUploads}</span>
            <span>·</span>
            <span>Sims: {overview.analytics.simulationsCompleted}</span>
            <span>·</span>
            <span className="text-emerald-300">
              Est. Time Saved: {overview.analytics.estimatedHoursSaved} hrs
            </span>
          </div>
        )}
      </div>

      {/* Persistent Ledger & Simulation Quota Guardrail */}
      {overview?.quota && (
        <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-mono tabular-nums">
              <span className="text-slate-200 font-semibold">
                {isHe ? 'מכסת מערכת ושמירה בדיסק' : 'Active Quota Guardrail & Disk Ledger'}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-cyan-300">
                {overview.quota.activeTierName} Tier
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-300">
                Simulations: {overview.quota.simulationsUsed} /{' '}
                {overview.quota.simulationsMax ?? '∞'}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">
                Storage: {overview.quota.storageUsedMb} / {overview.quota.vectorQuotaMb} MB
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-emerald-400">
                ● Saved ({overview.quota.ledgerPath})
              </span>
            </div>
            <div className="w-full max-w-md h-1.5 bg-[#07090E] border border-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  overview.quota.utilizationPct >= 90
                    ? 'bg-rose-400'
                    : overview.quota.utilizationPct >= 75
                      ? 'bg-amber-400'
                      : 'bg-cyan-400'
                }`}
                style={{ width: `${overview.quota.utilizationPct}%` }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(['starter', 'growth', 'enterprise'] as const).map((tierOption) => {
              const isCurrent = overview.quota.activeTier === tierOption;
              return (
                <button
                  key={tierOption}
                  type="button"
                  disabled={!isAuthenticated || isCurrent}
                  onClick={() => void handleSwitchQuotaTier(tierOption)}
                  className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-mono transition-colors ${
                    isCurrent
                      ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                      : 'border-slate-700 bg-[#07090E] text-slate-300 hover:border-slate-500 disabled:opacity-45'
                  }`}
                >
                  {tierOption === 'starter'
                    ? 'Starter (10 max)'
                    : tierOption === 'growth'
                      ? 'Growth (100 max)'
                      : 'Enterprise (∞)'}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 1. 3-Tier Pricing + Interactive Quick Quote */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-7 grid grid-cols-1 md:grid-cols-3 gap-4">
          {(overview?.tiers ?? []).map((tSpec) => {
            const selected = tier === tSpec.id;
            return (
              <button
                key={tSpec.id}
                type="button"
                onClick={() => setTier(tSpec.id)}
                className={`text-left rounded-xl border p-4 flex flex-col justify-between transition-colors ${
                  selected
                    ? 'bg-cyan-500/10 border-cyan-400'
                    : 'bg-[#0D1320] border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-wider font-mono text-cyan-300">
                      {tSpec.name}
                    </div>
                    <div className="text-2xl font-semibold text-slate-100 mt-1">
                      ${tSpec.monthlyBaseUsd.toLocaleString()}
                      <span className="text-xs font-normal text-slate-400"> / mo</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      {tSpec.targetAudience}
                    </div>
                  </div>

                  <ul className="space-y-1.5 text-xs text-slate-300 pt-2 border-t border-slate-800/80">
                    {tSpec.coreFeatures.map((feat) => (
                      <li key={feat}>• {feat}</li>
                    ))}
                  </ul>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] font-mono text-slate-400">
                  {tSpec.trialDays}-day trial · {tSpec.yearlyDiscountPct}% off yearly
                </div>
              </button>
            );
          })}
        </div>

        {/* Interactive Quote Tool */}
        <section className="xl:col-span-5 bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Calculator className="w-4 h-4 text-cyan-400" />
            <span>Interactive Quick Quote Calculator</span>
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-300 space-y-1">
              <span>Tier</span>
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value as EnterpriseTierId)}
                className="w-full px-3 py-2 bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
              >
                <option value="starter">Starter ($49/mo)</option>
                <option value="growth">Growth ($499/mo)</option>
                <option value="enterprise">Enterprise ($4,999/mo)</option>
              </select>
            </label>

            <label className="text-xs text-slate-300 space-y-1">
              <span>Active Researcher Seats</span>
              <input
                type="number"
                min={1}
                max={10000}
                value={numUsers}
                onChange={(e) => setNumUsers(Math.max(1, Number(e.target.value) || 1))}
                className="w-full px-3 py-2 bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={customization}
                onChange={(e) => setCustomization(e.target.checked)}
              />
              <span>White-Label Package (+$1,499 setup)</span>
            </label>

            <div className="flex items-center rounded-lg border border-slate-800 overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setBillingCycle('monthly')}
                className={`px-3 py-1.5 ${
                  billingCycle === 'monthly'
                    ? 'bg-cyan-500 text-slate-950 font-semibold'
                    : 'bg-[#080C15] text-slate-300'
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle('yearly')}
                className={`px-3 py-1.5 ${
                  billingCycle === 'yearly'
                    ? 'bg-cyan-500 text-slate-950 font-semibold'
                    : 'bg-[#080C15] text-slate-300'
                }`}
              >
                Yearly (-10%)
              </button>
            </div>
          </div>

          {quote && (
            <div className="p-4 rounded-xl bg-[#080C15] border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>Platform Base ({quote.tierName})</span>
                <span className="font-mono">${quote.baseMonthlyUsd.toLocaleString()}/mo</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>
                  {quote.numUsers} Seats × ${quote.perUserMonthlyUsd}/user-mo
                </span>
                <span className="font-mono">
                  ${quote.seatCostMonthlyUsd.toLocaleString()}/mo
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>White-Label Customization Setup</span>
                <span className="font-mono">
                  ${quote.whiteLabelSetupFeeUsd.toLocaleString()} one-time
                </span>
              </div>
              <div className="border-t border-slate-800 pt-2 flex justify-between text-slate-100 font-semibold">
                <span>Effective Monthly Recurring</span>
                <span className="font-mono text-cyan-300">
                  ${quote.effectiveMonthlyAfterDiscountUsd.toLocaleString()}/mo
                </span>
              </div>
              <div className="flex justify-between text-emerald-300 font-semibold">
                <span>First Month Total (incl. Setup)</span>
                <span className="font-mono">
                  ${quote.firstMonthTotalUsd.toLocaleString()}
                </span>
              </div>
              {quote.annualSavingsUsd > 0 && (
                <div className="text-[11px] font-mono text-amber-300">
                  Yearly billing saves ${quote.annualSavingsUsd.toLocaleString()} / yr ·{' '}
                  Total 12-mo contract ${quote.annualContractUsd.toLocaleString()}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* 1b. Checkout, Invoice & 55/45 Partner Payout Settlement Ledger */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <section className="xl:col-span-5 bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-400" />
              <span>Checkout & Subscription Activation</span>
            </h3>
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-slate-300">
              Sandbox Ledger
            </span>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Completes end-to-end order generation, SHA-256 invoice receipting, and 55/45 partner revenue accrual in the internal sandbox ledger (no live Stripe charge without external billing keys).
          </p>

          <form onSubmit={handleCompleteCheckout} className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 text-slate-300">
                <span>Organization / Lab</span>
                <input
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  className="w-full px-3 py-2 bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
                  required
                />
              </label>
              <label className="space-y-1 text-slate-300">
                <span>Billing Email</span>
                <input
                  type="email"
                  value={billingEmail}
                  onChange={(e) => setBillingEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
                  required
                />
              </label>
            </div>

            <label className="block space-y-1 text-slate-300">
              <span>Domain Partner Recipient (45% Split)</span>
              <input
                type="text"
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
                className="w-full px-3 py-2 bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
              />
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={activateTrialFirst}
                onChange={(e) => setActivateTrialFirst(e.target.checked)}
              />
              <span>Activate 90-Day Pilot Trial First ($0 due today; commitment accrued)</span>
            </label>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={!isAuthenticated || checkoutBusy}
                className="px-4 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 rounded-lg"
              >
                {checkoutBusy
                  ? 'Processing Order...'
                  : quote
                    ? `Complete Checkout ($${activateTrialFirst ? '0 due / $' + (billingCycle === 'yearly' ? quote.annualContractUsd : quote.firstMonthTotalUsd).toLocaleString() + ' contract' : (billingCycle === 'yearly' ? quote.annualContractUsd : quote.firstMonthTotalUsd).toLocaleString()})`
                    : 'Complete Checkout'}
              </button>
              {!isAuthenticated && (
                <span className="text-[11px] text-amber-300">
                  Sign in or Create Account (top bar) to run checkout
                </span>
              )}
            </div>
          </form>

          {checkoutError && (
            <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2.5">
              {checkoutError}
            </p>
          )}

          {latestOrder && (
            <div className="p-3.5 rounded-lg bg-emerald-950/20 border border-emerald-500/30 space-y-2 text-xs">
              <div className="flex items-center justify-between text-emerald-300 font-semibold">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{latestOrder.order.invoiceNumber} Confirmed</span>
                </span>
                <span className="font-mono">
                  ${latestOrder.order.contractTotalUsd.toLocaleString()}
                </span>
              </div>
              <div className="text-[11px] text-slate-300 font-mono">
                Order: {latestOrder.order.orderId} · Due today: $
                {latestOrder.order.dueTodayUsd.toLocaleString()} · Payout:{' '}
                {latestOrder.payout.payoutId} ($
                {latestOrder.payout.partnerShareUsd.toLocaleString()} / 45%)
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    triggerFileDownload(
                      `${latestOrder.order.invoiceNumber}.json`,
                      JSON.stringify(latestOrder, null, 2),
                      'application/json'
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10"
                >
                  <Download className="w-3 h-3" />
                  <span>Receipt JSON</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadInvoiceMarkdown(latestOrder.order, latestOrder.payout)
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/10"
                >
                  <Download className="w-3 h-3" />
                  <span>Invoice Markdown</span>
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Partner Payout Ledger */}
        <section className="xl:col-span-7 bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Wallet className="w-4 h-4 text-cyan-400" />
              <span>55/45 Partner Revenue-Split & Payout Settlement Ledger</span>
            </h3>
            {!canConfigureWhiteLabel && (
              <span className="text-[11px] text-amber-300">
                Payout settlement requires Principal Investigator or Auditor role
              </span>
            )}
          </div>

          {overview && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-[#080C15] border border-slate-800">
                  <div className="text-[11px] text-slate-400">Gross Volume</div>
                  <div className="text-base font-semibold font-mono text-slate-100">
                    ${overview.payoutTotals.grossUsd.toLocaleString()}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#080C15] border border-slate-800">
                  <div className="text-[11px] text-slate-400">Platform (55%)</div>
                  <div className="text-base font-semibold font-mono text-cyan-300">
                    ${overview.payoutTotals.platform55Usd.toLocaleString()}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#080C15] border border-slate-800">
                  <div className="text-[11px] text-slate-400">Pending Partner (45%)</div>
                  <div className="text-base font-semibold font-mono text-amber-300">
                    ${overview.payoutTotals.pendingUsd.toLocaleString()}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#080C15] border border-slate-800">
                  <div className="text-[11px] text-slate-400">Settled Partner (45%)</div>
                  <div className="text-base font-semibold font-mono text-emerald-300">
                    ${overview.payoutTotals.settledUsd.toLocaleString()}
                  </div>
                </div>
              </div>

              {payoutNotice && (
                <p className="text-xs text-emerald-300 bg-emerald-950/20 border border-emerald-500/30 rounded-lg p-2.5">
                  {payoutNotice}
                </p>
              )}

              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {overview.payouts.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4">
                    No checkout orders yet. Complete Checkout on the left to accrue an invoice and 55/45 partner payout entry.
                  </p>
                ) : (
                  overview.payouts.map((p) => {
                    const matchingOrder = overview.orders.find(
                      (o) => o.orderId === p.orderId
                    );
                    return (
                      <div
                        key={p.payoutId}
                        className="p-3 rounded-lg bg-[#080C15] border border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="font-semibold text-slate-100 flex flex-wrap items-center gap-2">
                            <span>{p.invoiceNumber}</span>
                            <span className="text-slate-400">·</span>
                            <span className="text-cyan-300">{p.partnerName}</span>
                            <span
                              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                p.status === 'settled'
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : 'bg-amber-500/15 text-amber-300'
                              }`}
                            >
                              {p.status}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-400">
                            Gross ${p.grossUsd.toLocaleString()} · Platform 55%: $
                            {p.platformShareUsd.toLocaleString()} · Partner 45%: $
                            {p.partnerShareUsd.toLocaleString()}
                            {p.settlementReference ? ` · Ref: ${p.settlementReference}` : ''}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {matchingOrder && (
                            <button
                              type="button"
                              onClick={() => downloadInvoiceMarkdown(matchingOrder, p)}
                              className="px-2.5 py-1.5 text-[11px] border border-slate-700 text-slate-300 rounded-md hover:bg-slate-800"
                            >
                              Invoice
                            </button>
                          )}
                          {p.status === 'pending_payout' && (
                            <button
                              type="button"
                              disabled={!canConfigureWhiteLabel || settlingPayoutId === p.payoutId}
                              onClick={() => handleSettlePayout(p.payoutId)}
                              className="px-3 py-1.5 text-[11px] font-semibold bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 rounded-md"
                            >
                              {settlingPayoutId === p.payoutId
                                ? 'Settling...'
                                : 'Settle 45% Payout'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* 2. Live White-Label Brand Override + Usage Analytics & Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-6 bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Paintbrush className="w-4 h-4 text-cyan-400" />
              <span>White-Label Packaging & Live Brand Override</span>
            </h3>
            <label className="flex items-center gap-1.5 text-xs text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={wlEnabled}
                onChange={(e) => setWlEnabled(e.target.checked)}
              />
              <span>Override Active</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <label className="space-y-1 text-slate-300">
              <span>Brand Name (EN)</span>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                className="w-full px-3 py-2 bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
              />
            </label>
            <label className="space-y-1 text-slate-300">
              <span>Brand Name (HE)</span>
              <input
                type="text"
                value={brandNameHe}
                onChange={(e) => setBrandNameHe(e.target.value)}
                className="w-full px-3 py-2 bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
              />
            </label>
            <label className="space-y-1 text-slate-300">
              <span>Custom Domain Preview</span>
              <input
                type="text"
                value={customDomain}
                onChange={(e) => setCustomDomain(e.target.value)}
                className="w-full px-3 py-2 bg-[#080C15] border border-slate-800 rounded-lg text-slate-100 font-mono"
              />
            </label>
            <label className="space-y-1 text-slate-300">
              <span>Primary Accent Theme</span>
              <select
                value={accentColor}
                onChange={(e) =>
                  setAccentColor(e.target.value as WhiteLabelConfig['accentColor'])
                }
                className="w-full px-3 py-2 bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
              >
                <option value="cyan">Cyan Photonics</option>
                <option value="emerald">Emerald Bio</option>
                <option value="amber">Amber Quantum</option>
                <option value="violet">Violet Synthesis</option>
              </select>
            </label>
            <label className="space-y-1 text-slate-300 sm:col-span-2">
              <span>Tagline (EN)</span>
              <input
                type="text"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                className="w-full px-3 py-2 bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={hipaaReady}
                onChange={(e) => setHipaaReady(e.target.checked)}
              />
              <span>HIPAA Audit Controls</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={iso27001Controls}
                onChange={(e) => setIso27001Controls(e.target.checked)}
              />
              <span>ISO 27001 Provenance Retention</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSaveWhiteLabel}
              disabled={!canConfigureWhiteLabel}
              className="px-4 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 rounded-lg"
            >
              Apply Live White-Label Override
            </button>
            {!canConfigureWhiteLabel && (
              <span className="text-[11px] text-amber-300">
                Requires Principal Investigator or Compliance Auditor sign-in
              </span>
            )}
          </div>
          {wlStatus && <p className="text-xs text-emerald-300">{wlStatus}</p>}
          {wlError && <p className="text-xs text-rose-300">{wlError}</p>}
        </section>

        {/* Usage Analytics & Smart Alert Engine */}
        <section className="lg:col-span-6 bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-cyan-400" />
            <span>Live Telemetry Analytics & Smart Governance Alerts</span>
          </h3>

          {overview && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-[#080C15] border border-slate-800">
                  <div className="text-[11px] text-slate-400">Provenance Records</div>
                  <div className="text-lg font-semibold text-slate-100">
                    {overview.analytics.provenanceEvents}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#080C15] border border-slate-800">
                  <div className="text-[11px] text-slate-400">Flux Events</div>
                  <div className="text-lg font-semibold text-cyan-300">
                    {overview.analytics.fluxEventsTotal}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#080C15] border border-slate-800">
                  <div className="text-[11px] text-slate-400">Human Reviews</div>
                  <div className="text-lg font-semibold text-emerald-300">
                    {overview.analytics.peerReviewsSubmitted}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300">
                  Smart Literature & Compliance Alerts
                </div>
                {overview.alerts.length === 0 ? (
                  <p className="text-xs text-slate-500">All governance streams nominal.</p>
                ) : (
                  overview.alerts.map((al) => (
                    <div
                      key={al.id}
                      className={`p-3 rounded-lg border text-xs ${
                        al.level === 'warn'
                          ? 'bg-amber-950/20 border-amber-500/30 text-amber-200'
                          : 'bg-[#080C15] border-slate-800 text-slate-300'
                      }`}
                    >
                      <div className="font-semibold">{al.title}</div>
                      <div className="text-[11px] opacity-80 mt-0.5">{al.detail}</div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* 3. Partnership Playbook, Launch Checklist & Embedded Teaching Toolkit */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Partnership Playbook */}
        <section className="lg:col-span-5 bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Handshake className="w-4 h-4 text-cyan-400" />
            <span>Partnership Playbook (55/45 Revenue Split)</span>
          </h3>
          <div className="space-y-2.5">
            {(overview?.partnershipPlaybook ?? []).map((stage) => (
              <div
                key={stage.step}
                className="p-3 rounded-lg bg-[#080C15] border border-slate-800 text-xs"
              >
                <div className="flex items-center justify-between font-semibold text-slate-100">
                  <span>
                    {stage.step}. {stage.phase}
                  </span>
                  <span className="font-mono text-[11px] text-cyan-300">
                    {stage.timeline}
                  </span>
                </div>
                <p className="text-slate-400 mt-1">{stage.focus}</p>
                <div className="text-[11px] font-mono text-emerald-300 mt-1">
                  {stage.deliverable} · {stage.commercialModel}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Launch Checklist + Embedded Teaching Rubric Grader */}
        <section className="lg:col-span-7 space-y-5">
          <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              <span>Commercialization Launch Readiness Checklist</span>
            </h3>
            <div className="space-y-2">
              {(overview?.checklist ?? []).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleToggleChecklist(item.id)}
                  className="w-full text-left p-2.5 rounded-lg bg-[#080C15] border border-slate-800 hover:border-slate-700 flex items-start gap-2.5 text-xs"
                >
                  {item.done ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="text-[11px] font-mono text-cyan-300">
                      {item.category}
                    </div>
                    <div
                      className={
                        item.done ? 'text-slate-400 line-through' : 'text-slate-200'
                      }
                    >
                      {item.task}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#0D1320] border border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-cyan-400" />
              <span>Embedded Teaching Toolkit · Auto-Grading Rubric</span>
            </h3>
            <input
              type="text"
              value={rubricTitle}
              onChange={(e) => setRubricTitle(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
              placeholder="Submission title..."
            />
            <textarea
              rows={3}
              value={rubricText}
              onChange={(e) => setRubricText(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#080C15] border border-slate-800 rounded-lg text-slate-100"
              placeholder="Paste student lab protocol or methodology abstract..."
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleRunRubric}
                className="px-4 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg"
              >
                Grade with Scientific Rubric
              </button>
              {rubricResult && (
                <button
                  type="button"
                  onClick={() =>
                    triggerFileDownload(
                      `rubric-${Date.now()}.json`,
                      JSON.stringify(rubricResult, null, 2),
                      'application/json'
                    )
                  }
                  className="px-3 py-2 text-xs font-medium border border-slate-700 text-slate-200 rounded-lg hover:bg-slate-800"
                >
                  Export Rubric JSON
                </button>
              )}
            </div>

            {rubricResult && (
              <div className="p-3.5 rounded-lg bg-[#080C15] border border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between font-semibold">
                  <span className="text-slate-100">{rubricResult.title}</span>
                  <span className="text-cyan-300 font-mono">
                    {rubricResult.totalScore} / {rubricResult.maxScore} ·{' '}
                    {rubricResult.gradeBand}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {rubricResult.criteria.map((c) => (
                    <div
                      key={c.criterion}
                      className="flex items-center justify-between gap-2 text-[11px] text-slate-300"
                    >
                      <span className="truncate">{c.criterion}</span>
                      <span className="font-mono shrink-0 text-slate-200">
                        {c.earnedPoints}/{c.maxPoints} ({c.status})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
