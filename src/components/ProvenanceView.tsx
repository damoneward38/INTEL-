import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  fetchFeedbackApi,
  fetchLicensesApi,
  fetchProvenanceApi,
  fetchServerLogsApi,
  verifyLicenseApi,
} from '../services/api';
import type {
  FeedbackRecord,
  LicenseRecord,
  LogEntry,
  ProvenanceRecord,
  UserRole,
} from '../types';
import { triggerFileDownload } from '../utils/exportReport';

interface Props {
  userRole: UserRole;
}

export default function ProvenanceView({ userRole }: Props) {
  const { t } = useTranslation();
  const [records, setRecords] = useState<ProvenanceRecord[]>([]);
  const [licenses, setLicenses] = useState<LicenseRecord[]>([]);
  const [feedbacks, setFeedbacks] = useState<FeedbackRecord[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canVerifyLicense =
    userRole === 'auditor' || userRole === 'principal_investigator';

  async function refresh() {
    setLoading(true);
    setLogsError(null);
    try {
      const [prov, lic, fb] = await Promise.all([
        fetchProvenanceApi(),
        fetchLicensesApi(),
        fetchFeedbackApi(),
      ]);
      setRecords(prov.records);
      setLicenses(lic.licenses);
      setFeedbacks(fb.feedback);
    } catch {
      // Ignore
    }

    try {
      const logRes = await fetchServerLogsApi();
      setLogs(logRes.logs);
    } catch (err) {
      setLogs([]);
      setLogsError(err instanceof Error ? err.message : t('provenance.logsRestricted'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [userRole]);

  async function toggleTrainingEligibility(lic: LicenseRecord) {
    if (!canVerifyLicense) return;
    await verifyLicenseApi(lic.documentId, {
      verified: true,
      trainingAllowed: !lic.trainingAllowed,
    });
    await refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">
            {t('provenance.title')}
          </h2>
          <p className="text-xs text-slate-400 mt-1">{t('provenance.subtitle')}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-slate-900 border border-slate-700 rounded-lg hover:bg-slate-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() =>
              triggerFileDownload(
                `intel-audit-${Date.now()}.json`,
                JSON.stringify({ records, licenses, feedbacks, logs }, null, 2),
                'application/json'
              )
            }
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t('provenance.exportAudit')}</span>
          </button>
        </div>
      </div>

      {/* License Governance Registry */}
      <div className="rounded-xl border border-slate-800 bg-[#0D121D] overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">
            {t('provenance.licensesTitle')}
          </h3>
          <span className="text-xs font-mono-tabular text-slate-400">
            {licenses.length} documents
          </span>
        </div>
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-800 text-slate-400">
            <tr>
              <th className="py-2.5 px-4 font-medium">Doc ID</th>
              <th className="py-2.5 px-4 font-medium">Source</th>
              <th className="py-2.5 px-4 font-medium">License</th>
              <th className="py-2.5 px-4 font-medium">Verified</th>
              <th className="py-2.5 px-4 font-medium">Commercial</th>
              <th className="py-2.5 px-4 font-medium">Training</th>
              <th className="py-2.5 px-4 font-medium">Version</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 font-mono-tabular">
            {licenses.map((lic) => (
              <tr key={lic.documentId} className="hover:bg-slate-900/50">
                <td className="py-2.5 px-4 text-cyan-400">{lic.documentId}</td>
                <td className="py-2.5 px-4 text-slate-300">{lic.source}</td>
                <td className="py-2.5 px-4 text-slate-200 max-w-[200px] truncate">
                  {lic.license}
                </td>
                <td
                  className={`py-2.5 px-4 ${
                    lic.verified ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {lic.verified ? 'Verified' : 'Unverified'}
                </td>
                <td className="py-2.5 px-4 text-slate-300">
                  {lic.commercialUseAllowed ? 'Allowed' : 'Restricted'}
                </td>
                <td className="py-2.5 px-4">
                  {canVerifyLicense ? (
                    <button
                      type="button"
                      onClick={() => toggleTrainingEligibility(lic)}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] ${
                        lic.trainingAllowed
                          ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
                          : 'border-slate-700 text-slate-400 bg-slate-900'
                      }`}
                    >
                      <ShieldCheck className="w-3 h-3" />
                      {lic.trainingAllowed ? 'Eligible' : 'Blocked'}
                    </button>
                  ) : (
                    <span
                      className={
                        lic.trainingAllowed ? 'text-emerald-400' : 'text-slate-400'
                      }
                    >
                      {lic.trainingAllowed ? 'Eligible' : 'Blocked'}
                    </span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-slate-400">v{lic.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Human Review Queue */}
      <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-5">
        <h3 className="text-sm font-semibold text-slate-100 mb-3">
          {t('provenance.reviewsTitle')}
        </h3>
        {feedbacks.length === 0 ? (
          <p className="text-xs text-slate-400">
            No peer-review entries submitted yet. Use the review form under any research answer.
          </p>
        ) : (
          <div className="divide-y divide-slate-800 text-xs">
            {feedbacks.map((fb) => (
              <div key={fb.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2 font-mono-tabular text-slate-400 mb-1">
                  <span className="text-cyan-400">{fb.id}</span>
                  <span>·</span>
                  <span>{fb.provenanceId}</span>
                  <span>·</span>
                  <span className="text-emerald-400">Rating {fb.rating}/5</span>
                  <span>·</span>
                  <span>{fb.reviewDecision}</span>
                  <span>·</span>
                  <span className="text-amber-300">Auto-Training: Blocked</span>
                </div>
                <div className="text-slate-200 font-medium">{fb.question}</div>
                {fb.comments && (
                  <p className="text-slate-400 mt-1">{fb.comments}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Provenance Ledger Table */}
      <div className="rounded-xl border border-slate-800 bg-[#0D121D] overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-800 text-slate-400">
            <tr>
              <th className="py-3 px-4 font-medium">ID</th>
              <th className="py-3 px-4 font-medium">Action</th>
              <th className="py-3 px-4 font-medium">Role</th>
              <th className="py-3 px-4 font-medium">Engine / Model</th>
              <th className="py-3 px-4 font-medium">Licenses</th>
              <th className="py-3 px-4 font-medium">SHA-256 Digest</th>
              <th className="py-3 px-4 font-medium">Timestamp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 font-mono-tabular">
            {records.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 px-4 text-center text-slate-400 font-sans">
                  No provenance records recorded in this session yet.
                </td>
              </tr>
            ) : (
              records.map((rec) => (
                <tr key={rec.id} className="hover:bg-slate-900/50">
                  <td className="py-2.5 px-4 text-cyan-400">{rec.id}</td>
                  <td className="py-2.5 px-4 text-slate-200">{rec.action}</td>
                  <td className="py-2.5 px-4 text-slate-300">{rec.actorRole}</td>
                  <td className="py-2.5 px-4 text-slate-300">{rec.modelOrEngine}</td>
                  <td className="py-2.5 px-4 text-slate-300 max-w-[220px] truncate">
                    {rec.licenses.join(', ') || '—'}
                  </td>
                  <td className="py-2.5 px-4 text-slate-400">
                    {rec.digestSha256.slice(0, 14)}…
                  </td>
                  <td className="py-2.5 px-4 text-slate-400">
                    {new Date(rec.timestamp).toLocaleTimeString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Server Logs Section (RBAC Enforced) */}
      <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-5">
        <h3 className="text-sm font-semibold text-slate-100 mb-3">
          {t('provenance.logsTitle')}
        </h3>

        {logsError ? (
          <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
            {logsError}
          </p>
        ) : (
          <div className="space-y-2 max-h-[260px] overflow-y-auto font-mono-tabular text-xs">
            {logs.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-3 py-1.5 border-b border-slate-800/60"
              >
                <span
                  className={
                    entry.level === 'error'
                      ? 'text-rose-400'
                      : entry.level === 'warn'
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                  }
                >
                  [{entry.level.toUpperCase()}]
                </span>
                <span className="text-slate-400">[{entry.scope}]</span>
                <span className="text-slate-200 flex-1">{entry.message}</span>
                <span className="text-slate-500">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
