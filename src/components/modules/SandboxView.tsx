import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { History, Radio, Save, Users } from 'lucide-react';
import {
  createSandboxSnapshotApi,
  fetchSandboxStateApi,
  restoreSandboxSnapshotApi,
} from '../../services/api';
import type { AuthSession, SandboxPeer, SandboxSnapshot } from '../../types';

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

interface Props {
  session: AuthSession;
}

export default function SandboxView({ session }: Props) {
  const [roomId, setRoomId] = useState('quantum-md-alpha');
  const [title, setTitle] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [protocol, setProtocol] = useState('');
  const [temperatureK, setTemperatureK] = useState(300);
  const [steps, setSteps] = useState(1200);
  const [peers, setPeers] = useState<SandboxPeer[]>([]);
  const [snapshots, setSnapshots] = useState<SandboxSnapshot[]>([]);
  const [snapshotTitle, setSnapshotTitle] = useState('Checkpoint v1');
  const [wsConnected, setWsConnected] = useState(false);
  const [webrtcStatus, setWebrtcStatus] = useState('Signaling ready (WebSocket relay)');
  const [feedback, setFeedback] = useState<string | null>(null);

  const docRef = useRef<Y.Doc | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const peerConnRef = useRef<RTCPeerConnection | null>(null);
  const isRemoteRef = useRef(false);

  const canWrite =
    session.role === 'researcher' || session.role === 'principal_investigator';

  function readDocToReact(doc: Y.Doc) {
    const exp = doc.getMap<unknown>('experiment');
    setTitle(String(exp.get('title') ?? ''));
    setHypothesis(String(exp.get('hypothesis') ?? ''));
    setProtocol(String(exp.get('protocol') ?? ''));
    setTemperatureK(Number(exp.get('temperatureK') ?? 300));
    setSteps(Number(exp.get('steps') ?? 1200));
  }

  useEffect(() => {
    const doc = new Y.Doc();
    docRef.current = doc;

    let cancelled = false;
    fetchSandboxStateApi(roomId)
      .then((res) => {
        if (cancelled) return;
        isRemoteRef.current = true;
        Y.applyUpdate(doc, base64ToUint8(res.stateBase64), 'remote');
        isRemoteRef.current = false;
        readDocToReact(doc);
        setPeers(res.peers);
        setSnapshots(res.snapshots);
      })
      .catch(() => {});

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const peerId = `${session.userId}-${Math.random().toString(36).slice(2, 6)}`;
    const wsUrl = `${proto}//${window.location.host}/ws/sandbox/${encodeURIComponent(
      roomId
    )}?peerId=${encodeURIComponent(peerId)}&name=${encodeURIComponent(
      session.name
    )}&role=${encodeURIComponent(session.role)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data) as {
          type: string;
          stateBase64?: string;
          updateBase64?: string;
          peers?: SandboxPeer[];
          fromPeerId?: string;
          signal?: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
        };
        if (msg.type === 'sync' && msg.stateBase64) {
          isRemoteRef.current = true;
          Y.applyUpdate(doc, base64ToUint8(msg.stateBase64), 'remote');
          isRemoteRef.current = false;
          readDocToReact(doc);
          if (msg.peers) setPeers(msg.peers);
        } else if (msg.type === 'yjs-update' && msg.updateBase64) {
          isRemoteRef.current = true;
          Y.applyUpdate(doc, base64ToUint8(msg.updateBase64), 'remote');
          isRemoteRef.current = false;
          readDocToReact(doc);
        } else if (msg.type === 'presence' && msg.peers) {
          setPeers(msg.peers);
        } else if (msg.type === 'webrtc-signal' && msg.signal && msg.fromPeerId) {
          await handleIncomingRtcSignal(msg.fromPeerId, msg.signal, ws);
        }
      } catch {
        // Ignore malformed socket message
      }
    };

    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote' || isRemoteRef.current) return;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'yjs-update',
            updateBase64: uint8ToBase64(update),
          })
        );
      }
    };
    doc.on('update', onUpdate);

    return () => {
      cancelled = true;
      doc.off('update', onUpdate);
      doc.destroy();
      ws.close();
      peerConnRef.current?.close();
    };
  }, [roomId, session.userId, session.name, session.role]);

  async function handleIncomingRtcSignal(
    fromPeerId: string,
    signal: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit },
    ws: WebSocket
  ) {
    if (typeof RTCPeerConnection === 'undefined') return;
    if (!peerConnRef.current) {
      const pc = new RTCPeerConnection();
      peerConnRef.current = pc;
      pc.onicecandidate = (ev) => {
        if (ev.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'webrtc-signal',
              targetPeerId: fromPeerId,
              signal: { candidate: ev.candidate },
            })
          );
        }
      };
      pc.ondatachannel = (ev) => {
        ev.channel.onopen = () =>
          setWebrtcStatus(`WebRTC DataChannel connected with ${fromPeerId}`);
      };
    }
    const pc = peerConnRef.current;
    if (signal.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      if (signal.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(
          JSON.stringify({
            type: 'webrtc-signal',
            targetPeerId: fromPeerId,
            signal: { sdp: pc.localDescription },
          })
        );
        setWebrtcStatus(`WebRTC peer answered ${fromPeerId}`);
      }
    } else if (signal.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    }
  }

  async function handleInitiateWebRtc() {
    if (typeof RTCPeerConnection === 'undefined') {
      setWebrtcStatus('WebRTC unavailable in this browser environment');
      return;
    }
    const ws = wsRef.current;
    const otherPeer = peers.find((p) => p.role !== session.role || p.name !== session.name);
    const pc = new RTCPeerConnection();
    peerConnRef.current = pc;
    const dc = pc.createDataChannel('intel-sandbox');
    dc.onopen = () => setWebrtcStatus('WebRTC P2P DataChannel active');

    pc.onicecandidate = (ev) => {
      if (ev.candidate && ws?.readyState === WebSocket.OPEN && otherPeer) {
        ws.send(
          JSON.stringify({
            type: 'webrtc-signal',
            targetPeerId: otherPeer.peerId,
            signal: { candidate: ev.candidate },
          })
        );
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (ws?.readyState === WebSocket.OPEN && otherPeer) {
      ws.send(
        JSON.stringify({
          type: 'webrtc-signal',
          targetPeerId: otherPeer.peerId,
          signal: { sdp: pc.localDescription },
        })
      );
      setWebrtcStatus(`WebRTC offer transmitted to ${otherPeer.name}`);
    } else {
      setWebrtcStatus('WebRTC SDP offer initialized locally (awaiting remote peer)');
    }
  }

  function mutateField(field: string, value: string | number) {
    if (!canWrite || !docRef.current) return;
    const exp = docRef.current.getMap<unknown>('experiment');
    docRef.current.transact(() => {
      exp.set(field, value);
    });
    readDocToReact(docRef.current);
  }

  async function handleSaveSnapshot() {
    setFeedback(null);
    try {
      const res = await createSandboxSnapshotApi(roomId, snapshotTitle);
      setSnapshots((prev) => [res.snapshot, ...prev]);
      setFeedback(`Saved CRDT snapshot "${res.snapshot.title}" (${res.snapshot.snapshotId}).`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to save snapshot.');
    }
  }

  async function handleRestoreSnapshot(snapshotId: string) {
    setFeedback(null);
    try {
      const res = await restoreSandboxSnapshotApi(roomId, snapshotId);
      if (docRef.current) {
        isRemoteRef.current = true;
        Y.applyUpdate(docRef.current, base64ToUint8(res.stateBase64), 'remote');
        isRemoteRef.current = false;
        readDocToReact(docRef.current);
      }
      setFeedback(`Restored snapshot ${snapshotId}.`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Restore failed.');
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-8 rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Collaborative Design Sandbox (Yjs CRDT + WebRTC)
            </h2>
            <p className="text-xs text-slate-400">
              Syncs live across connected browser tabs via Yjs binary CRDT deltas.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-[#07090E] px-2.5 py-1.5 text-xs text-slate-100"
            >
              <option value="quantum-md-alpha">Room: Quantum MD Alpha</option>
              <option value="biopharma-assay-01">Room: Biopharma Assay 01</option>
            </select>
            <span className="text-[11px] font-mono text-cyan-300">
              {wsConnected ? 'YJS SYNC LIVE' : 'CONNECTING'}
            </span>
          </div>
        </div>

        {!canWrite && (
          <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            Guest observers have read-only CRDT access. Sign in as Researcher or PI to edit and commit snapshots.
          </p>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Experiment Title
            </label>
            <input
              type="text"
              value={title}
              disabled={!canWrite}
              onChange={(e) => mutateField('title', e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100 disabled:opacity-60"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Shared Working Hypothesis
            </label>
            <textarea
              rows={2}
              value={hypothesis}
              disabled={!canWrite}
              onChange={(e) => mutateField('hypothesis', e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100 disabled:opacity-60"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Collaborative Protocol & Conditions
            </label>
            <textarea
              rows={4}
              value={protocol}
              disabled={!canWrite}
              onChange={(e) => mutateField('protocol', e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100 font-mono disabled:opacity-60"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Target Temperature (K)
              </label>
              <input
                type="number"
                value={temperatureK}
                disabled={!canWrite}
                onChange={(e) => mutateField('temperatureK', Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Integration Steps
              </label>
              <input
                type="number"
                value={steps}
                disabled={!canWrite}
                onChange={(e) => mutateField('steps', Number(e.target.value))}
                className="w-full rounded-lg border border-slate-700 bg-[#07090E] px-3 py-2 text-xs text-slate-100 disabled:opacity-60"
              />
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={snapshotTitle}
            disabled={!canWrite}
            onChange={(e) => setSnapshotTitle(e.target.value)}
            placeholder="Snapshot label"
            className="flex-1 min-w-[180px] rounded-lg border border-slate-700 bg-[#07090E] px-3 py-1.5 text-xs text-slate-100"
          />
          <button
            type="button"
            disabled={!canWrite}
            onClick={handleSaveSnapshot}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg disabled:opacity-45"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Commit Snapshot</span>
          </button>
        </div>

        {feedback && <p className="text-xs text-emerald-300">{feedback}</p>}
      </div>

      {/* Right: Connected Peers, WebRTC Signaling & Version History */}
      <div className="lg:col-span-4 flex flex-col gap-5">
        <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-semibold text-slate-100">
                Active Collaborators ({peers.length})
              </h3>
            </div>
            <button
              type="button"
              onClick={handleInitiateWebRtc}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] border border-cyan-500/40 text-cyan-300 rounded hover:bg-cyan-500/10"
            >
              <Radio className="w-3 h-3" />
              <span>WebRTC Peer</span>
            </button>
          </div>
          <p className="text-[11px] font-mono text-slate-400">{webrtcStatus}</p>
          <div className="space-y-1.5">
            {peers.map((p) => (
              <div
                key={p.peerId}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#07090E] px-3 py-2 text-xs"
              >
                <span className="text-slate-200">{p.name}</span>
                <span className="text-[11px] font-mono text-slate-400">{p.role}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-slate-100">Version History</h3>
          </div>
          {snapshots.length === 0 ? (
            <p className="text-xs text-slate-500">No snapshots committed yet.</p>
          ) : (
            <div className="space-y-2 max-h-[260px] overflow-y-auto">
              {snapshots.map((snap) => (
                <div
                  key={snap.snapshotId}
                  className="rounded-lg border border-slate-800 bg-[#07090E] p-3 flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-100">{snap.title}</span>
                    <button
                      type="button"
                      disabled={!canWrite}
                      onClick={() => handleRestoreSnapshot(snap.snapshotId)}
                      className="text-[11px] text-cyan-400 hover:text-cyan-300 disabled:opacity-45"
                    >
                      Restore
                    </button>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {snap.createdBy} · {new Date(snap.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
