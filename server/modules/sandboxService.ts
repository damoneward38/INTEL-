import crypto from 'node:crypto';
import * as Y from 'yjs';
import type { AuthSession, SandboxSnapshot } from '../types.ts';
import { recordProvenance } from '../provenance.ts';
import { publishFluxEvent } from './knowledgeFlux.ts';

export interface SandboxPeer {
  peerId: string;
  name: string;
  role: AuthSession['role'];
  joinedAt: string;
}

interface SandboxRoom {
  roomId: string;
  doc: Y.Doc;
  snapshots: SandboxSnapshot[];
  peers: Map<string, SandboxPeer>;
}

const rooms = new Map<string, SandboxRoom>();

function seedRoomDefaults(room: SandboxRoom): void {
  const experiment = room.doc.getMap<unknown>('experiment');
  if (!experiment.has('title')) {
    room.doc.transact(() => {
      experiment.set(
        'title',
        room.roomId === 'quantum-md-alpha'
          ? 'Lennard-Jones / Surface Code Hybrid Protocol'
          : 'Biomedical Pharmacogenomics & MD Assay'
      );
      experiment.set(
        'hypothesis',
        'Hydrogen mass repartitioning at 4 fs step preserves NVT canonical temperature convergence within 2% of NIST 300 K reference values.'
      );
      experiment.set(
        'protocol',
        '1. Equilibrate 28 LJ particles at 300 K, 1 atm (LangevinMiddleIntegrator).\n2. Validate virial pressure convergence & RMSD plateau.\n3. Cross-check against CPIC/Psi4 reference bounds.'
      );
      experiment.set('temperatureK', 300);
      experiment.set('steps', 1200);
      experiment.set('engine', 'langevin-md');
    });
  }
}

export function getOrCreateSandboxRoom(roomId: string): SandboxRoom {
  const safeId = roomId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'quantum-md-alpha';
  let room = rooms.get(safeId);
  if (!room) {
    room = {
      roomId: safeId,
      doc: new Y.Doc(),
      snapshots: [],
      peers: new Map(),
    };
    seedRoomDefaults(room);
    rooms.set(safeId, room);
  }
  return room;
}

export function getSandboxStateBase64(roomId: string): {
  roomId: string;
  stateBase64: string;
  summary: SandboxSnapshot['summary'] & { engine: string };
  peers: SandboxPeer[];
  snapshots: SandboxSnapshot[];
} {
  const room = getOrCreateSandboxRoom(roomId);
  const update = Y.encodeStateAsUpdate(room.doc);
  const experiment = room.doc.getMap<unknown>('experiment');
  return {
    roomId: room.roomId,
    stateBase64: Buffer.from(update).toString('base64'),
    summary: {
      hypothesis: String(experiment.get('hypothesis') ?? ''),
      protocol: String(experiment.get('protocol') ?? ''),
      temperatureK: Number(experiment.get('temperatureK') ?? 300),
      steps: Number(experiment.get('steps') ?? 1200),
      engine: String(experiment.get('engine') ?? 'langevin-md'),
    },
    peers: Array.from(room.peers.values()),
    snapshots: room.snapshots,
  };
}

export function applySandboxYjsUpdate(
  roomId: string,
  updateBase64: string,
  session: AuthSession
): { stateBase64: string } {
  const room = getOrCreateSandboxRoom(roomId);
  const raw = Buffer.from(updateBase64, 'base64');
  Y.applyUpdate(room.doc, new Uint8Array(raw));

  publishFluxEvent({
    topic: 'sandbox.update',
    key: room.roomId,
    actorRole: session.role,
    summary: `Collaborative CRDT update in sandbox ${room.roomId}`,
    payload: {
      roomId: room.roomId,
      bytes: raw.byteLength,
      actorId: session.userId,
    },
  });

  return {
    stateBase64: Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString('base64'),
  };
}

export function createSandboxSnapshot(
  roomId: string,
  title: string,
  session: AuthSession
): SandboxSnapshot {
  const room = getOrCreateSandboxRoom(roomId);
  const experiment = room.doc.getMap<unknown>('experiment');
  const updateBase64 = Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString('base64');

  const snapshot: SandboxSnapshot = {
    snapshotId: `snp-${crypto.randomUUID().slice(0, 8)}`,
    roomId: room.roomId,
    title: title.trim() || `Snapshot ${room.snapshots.length + 1}`,
    createdBy: session.name,
    role: session.role,
    timestamp: new Date().toISOString(),
    updateBase64,
    summary: {
      hypothesis: String(experiment.get('hypothesis') ?? ''),
      protocol: String(experiment.get('protocol') ?? ''),
      temperatureK: Number(experiment.get('temperatureK') ?? 300),
      steps: Number(experiment.get('steps') ?? 1200),
    },
  };

  room.snapshots.unshift(snapshot);
  if (room.snapshots.length > 30) {
    room.snapshots.length = 30;
  }

  recordProvenance({
    kind: 'research',
    actorId: session.userId,
    actorRole: session.role,
    action: `sandbox:snapshot:${room.roomId}`,
    rawInput: updateBase64,
    modelOrEngine: 'yjs-crdt-v13',
    licenses: ['Internal Collaborative Workspace'],
    sourceUrls: [],
    metadata: {
      snapshotId: snapshot.snapshotId,
      roomId: room.roomId,
    },
  });

  return snapshot;
}

export function restoreSandboxSnapshot(
  roomId: string,
  snapshotId: string,
  session: AuthSession
): { stateBase64: string } | null {
  const room = getOrCreateSandboxRoom(roomId);
  const found = room.snapshots.find((s) => s.snapshotId === snapshotId);
  if (!found) return null;

  // Replace experiment map contents deterministically from snapshot update
  const freshDoc = new Y.Doc();
  Y.applyUpdate(freshDoc, new Uint8Array(Buffer.from(found.updateBase64, 'base64')));
  const freshMap = freshDoc.getMap<unknown>('experiment');
  const currentMap = room.doc.getMap<unknown>('experiment');
  room.doc.transact(() => {
    for (const [k, v] of freshMap.entries()) {
      currentMap.set(k, v);
    }
  });

  publishFluxEvent({
    topic: 'sandbox.update',
    key: room.roomId,
    actorRole: session.role,
    summary: `Restored sandbox snapshot "${found.title}" in ${room.roomId}`,
    payload: { snapshotId: found.snapshotId },
  });

  return {
    stateBase64: Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString('base64'),
  };
}

export function registerSandboxPeer(roomId: string, peer: SandboxPeer): SandboxPeer[] {
  const room = getOrCreateSandboxRoom(roomId);
  room.peers.set(peer.peerId, peer);
  return Array.from(room.peers.values());
}

export function removeSandboxPeer(roomId: string, peerId: string): SandboxPeer[] {
  const room = getOrCreateSandboxRoom(roomId);
  room.peers.delete(peerId);
  return Array.from(room.peers.values());
}
