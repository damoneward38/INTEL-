import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Activity, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { fetchFluxEventsApi } from '../../services/api';
import type { FluxEvent } from '../../types';

export default function LiveFluxView() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [events, setEvents] = useState<FluxEvent[]>([]);
  const [stats, setStats] = useState<{
    totalEvents: number;
    topics: Record<string, number>;
    deduplicatedDigests: number;
  }>({ totalEvents: 0, topics: {}, deduplicatedDigests: 0 });
  const [topicFilter, setTopicFilter] = useState<string>('all');
  const [wsConnected, setWsConnected] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
  const pulseBoostRef = useRef(0);

  async function reload(topic = topicFilter) {
    try {
      const data = await fetchFluxEventsApi(topic);
      setEvents(data.events);
      setStats(data.stats);
    } catch {
      // Ignore transient load errors
    }
  }

  useEffect(() => {
    reload(topicFilter);
  }, [topicFilter]);

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/flux`);
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as {
          type: string;
          stats?: typeof stats;
          events?: FluxEvent[];
          event?: FluxEvent;
        };
        if (data.type === 'init') {
          if (data.stats) setStats(data.stats);
          if (data.events) setEvents(data.events);
        } else if (data.type === 'event' && data.event) {
          if (data.stats) setStats(data.stats);
          pulseBoostRef.current = 1.0;
          setEvents((prev) => [data.event!, ...prev].slice(0, 60));
        }
      } catch {
        // Ignore malformed payload
      }
    };
    return () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const probeCanvas = document.createElement('canvas');
    const glProbe = probeCanvas.getContext('webgl2');
    if (!glProbe) return;
    const ext = glProbe.getExtension('WEBGL_debug_renderer_info');
    const rendererName = String(
      glProbe.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : glProbe.RENDERER)
    );
    glProbe.getExtension('WEBGL_lose_context')?.loseContext();
    const isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(
      rendererName
    );

    const width = container.clientWidth || 720;
    const height = container.clientHeight || 360;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#070b13');
    scene.fog = new THREE.FogExp2('#070b13', 0.045);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 4.2, 10.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.target.set(0, 0, 0);

    const keyLight = new THREE.DirectionalLight('#f8e8d4', 1.8);
    keyLight.position.set(6, 9, 6);
    scene.add(keyLight);

    const hemiLight = new THREE.HemisphereLight('#67e8f9', '#0f172a', 0.85);
    scene.add(hemiLight);

    // 3 Partition Hubs (Kafka partitions 0, 1, 2)
    const hubMat = new THREE.MeshStandardMaterial({
      color: '#06b6d4',
      metalness: 0.78,
      roughness: 0.22,
    });
    const ringMat = new THREE.MeshStandardMaterial({
      color: '#38bdf8',
      metalness: 0.45,
      roughness: 0.35,
    });

    const hubs: THREE.Group[] = [];
    for (let p = 0; p < 3; p++) {
      const group = new THREE.Group();
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 1), hubMat);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.05, 12, 36), ringMat);
      collar.rotation.x = Math.PI / 2;
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.65, 0.78, 0.16, 24),
        new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.6, roughness: 0.5 })
      );
      base.position.y = -0.85;
      group.add(core, collar, base);
      group.position.set((p - 1) * 3.8, 0, 0);
      scene.add(group);
      hubs.push(group);
    }

    // Instanced event packets flowing between partition hubs
    const packetCount = 72;
    const packetGeom = new THREE.SphereGeometry(0.09, 10, 10);
    const packetMat = new THREE.MeshStandardMaterial({
      color: '#22d3ee',
      emissive: '#0891b2',
      emissiveIntensity: 0.6,
      roughness: 0.25,
      metalness: 0.3,
    });
    const packetMesh = new THREE.InstancedMesh(packetGeom, packetMat, packetCount);
    packetMesh.frustumCulled = false;
    scene.add(packetMesh);

    const dummy = new THREE.Object3D();
    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const status = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (status === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function animate() {
      if (disposed) return;
      const elapsed = clock.getElapsedTime();
      const boost = pulseBoostRef.current;
      pulseBoostRef.current = Math.max(0, boost - 0.02);

      hubs.forEach((hub, idx) => {
        hub.children[0].rotation.y = elapsed * (0.45 + idx * 0.12 + boost * 1.2);
        hub.children[1].rotation.z = elapsed * 0.3;
      });

      for (let i = 0; i < packetCount; i++) {
        const lane = (i % 3) - 1;
        const phase = (elapsed * (0.35 + boost * 0.6) + i * 0.17) % (Math.PI * 2);
        dummy.position.set(
          lane * 3.8 + Math.cos(phase) * 1.45,
          Math.sin(phase * 2 + i) * 0.75,
          Math.sin(phase) * 1.45
        );
        const s = 0.8 + 0.35 * Math.sin(phase);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        packetMesh.setMatrixAt(i, dummy.matrix);
      }
      packetMesh.instanceMatrix.needsUpdate = true;

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(animate);
      } else {
        frameId = requestAnimationFrame(animate);
      }
    }

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 720;
      const h = container.clientHeight || 360;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      packetGeom.dispose();
      packetMat.dispose();
      hubMat.dispose();
      ringMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const filteredEvents =
    topicFilter === 'all' ? events : events.filter((e) => e.topic === topicFilter);

  return (
    <div className="flex flex-col gap-5">
      {/* 3D Live Knowledge Partition Stream Viewport */}
      <div className="relative rounded-xl border border-slate-800 bg-[#070b13] overflow-hidden h-[360px]">
        <div ref={mountRef} className="w-full h-full" />

        <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
          <div className="bg-[#0A0E17]/95 border border-slate-800 rounded-lg px-3 py-1.5 pointer-events-auto">
            <span className="text-xs font-semibold text-slate-100">
              Live Knowledge Flux · Partitioned Event Stream
            </span>
          </div>
          <div className="bg-[#0A0E17]/95 border border-slate-800 rounded-lg px-3 py-1.5 text-[11px] font-mono text-slate-300 pointer-events-auto">
            WS {wsConnected ? 'CONNECTED' : 'POLLING'} · {stats.totalEvents} EVENTS ·{' '}
            {stats.deduplicatedDigests} SHA-256 DIGESTS
          </div>
        </div>

        {/* Collapsible bottom dock */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center max-w-[94%]">
          <button
            type="button"
            onClick={() => setDockOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium bg-[#0A0E17]/95 border border-slate-800 rounded-t-lg text-slate-300 hover:text-slate-100"
          >
            {dockOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            <span>{dockOpen ? 'Hide Stream Controls' : 'Show Stream Controls'}</span>
          </button>
          {dockOpen && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-[#0A0E17]/95 border border-slate-800 rounded-lg">
              {['all', 'knowledge.ingested', 'knowledge.indexed', 'sandbox.update', 'vault.access', 'market.transaction'].map(
                (topic) => (
                  <button
                    key={topic}
                    type="button"
                    onClick={() => setTopicFilter(topic)}
                    className={`px-2.5 py-1 text-[11px] rounded border ${
                      topicFilter === topic
                        ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                        : 'border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {topic}
                  </button>
                )
              )}
              <button
                type="button"
                onClick={() => reload()}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] border border-slate-700 rounded text-slate-200 hover:bg-slate-800"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Sync</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Event Stream Inspector */}
      <div className="rounded-xl border border-slate-800 bg-[#0D121D] p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-slate-100">
              Kafka-Compatible Event Ledger (Partitions 0–2)
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            Topics Active: {Object.keys(stats.topics).length}
          </span>
        </div>

        {filteredEvents.length === 0 ? (
          <p className="text-xs text-slate-500">No events recorded for this topic yet.</p>
        ) : (
          <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
            {filteredEvents.map((ev) => (
              <div
                key={ev.id}
                className="rounded-lg border border-slate-800 bg-[#07090E] px-3.5 py-2.5 flex flex-col gap-1"
              >
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="text-cyan-300">
                    {ev.topic} · P{ev.partition} · offset #{ev.offset}
                  </span>
                  <span className="text-slate-500">
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-xs text-slate-200">{ev.summary}</p>
                <span className="text-[10px] font-mono text-slate-500">
                  SHA-256: {ev.digestSha256.slice(0, 24)}... · Key: {ev.key}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
