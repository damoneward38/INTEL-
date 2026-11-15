import { useCallback, useEffect, useState } from 'react';
import { fetchCorpusApi, ingestCorpusApi } from '../services/api';
import type { CorpusChunk } from '../types';

export function useCorpus() {
  const [chunks, setChunks] = useState<CorpusChunk[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (domain = selectedDomain) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCorpusApi(domain);
      setChunks(data.chunks);
      setDomains(data.domains);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load corpus.');
    } finally {
      setLoading(false);
    }
  }, [selectedDomain]);

  useEffect(() => {
    load(selectedDomain);
  }, [load, selectedDomain]);

  const ingest = useCallback(
    async (doc: {
      title: string;
      authors: string;
      domain: string;
      license: string;
      sourceUrl: string;
      content: string;
    }) => {
      setError(null);
      const res = await ingestCorpusApi(doc);
      await load(selectedDomain);
      return res;
    },
    [load, selectedDomain]
  );

  return {
    chunks,
    domains,
    selectedDomain,
    setSelectedDomain,
    loading,
    error,
    reload: load,
    ingest,
  };
}
