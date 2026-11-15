import { useCallback, useState } from 'react';
import { runResearchApi } from '../services/api';
import type { ResearchDepth, ResearchResult } from '../types';

export function useResearch() {
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(
    async (
      query: string,
      options: {
        language: 'en' | 'he';
        depth: ResearchDepth;
        inputMode?: 'text' | 'voice';
      }
    ) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      setLoading(true);
      setError(null);
      try {
        const res = await runResearchApi({
          query: trimmed,
          language: options.language,
          depth: options.depth,
          inputMode: options.inputMode ?? 'text',
        });
        setResult(res);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Research synthesis unavailable.'
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return {
    result,
    answer: result?.answer ?? '',
    sources: result?.sources ?? [],
    loading,
    error,
    ask,
  };
}
