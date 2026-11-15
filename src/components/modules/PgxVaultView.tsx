import { useEffect, useState } from 'react';
import { AlertTriangle, Dna, ExternalLink, Lock, ShieldCheck, Unlock } from 'lucide-react';
import {
  analyzePgxSampleApi,
  fetchPgxSamplesApi,
  revokePgxConsentApi,
  uploadPgxSampleApi,
} from '../../services/api';
import type {
  AuthSession,
  PgxEvidenceMatch,
  PgxSampleSummary,
} from '../../types';

interface Props {
  session: AuthSession;
}

export default function PgxVaultView({ session }: Props) {
  const [samples, setSamples] = useState<PgxSampleSummary[]>([]);
  const [sampleAlias, setSampleAlias] = useState('COHORT-PGX-042');
  const [consentGranted, setConsentGranted] = useState(true);
  const [consentScope, setConsentScope] = useState('CPIC Literature Evidence Research Only');
  const [genomicPayload, setGenomicPayload] = useState(
    '##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\n10\t94781859\trs4244285\tG\tA\n22\t42128945\trs3892097\tC\tT\nCYP2C19*2\nTPMT*3A'
  );
  const [selectedEvidence, setSelectedEvidence] = useState<{
    summary: PgxSampleSummary;
    evidence: PgxEvidenceMatch[];
    clinicalPolicyNotice: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canInspectVault =
    session.role === 'researcher' ||
    session.role === 'principal_investigator' ||
    session.role === 'auditor';
  const canDecryptAndUpload =
    session.role === 'researcher' || session.role === 'principal_investigator';

  async function refresh() {
    if (!canInspectVault) return;
    try {
      const res = await fetchPgxSamplesApi();
      setSamples(res.samples);
    } catch {
      // Ignore unauthenticated fetch errors
    }
  }

  useEffect(() => {
    refresh();
  }, [session.role]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await uploadPgxSampleApi({
        sampleAlias,
        genomicPayload,
        consentGranted,
        consentScope,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vault encryption upload failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAnalyze(sampleId: string) {
    setError(null);
    try {
      const res = await analyzePgxSampleApi(sampleId);
      setSelectedEvidence(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CPIC decryption failed.');
    }
  }

  async function handleRevoke(sampleId: string) {
    setError(null);
    try {
      await revokePgxConsentApi(sampleId);
      await refresh();
      if (selectedEvidence?.summary.sampleId === sampleId) {
        setSelectedEvidence(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Consent revocation failed.');
    }
  }

  return (
    <div className="space-y-5">
      {/* Strict Clinical Safety Notice */}
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-100 leading-relaxed">
          <span className="font-semibold">Clinical Evidence Boundary: </span>
          Payloads are encrypted server-side with AES-256-GCM and mapped solely to cited CPIC
          peer-reviewed literature with explicit uncertainty notes. Autonomous prescribing or
          direct clinical dosing recommendations are strictly prohibited.
        </div>
      </div>

      {!canInspectVault ? (
        <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-8 text-center text-xs text-slate-400">
          Pharmacogenomics Vault requires Researcher, Principal Investigator, or Auditor authentication.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Encrypted Genomic Upload */}
          <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-semibold text-slate-100">
                Encrypt & Store Genomic Variants (AES-256-GCM)
              </h2>
            </div>

            <form onSubmit={handleUpload} className="space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  De-identified Sample Alias
                </label>
                <input
                  type="text"
                  required
                  value={sampleAlias}
                  onChange={(e) => setSampleAlias(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  VCF / Star-Allele Variant Payload
                </label>
                <textarea
                  rows={5}
                  required
                  value={genomicPayload}
                  onChange={(e) => setGenomicPayload(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs font-mono text-slate-100"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  IRB / Participant Consent Scope
                </label>
                <input
                  type="text"
                  required
                  value={consentScope}
                  onChange={(e) => setConsentScope(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-200">
                <input
                  type="checkbox"
                  checked={consentGranted}
                  onChange={(e) => setConsentGranted(e.target.checked)}
                  className="accent-cyan-500"
                />
                <span>Verified participant written consent on file</span>
              </label>

              <button
                type="submit"
                disabled={!canDecryptAndUpload || loading}
                className="w-full px-4 py-2 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg disabled:opacity-45"
              >
                {loading ? 'Encrypting...' : 'Encrypt & Store in Vault'}
              </button>
            </form>

            {error && <p className="text-xs text-rose-400">{error}</p>}
          </div>

          {/* Right: Vault Inventory + CPIC Evidence Results */}
          <div className="lg:col-span-7 space-y-5">
            <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Dna className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-slate-100">
                  Encrypted Vault Inventory ({samples.length})
                </h3>
              </div>

              {samples.length === 0 ? (
                <p className="text-xs text-slate-500">No encrypted genomic records uploaded yet.</p>
              ) : (
                <div className="space-y-2">
                  {samples.map((s) => (
                    <div
                      key={s.sampleId}
                      className="rounded-lg border border-slate-800 bg-[#07090E] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div>
                        <div className="text-xs font-semibold text-slate-100">
                          {s.sampleAlias} · {s.format.toUpperCase()}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {s.cipherAlgorithm} · SHA-256 {s.digestSha256.slice(0, 12)}... ·{' '}
                          {s.consentGranted ? 'CONSENT ACTIVE' : 'REVOKED'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {canDecryptAndUpload && s.consentGranted && (
                          <button
                            type="button"
                            onClick={() => handleAnalyze(s.sampleId)}
                            className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 rounded hover:bg-cyan-500/25"
                          >
                            <Unlock className="w-3 h-3" />
                            <span>Query CPIC Evidence</span>
                          </button>
                        )}
                        {s.consentGranted && (
                          <button
                            type="button"
                            onClick={() => handleRevoke(s.sampleId)}
                            className="px-2.5 py-1 text-[11px] border border-rose-500/40 text-rose-300 rounded hover:bg-rose-500/10"
                          >
                            Revoke Consent
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selectedEvidence && (
              <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-sm font-semibold text-slate-100">
                      Cited CPIC Evidence: {selectedEvidence.summary.sampleAlias}
                    </h3>
                  </div>
                </div>

                {selectedEvidence.evidence.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    No curated CPIC Level 1A/1B variant matches detected in decrypted payload.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {selectedEvidence.evidence.map((ev, idx) => (
                      <article
                        key={idx}
                        className="rounded-lg border border-slate-800 bg-[#07090E] p-3.5 space-y-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-cyan-300">
                            {ev.gene} · {ev.alleleOrVariant}
                          </span>
                          <span className="font-mono text-[11px] text-emerald-300">
                            CPIC Level {ev.evidenceLevel}
                          </span>
                        </div>
                        <p className="text-slate-200">{ev.phenotype}</p>
                        <p className="text-slate-400">
                          Studied Associations: {ev.affectedDrugs.join(', ')}
                        </p>
                        <p className="text-[11px] text-amber-300">{ev.uncertaintyNote}</p>
                        <a
                          href={ev.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300"
                        >
                          <span>{ev.citation}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
