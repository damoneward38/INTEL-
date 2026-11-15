import { useEffect, useState } from 'react';
import { LoaderCircle, ShieldAlert, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { submitFeedbackApi } from '../services/api';
import type { ResearchResult } from '../types';

interface Props {
  result: ResearchResult | null;
  loading: boolean;
}

export default function ResearchAnswer({ result, loading }: Props) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(5);
  const [decision, setDecision] = useState<'approved' | 'needs_revision' | 'flagged'>('approved');
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    setReviewSubmitted(false);
    setReviewError(null);
    setComments('');
  }, [result?.provenanceId]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-8 text-sm text-cyan-300">
        <LoaderCircle className="w-5 h-5 animate-spin shrink-0" />
        <span>{t('command.processing')}</span>
      </div>
    );
  }

  if (!result) {
    return (
      <p className="text-sm text-slate-400 leading-relaxed py-4">
        {t('insights.emptyAnswer')}
      </p>
    );
  }

  async function handleReviewSubmit(e: React.FormEvent) {
    if (!result) return;
    e.preventDefault();
    setSubmitting(true);
    setReviewError(null);
    try {
      await submitFeedbackApi({
        provenanceId: result.provenanceId,
        question: result.query,
        answerExcerpt: result.answer.slice(0, 400),
        rating,
        comments,
        reviewDecision: decision,
      });
      setReviewSubmitted(true);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Failed to submit review');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 font-mono-tabular">
        <span>{result.model}</span>
        <span aria-hidden="true">·</span>
        <span>{result.corpusHits} corpus</span>
        <span aria-hidden="true">·</span>
        <span>{result.webHits} web</span>
        <span aria-hidden="true">·</span>
        <span>{result.durationMs} ms</span>
        <span aria-hidden="true">·</span>
        <span className="text-cyan-400">{result.provenanceId}</span>
      </div>

      {/* Mandatory Human Scientific Review Gate Notice */}
      <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
        <span>{t('insights.reviewRequired')}</span>
      </div>

      <article className="text-sm leading-7 text-slate-200 whitespace-pre-wrap max-h-[280px] overflow-y-auto pe-2">
        {result.answer}
      </article>

      {/* Human Peer Review & Feedback Gate (Quarantined from Auto-Training) */}
      {reviewSubmitted ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{t('insights.reviewSaved')}</span>
        </div>
      ) : (
        <form
          onSubmit={handleReviewSubmit}
          className="mt-1 pt-3 border-t border-slate-800 flex flex-col gap-2.5"
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {t('insights.reviewRating')}
              </label>
              <select
                value={rating}
                onChange={(e) => setRating(Number(e.target.value))}
                className="w-full rounded-md border border-slate-700 bg-[#07090E] px-2.5 py-1.5 text-xs font-mono-tabular text-slate-100"
              >
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n} / 5
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {t('insights.reviewDecision')}
              </label>
              <select
                value={decision}
                onChange={(e) =>
                  setDecision(e.target.value as 'approved' | 'needs_revision' | 'flagged')
                }
                className="w-full rounded-md border border-slate-700 bg-[#07090E] px-2.5 py-1.5 text-xs text-slate-100"
              >
                <option value="approved">Approved</option>
                <option value="needs_revision">Needs Revision</option>
                <option value="flagged">Flagged</option>
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder={t('insights.reviewNotes')}
              className="flex-1 rounded-md border border-slate-700 bg-[#07090E] px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-white text-slate-950 rounded-md whitespace-nowrap disabled:opacity-50"
            >
              {t('insights.submitReview')}
            </button>
          </div>
          {reviewError && <p className="text-xs text-rose-400">{reviewError}</p>}
        </form>
      )}
    </div>
  );
}
