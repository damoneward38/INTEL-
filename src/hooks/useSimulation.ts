import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelSimulationApi,
  fetchSimulationJobApi,
  submitSimulationApi,
} from '../services/api';
import type { SimulationJobResponse, SimulationParameters } from '../types';

export function useSimulation() {
  const [parameters, setParameters] = useState<SimulationParameters>({
    engine: 'langevin-md',
    temperature: 300,
    pressure: 1.0,
    steps: 1200,
  });

  const [job, setJob] = useState<SimulationJobResponse | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const closeSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setWsConnected(false);
  }, []);

  useEffect(() => {
    return () => closeSocket();
  }, [closeSocket]);

  const run = useCallback(async () => {
    closeSocket();
    setError(null);

    try {
      const created = await submitSimulationApi(parameters);
      setJob(created);

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/simulations/${encodeURIComponent(created.jobId)}`;
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setWsConnected(true);
      };

      socket.onmessage = (event) => {
        try {
          const update = JSON.parse(event.data) as SimulationJobResponse;
          setJob(update);
          if (
            update.state === 'completed' ||
            update.state === 'failed' ||
            update.state === 'cancelled'
          ) {
            setWsConnected(false);
            if (update.state === 'failed' && update.error) {
              setError(update.error);
            }
          }
        } catch {
          // Ignore malformed WS frame
        }
      };

      socket.onerror = async () => {
        setWsConnected(false);
        // Fallback poll once if WS fails
        try {
          const snapshot = await fetchSimulationJobApi(created.jobId);
          setJob(snapshot);
        } catch {
          setError('WebSocket simulation stream disconnected.');
        }
      };

      socket.onclose = () => {
        setWsConnected(false);
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed to start.');
    }
  }, [closeSocket, parameters]);

  const cancel = useCallback(async () => {
    if (!job?.jobId) return;
    try {
      const updated = await cancelSimulationApi(job.jobId);
      setJob(updated);
      closeSocket();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel simulation.');
    }
  }, [closeSocket, job?.jobId]);

  const running = job?.state === 'running' || job?.state === 'queued';

  return {
    parameters,
    setParameters,
    job,
    running,
    progress: job?.progress ?? 0,
    state: job?.state ?? 'idle',
    frames: job?.frames ?? [],
    particles: job?.particles ?? [],
    summary: job?.summary,
    wsConnected,
    error,
    run,
    cancel,
  };
}
