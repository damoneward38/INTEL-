import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import type {
  CandidateRecord,
  ExtractedEntity,
  PipelineJobRecord,
  PipelineStageState,
  StageStatus,
} from '../../services/pipelineApi';

interface Props {
  job: PipelineJobRecord | null;
  selectedStageId: string | null;
  onSelectStage: (stageId: string) => void;
}

const STATUS_HEX: Record<StageStatus, string> = {
  waiting: '#64748b',     // Gray
  processing: '#38bdf8',  // Blue
  completed: '#22c55e',   // Green
  needs_review: '#eab308',// Yellow
  failed: '#ef4444',      // Red
  optimization: '#a855f7',// Purple
  selected: '#f8fafc',    // White
};

function detectSoftwareWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl =
      (c.getContext('webgl2') as WebGL2RenderingContext | null) ||
      (c.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export default function Pipeline3DCanvas({
  job,
  selectedStageId,
  onSelectStage,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [autoOrbit, setAutoOrbit] = useState(false);

  const stages: PipelineStageState[] = job?.stages ?? [];
  const candidates: CandidateRecord[] = job?.candidates ?? [];
  const entities: ExtractedEntity[] = job?.entities ?? [];

  const activeStage =
    stages.find((s) => s.id === selectedStageId) ??
    stages.find((s) => s.status === 'processing' || s.status === 'optimization') ??
    stages.find((s) => s.status === 'selected') ??
    stages[0] ??
    null;

  const stateRef = useRef({
    stages,
    candidates,
    entities,
    selectedStageId,
    autoOrbit,
  });

  useEffect(() => {
    stateRef.current = {
      stages,
      candidates,
      entities,
      selectedStageId,
      autoOrbit,
    };
  }, [stages, candidates, entities, selectedStageId, autoOrbit]);

  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglFailed(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));

    const width = Math.max(360, container.clientWidth);
    const height = Math.max(360, container.clientHeight);
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#060911');
    scene.fog = new THREE.FogExp2('#060911', 0.022);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    scene.environment = pmrem.fromScene(roomEnv, 0.04).texture;
    roomEnv.dispose();
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 160);
    camera.position.set(0, 7.8, 17.5);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.target.set(0, 0.2, 0);
    controlsRef.current = controls;

    // Warm key + cool rim lighting rig
    const keyLight = new THREE.DirectionalLight('#fff1e0', 1.8);
    keyLight.position.set(10, 14, 12);
    scene.add(keyLight);
    scene.add(new THREE.HemisphereLight('#38bdf8', '#090d16', 0.85));

    const grid = new THREE.GridHelper(32, 32, '#1e293b', '#0f172a');
    grid.position.y = -2.6;
    scene.add(grid);

    // 30 Stage composite 3-part assemblies arranged along a 3x10 curved manifold
    const stageNodes: Array<{
      index: number;
      pos: THREE.Vector3;
      group: THREE.Group;
      coreMat: THREE.MeshStandardMaterial;
      haloMat: THREE.MeshStandardMaterial;
      beacon: THREE.Mesh;
    }> = [];
    const pickTargets: THREE.Mesh[] = [];

    const coreGeo = new THREE.CylinderGeometry(0.38, 0.44, 0.34, 8);
    const haloGeo = new THREE.TorusGeometry(0.56, 0.045, 10, 28);
    const beaconGeo = new THREE.OctahedronGeometry(0.22, 0);

    const spinePoints: THREE.Vector3[] = [];
    for (let i = 0; i < 30; i += 1) {
      const row = Math.floor(i / 10); // 0, 1, 2
      const colInRow = i % 10;
      const col = row % 2 === 1 ? 9 - colInRow : colInRow; // Serpentine flow
      const x = (col - 4.5) * 2.15;
      const z = (row - 1) * 3.4;
      const y = Math.sin(i * 0.35) * 0.35;
      const pos = new THREE.Vector3(x, y, z);
      spinePoints.push(pos);

      const group = new THREE.Group();
      group.position.copy(pos);

      const coreMat = new THREE.MeshStandardMaterial({
        color: '#334155',
        metalness: 0.78,
        roughness: 0.25,
      });
      const coreMesh = new THREE.Mesh(coreGeo, coreMat);
      coreMesh.userData = { stageIndex: i };
      pickTargets.push(coreMesh);
      group.add(coreMesh);

      const haloMat = new THREE.MeshStandardMaterial({
        color: STATUS_HEX.waiting,
        emissive: STATUS_HEX.waiting,
        emissiveIntensity: 0.35,
        metalness: 0.35,
        roughness: 0.48,
      });
      const haloMesh = new THREE.Mesh(haloGeo, haloMat);
      haloMesh.rotation.x = Math.PI / 2;
      group.add(haloMesh);

      const beacon = new THREE.Mesh(beaconGeo, haloMat);
      beacon.position.y = 0.46;
      beacon.userData = { stageIndex: i };
      pickTargets.push(beacon);
      group.add(beacon);

      scene.add(group);
      stageNodes.push({ index: i, pos, group, coreMat, haloMat, beacon });
    }

    // Connected serpentine pipeline conduit curve
    const spineCurve = new THREE.CatmullRomCurve3(spinePoints);
    const tubeGeo = new THREE.TubeGeometry(spineCurve, 180, 0.055, 8, false);
    const tubeMat = new THREE.MeshStandardMaterial({
      color: '#1e3a5f',
      metalness: 0.6,
      roughness: 0.3,
    });
    scene.add(new THREE.Mesh(tubeGeo, tubeMat));

    // Input Artifact Core (Left of stage 01)
    const inputHub = new THREE.Group();
    inputHub.position.set(-11.4, 0.4, -3.4);
    const inputCrystal = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.7, 0),
      new THREE.MeshStandardMaterial({
        color: '#22d3ee',
        emissive: '#0891b2',
        emissiveIntensity: 0.55,
        metalness: 0.4,
        roughness: 0.2,
      })
    );
    inputHub.add(inputCrystal);
    scene.add(inputHub);

    // Animated telemetry pulse traveling the pipeline spine
    const pulseMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 16),
      new THREE.MeshStandardMaterial({
        color: '#f8fafc',
        emissive: '#38bdf8',
        emissiveIntensity: 1.4,
      })
    );
    scene.add(pulseMesh);

    // Knowledge Graph elevated constellation group (rebuilt dynamically when entities update)
    const kgGroup = new THREE.Group();
    kgGroup.position.set(0, 3.2, -1.5);
    scene.add(kgGroup);
    const kgBallGeo = new THREE.SphereGeometry(0.2, 14, 14);
    let lastEntityCount = -1;

    // Candidate simulation arena spheres (Right of stage 30)
    const candidateGroup = new THREE.Group();
    candidateGroup.position.set(11.6, 0.4, 1.0);
    scene.add(candidateGroup);
    const candGeo = new THREE.SphereGeometry(0.36, 18, 18);
    let lastCandSignature = '';

    // Raycaster picking
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handlePointerClick = (ev: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickTargets, false);
      if (hits.length > 0) {
        const idx = hits[0].object.userData.stageIndex as number;
        const st = stateRef.current.stages[idx];
        if (st) onSelectStage(st.id);
      }
    };
    renderer.domElement.addEventListener('click', handlePointerClick);

    const resizeObs = new ResizeObserver(() => {
      if (!container) return;
      const w = Math.max(360, container.clientWidth);
      const h = Math.max(360, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObs.observe(container);

    let rafId = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const { stages: curStages, candidates: curCands, entities: curEntities, selectedStageId: selId, autoOrbit: orbitOn } =
        stateRef.current;

      controls.autoRotate = orbitOn;
      controls.autoRotateSpeed = 0.7;
      controls.update();

      inputCrystal.rotation.y = t * 0.8;
      inputCrystal.rotation.x = Math.sin(t * 0.5) * 0.2;

      let activeIdx = 0;
      stageNodes.forEach((node, idx) => {
        const st = curStages[idx];
        const status: StageStatus = st?.status ?? 'waiting';
        const hex = STATUS_HEX[status] ?? STATUS_HEX.waiting;
        node.haloMat.color.set(hex);
        node.haloMat.emissive.set(hex);

        const isActive = status === 'processing' || status === 'optimization';
        if (isActive) activeIdx = idx;

        const isSelectedNode = st?.id === selId || status === 'selected';
        node.haloMat.emissiveIntensity = isActive
          ? 0.9 + Math.sin(t * 6) * 0.35
          : isSelectedNode
            ? 0.95
            : status === 'waiting'
              ? 0.12
              : 0.42;

        node.beacon.rotation.y = t * (isActive ? 2.4 : 0.6) + idx * 0.2;
        const pulseScale = isActive ? 1.15 + Math.sin(t * 5) * 0.12 : isSelectedNode ? 1.12 : 1.0;
        node.group.scale.setScalar(pulseScale);
      });

      const doneFrac = curStages.length
        ? Math.max(
            0.02,
            Math.min(
              1,
              (curStages.filter((s) => s.status !== 'waiting').length || activeIdx + 1) / 30
            )
          )
        : (t * 0.08) % 1;
      const pulseU = (doneFrac * 0.85 + ((t * 0.15) % 0.15)) % 1;
      pulseMesh.position.copy(spineCurve.getPointAt(pulseU));

      // Update KG cluster if entity count changed
      if (curEntities.length !== lastEntityCount) {
        lastEntityCount = curEntities.length;
        kgGroup.clear();
        curEntities.slice(0, 12).forEach((ent, eIdx) => {
          const angle = (eIdx / Math.max(1, Math.min(12, curEntities.length))) * Math.PI * 2;
          const rad = 2.6 + (eIdx % 2) * 0.9;
          const m = new THREE.Mesh(
            kgBallGeo,
            new THREE.MeshStandardMaterial({
              color: ent.category === 'hazard' ? '#ef4444' : '#38bdf8',
              emissive: ent.category === 'hazard' ? '#991b1b' : '#0284c7',
              emissiveIntensity: 0.65,
            })
          );
          m.position.set(Math.cos(angle) * rad, Math.sin(eIdx) * 0.45, Math.sin(angle) * rad);
          kgGroup.add(m);
        });
      }
      kgGroup.rotation.y = t * 0.18;

      // Update Candidate Spheres when status changes
      const candSig = curCands.map((c) => `${c.candidateId}:${c.status}`).join('|');
      if (candSig !== lastCandSignature) {
        lastCandSignature = candSig;
        candidateGroup.clear();
        curCands.forEach((cand, cIdx) => {
          const col =
            cand.status === 'selected'
              ? '#f8fafc'
              : cand.status === 'rejected'
                ? '#ef4444'
                : cand.status === 'accepted'
                  ? '#22c55e'
                  : cand.status === 'running'
                    ? '#38bdf8'
                    : '#64748b';
          const m = new THREE.Mesh(
            candGeo,
            new THREE.MeshStandardMaterial({
              color: col,
              emissive: col,
              emissiveIntensity: cand.status === 'selected' ? 0.9 : 0.45,
              metalness: 0.4,
              roughness: 0.25,
            })
          );
          const colIdx = cIdx % 2;
          const rowIdx = Math.floor(cIdx / 2);
          m.position.set(colIdx * 1.15, (1 - rowIdx) * 1.15, 0);
          candidateGroup.add(m);
        });
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(rafId);
      resizeObs.disconnect();
      renderer.domElement.removeEventListener('click', handlePointerClick);
      coreGeo.dispose();
      haloGeo.dispose();
      beaconGeo.dispose();
      tubeGeo.dispose();
      tubeMat.dispose();
      kgBallGeo.dispose();
      candGeo.dispose();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [onSelectStage]);

  return (
    <div className="relative rounded-xl border border-slate-800 bg-[#060911] overflow-hidden min-h-[430px] flex flex-col">
      {webglFailed ? (
        <div className="p-5 space-y-3">
          <div className="text-xs text-amber-300 font-medium">
            WebGL unavailable — displaying live 30-stage telemetry matrix fallback.
          </div>
          <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
            {stages.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectStage(s.id)}
                className="p-2 rounded-lg border border-slate-700 bg-slate-900/80 text-left text-[11px]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-slate-400">#{s.number}</span>
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: STATUS_HEX[s.status] }}
                  />
                </div>
                <div className="text-slate-200 truncate mt-1">{s.name}</div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div ref={mountRef} className="w-full h-[430px] cursor-grab active:cursor-grabbing" />
      )}

      {/* Top Left Active Node Telemetry HUD */}
      <div className="absolute top-3 left-3 max-w-xs rounded-lg border border-slate-700/80 bg-slate-950/85 backdrop-blur px-3 py-2 text-[11px] pointer-events-auto">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-cyan-300">
            {activeStage
              ? `Stage ${String(activeStage.number).padStart(2, '0')} · ${activeStage.name}`
              : '3D 30-Stage Pipeline Ready'}
          </span>
          {activeStage && (
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase text-slate-950 font-semibold"
              style={{ backgroundColor: STATUS_HEX[activeStage.status] }}
            >
              {activeStage.status}
            </span>
          )}
        </div>
        {activeStage && (
          <div className="mt-1.5 grid grid-cols-3 gap-x-2 gap-y-0.5 text-slate-300 font-mono-tabular">
            <span>Prog: {activeStage.progress}%</span>
            <span>In: {activeStage.inputCount}</span>
            <span>Out: {activeStage.outputCount}</span>
            <span>Dur: {activeStage.durationMs}ms</span>
            <span>Err: {activeStage.errorCount}</span>
            <span>Phase: {activeStage.phase}</span>
          </div>
        )}
      </div>

      {/* Top Right Controls & Color Legend */}
      <div className="absolute top-3 right-3 flex flex-col items-end gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="safe-ui-test"
            onClick={() => setAutoOrbit((v) => !v)}
            className={`px-2.5 py-1 text-[11px] rounded-md border ${
              autoOrbit
                ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-200'
                : 'bg-slate-950/85 border-slate-700 text-slate-300'
            }`}
          >
            {autoOrbit ? 'Orbit On' : 'Orbit Off'}
          </button>
          <button
            type="button"
            data-testid="safe-ui-test"
            onClick={() => {
              cameraRef.current?.position.set(0, 7.8, 17.5);
              controlsRef.current?.target.set(0, 0.2, 0);
              controlsRef.current?.update();
            }}
            className="p-1.5 rounded-md border border-slate-700 bg-slate-950/85 text-slate-300 hover:text-white"
            title="Reset Camera"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            data-testid="safe-ui-test"
            onClick={() => setLegendCollapsed((v) => !v)}
            className="p-1.5 rounded-md border border-slate-700 bg-slate-950/85 text-slate-300 hover:text-white"
            title="Toggle Legend"
          >
            {legendCollapsed ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {!legendCollapsed && (
          <div className="rounded-lg border border-slate-800 bg-slate-950/85 backdrop-blur px-2.5 py-2 text-[10px] grid grid-cols-2 gap-x-3 gap-y-1 text-slate-300">
            {[
              ['Waiting', STATUS_HEX.waiting],
              ['Processing', STATUS_HEX.processing],
              ['Completed', STATUS_HEX.completed],
              ['Needs review', STATUS_HEX.needs_review],
              ['Failed', STATUS_HEX.failed],
              ['Optimization', STATUS_HEX.optimization],
              ['Selected result', STATUS_HEX.selected],
            ].map(([label, hex]) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: hex }} />
                <span>{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
