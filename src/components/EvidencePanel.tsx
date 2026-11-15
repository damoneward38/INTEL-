import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RetrievedSource } from '../types';

interface Props {
  sources: RetrievedSource[];
}

export default function EvidencePanel({ sources }: Props) {
  const { t } = useTranslation();

  return (
    <section className="rounded-xl border border-slate-800 bg-[#0D121D] p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h3 className="text-sm font-semibold text-slate-100">
          {t('insights.evidence')}
        </h3>
        <span className="text-xs font-mono-tabular text-slate-400">
          {sources.length}
        </span>
      </div>

      {sources.length === 0 ? (
        <p className="text-xs text-slate-400 py-3">{t('insights.emptySources')}</p>
      ) : (
        <div className="divide-y divide-slate-800">
          {sources.map((source, idx) => (
            <article key={`${source.id}-${idx}`} className="py-3.5 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 mb-1 font-mono-tabular">
                    <span className="text-cyan-400">
                      [{source.origin === 'indexed_corpus' ? `C${idx + 1}` : source.id}]
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {source.origin === 'indexed_corpus'
                        ? t('insights.corpusSource')
                        : t('insights.webSource')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {t('insights.similarity')}: {(source.score * 100).toFixed(0)}%
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {t('insights.license')}: {source.license}
                    </span>
                  </div>

                  <h4 className="text-sm font-medium text-slate-100">
                    {source.title}
                  </h4>

                  {source.authors && (
                    <p className="text-xs text-slate-400 mt-0.5">{source.authors}</p>
                  )}

                  <p className="text-xs leading-relaxed text-slate-300 mt-1.5">
                    {source.text}
                  </p>
                </div>

                {source.sourceUrl && (
                  <a
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-xs font-medium text-cyan-400 hover:text-cyan-300 shrink-0 whitespace-nowrap"
                  >
                    <span>{t('insights.viewSource')}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
