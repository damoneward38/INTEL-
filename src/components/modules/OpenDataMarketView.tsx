import { useEffect, useState } from 'react';
import { CheckCircle2, Database, ExternalLink, PackagePlus } from 'lucide-react';
import {
  acquireMarketDatasetApi,
  fetchMarketCatalogApi,
} from '../../services/api';
import type { MarketDataset, MarketTransaction, UserRole } from '../../types';

interface Props {
  userRole: UserRole;
  onCorpusUpdated: () => Promise<void>;
}

export default function OpenDataMarketView({ userRole, onCorpusUpdated }: Props) {
  const [datasets, setDatasets] = useState<MarketDataset[]>([]);
  const [transactions, setTransactions] = useState<MarketTransaction[]>([]);
  const [acquiringId, setAcquiringId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const canAcquire = userRole === 'researcher' || userRole === 'principal_investigator';

  async function refresh() {
    try {
      const res = await fetchMarketCatalogApi();
      setDatasets(res.datasets);
      setTransactions(res.transactions);
    } catch {
      // Ignore fetch errors
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleAcquire(datasetId: string) {
    setAcquiringId(datasetId);
    setFeedback(null);
    try {
      const res = await acquireMarketDatasetApi({
        datasetId,
        indexIntoCorpus: true,
      });
      await onCorpusUpdated();
      await refresh();
      setFeedback(
        `Verified ${res.dataset.license} & acquired CID ${res.dataset.cidV1.slice(
          0,
          16
        )}... (${res.indexedChunks.length} chunk(s) indexed). Tx: ${res.transaction.txId}`
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Acquisition failed.');
    } finally {
      setAcquiringId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-cyan-400" />
            <h2 className="text-base font-semibold text-slate-100">
              Open-Data Market · SPDX License Verified & IPFS CIDv1 Storage
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Authenticated dataset catalog using deterministic content-addressed CIDv1 digests (zero blockchain overhead).
          </p>
        </div>
        {!canAcquire && (
          <span className="text-xs text-amber-300">
            Sign in as Researcher or PI to acquire & index datasets.
          </span>
        )}
      </div>

      {feedback && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">
          {feedback}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {datasets.map((ds) => (
          <article
            key={ds.datasetId}
            className="rounded-xl border border-slate-800 bg-[#0D121D] p-5 flex flex-col justify-between gap-3"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-cyan-300">
                  {ds.domain} · {ds.license}
                </span>
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{ds.verified ? 'LICENSE VERIFIED' : 'PENDING'}</span>
                </span>
              </div>
              <h3 className="text-sm font-semibold text-slate-100">{ds.title}</h3>
              <p className="text-xs text-slate-300 leading-relaxed">{ds.summary}</p>
              <div className="text-[11px] font-mono text-slate-400 space-y-0.5">
                <div>Owner: {ds.owner}</div>
                <div>
                  Size: {ds.sizeMb} MB · {ds.recordsCount.toLocaleString()} records
                </div>
                <div>IPFS CIDv1: {ds.cidV1}</div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <a
                href={ds.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
              >
                <span>Source Repository</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <button
                type="button"
                disabled={!canAcquire || acquiringId === ds.datasetId}
                onClick={() => handleAcquire(ds.datasetId)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg disabled:opacity-45"
              >
                <PackagePlus className="w-3.5 h-3.5" />
                <span>
                  {acquiringId === ds.datasetId ? 'Verifying...' : 'Acquire & Index'}
                </span>
              </button>
            </div>
          </article>
        ))}
      </div>

      {transactions.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-2.5">
          <h3 className="text-sm font-semibold text-slate-100">
            Authenticated Acquisition Ledger
          </h3>
          {transactions.map((tx) => (
            <div
              key={tx.txId}
              className="rounded-lg border border-slate-800 bg-[#07090E] px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono"
            >
              <span className="text-cyan-300">
                {tx.txId} · {tx.datasetId}
              </span>
              <span className="text-slate-400">
                {tx.license} · Prov {tx.provenanceId} · {new Date(tx.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
