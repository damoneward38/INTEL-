import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ChevronDown, ChevronUp, ExternalLink, RefreshCw } from 'lucide-react';
import { fetchNarrativeTimelineApi } from '../../services/api';
import type { NarrativeNode } from '../../types';

const KIND_COLORS: Record<NarrativeNode['kind'], string> = {
  corpus: '#38bdf8',
  research: '#a78bfa',
  simulation: '#34d399',
  review: '#fbbf24',
  prototype: '#f472b6',
  market: '#fb923c',
};

export default function Narrative3DView() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [nodes, setNodes] = useState<NarrativeNode[]>([]);
  const [edges, setEdges] = useState<Array<{ from: string; to: string; relation: string }>>([]);
  const [selected, setSelected] = useState<NarrativeNode | null>(null);
  const [dockOpen, setDockOpen] = useState(true);

  async function reload() {
    try {
      const data = await fetchNarrativeTimelineApi();
      setNodes(data.nodes);
      setEdges(data.edges);
      if (data.nodes.length > 0 && !selected) {
        setSelected(data.nodes[data.nodes.length - 1]);
      }
    } catch {
      // Ignore fetch errors
    }
  }

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container || nodes.length === 0) return;

    const probeCanvas = document.createElement('canvas');
    const glProbe = probeCanvas.getContext('webgl2');
    if (!glProbe) return;
    const ext = glProbe.getExtension('WEBGL_debug_renderer_info');
    const gpuStr = String(
      glProbe.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : glProbe.RENDERER)
    );
    glProbe.getExtension('WEBGL_lose_context')?.loseContext();
    const isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpuStr);

    const width = container.clientWidth || 720;
    const height = container.clientHeight || 420;

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
    scene.fog = new THREE.FogExp2('#070b13', 0.032);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 120);
    camera.position.set(6.5, 4.2, 8.8);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.target.set(0, 0, 0);

    const key = new THREE.DirectionalLight('#fff2e2', 1.85);
    key.position.set(8, 10, 8);
    scene.add(key);
    scene.add(new THREE.HemisphereLight('#67e8f9', '#0f172a', 0.85));

    const interactiveMeshes: THREE.Mesh[] = [];
    const nodePosMap = new Map<string, THREE.Vector3>();

    nodes.forEach((node) => {
      const pos = new THREE.Vector3(node.position[0], node.position[1], node.position[2]);
      nodePosMap.set(node.id, pos);

      const group = new THREE.Group();
      group.position.copy(pos);

      const color = KIND_COLORS[node.kind] || '#38bdf8';
      const coreGeom = new THREE.SphereGeometry(0.28, 18, 18);
      const coreMat = new THREE.MeshStandardMaterial({
        color,
        metalness: 0.72,
        roughness: 0.24,
        emissive: color,
        emissiveIntensity: selected?.id === node.id ? 0.55 : 0.15,
      });
      const core = new THREE.Mesh(coreGeom, coreMat);
      core.userData = { node };
      interactiveMeshes.push(core);

      const haloGeom = new THREE.TorusGeometry(0.42, 0.03, 10, 28);
      const haloMat = new THREE.MeshStandardMaterial({
        color: '#cbd5e1',
        metalness: 0.55,
        roughness: 0.4,
      });
      const halo = new THREE.Mesh(haloGeom, haloMat);
      halo.rotation.x = Math.PI / 2;

      const stemGeom = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8);
      const stem = new THREE.Mesh(stemGeom, haloMat);
      stem.position.y = -0.35;

      group.add(core, halo, stem);
      scene.add(group);
    });

    // Edge curves connecting linked papers, simulations, and prototypes
    edges.forEach((edge) => {
      const p1 = nodePosMap.get(edge.from);
      const p2 = nodePosMap.get(edge.to);
      if (!p1 || !p2) return;
      const lineGeom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const lineMat = new THREE.LineBasicMaterial({
        color: edge.relation === 'chronology' ? '#334155' : '#22d3ee',
        transparent: true,
        opacity: edge.relation === 'chronology' ? 0.45 : 0.75,
      });
      scene.add(new THREE.Line(lineGeom, lineMat));
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const onClick = (ev: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(interactiveMeshes, false);
      if (hits.length > 0) {
        const node = hits[0].object.userData.node as NarrativeNode;
        setSelected(node);
      }
    };
    renderer.domElement.addEventListener('click', onClick);

    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let disposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const st = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (st === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function requestRender() {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (disposed) return;
        renderDirty = false;
        controls.update();
        renderer.render(scene, camera);
        const done = () => {
          renderBusy = false;
          if (renderDirty && !disposed) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    controls.addEventListener('change', requestRender);
    window.addEventListener('resize', () => {
      const w = container.clientWidth || 720;
      const h = container.clientHeight || 420;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    });

    requestRender();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      renderer.domElement.removeEventListener('click', onClick);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [nodes, edges, selected?.id]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-8 relative rounded-xl border border-slate-800 bg-[#070b13] overflow-hidden h-[440px]">
        <div ref={mountRef} className="w-full h-full" />

        <div className="absolute top-3 left-3 bg-[#0A0E17]/95 border border-slate-800 rounded-lg px-3 py-1.5">
          <span className="text-xs font-semibold text-slate-100">
            3D Narrative Mode · Click Any Evidence Sphere to Inspect Links
          </span>
        </div>

        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center max-w-[94%]">
          <button
            type="button"
            onClick={() => setDockOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium bg-[#0A0E17]/95 border border-slate-800 rounded-t-lg text-slate-300"
          >
            {dockOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            <span>{dockOpen ? 'Hide Timeline Nodes' : 'Show Timeline Nodes'}</span>
          </button>
          {dockOpen && (
            <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-[#0A0E17]/95 border border-slate-800 rounded-lg max-h-[84px] overflow-y-auto">
              {nodes.slice(0, 8).map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setSelected(node)}
                  className={`px-2 py-1 text-[11px] rounded border truncate max-w-[140px] ${
                    selected?.id === node.id
                      ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                      : 'border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {node.title}
                </button>
              ))}
              <button
                type="button"
                onClick={reload}
                className="flex items-center gap-1 px-2 py-1 text-[11px] border border-slate-700 rounded text-slate-200"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right: Linked Story Node Details */}
      <div className="lg:col-span-4 rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">
          Linked Evidence & Chronology Node
        </h3>

        {!selected ? (
          <p className="text-xs text-slate-500">Select a node in the 3D research helix.</p>
        ) : (
          <div className="space-y-3 text-xs">
            <div className="font-mono text-[11px] text-cyan-300 uppercase">
              {selected.kind} · {selected.id}
            </div>
            <h4 className="text-sm font-semibold text-slate-100">{selected.title}</h4>
            <p className="text-slate-300">{selected.subtitle}</p>
            <div className="text-[11px] text-slate-400">
              Timestamp: {new Date(selected.timestamp).toLocaleString()}
            </div>
            {selected.license && (
              <div className="text-[11px] text-slate-300">License: {selected.license}</div>
            )}
            {selected.metrics && (
              <div className="rounded-lg border border-slate-800 bg-[#07090E] p-3 font-mono text-[11px] text-slate-300 space-y-1">
                {Object.entries(selected.metrics).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-slate-500">{k}</span>
                    <span>{String(v)}</span>
                  </div>
                ))}
              </div>
            )}
            {selected.sourceUrl && (
              <a
                href={selected.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
              >
                <span>Open Linked Source</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
