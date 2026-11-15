import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ChevronDown, ChevronUp, RotateCcw, Layers } from 'lucide-react';
import type { SimulationParameters } from '../types';

interface Props {
  active: boolean;
  simulationProgress: number;
  simulationState: string;
  parameters: SimulationParameters;
  particles: Array<[number, number, number]>;
}

const MAX_ATOMS = 48;
const DEFAULT_CAMERA_POS = new THREE.Vector3(0, 1.4, 7.6);
const DEFAULT_TARGET = new THREE.Vector3(0, 0, 0);

// Pre-allocated math helpers outside render loop (zero GC)
const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _color = new THREE.Color();
const _pointer = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();

const TELEMETRY_NODE_LABELS = [
  'N1 · Lattice Stabilizer',
  'N2 · Verlet Integrator',
  'N3 · Vector Index Link',
  'N4 · Virial Pressure Probe',
  'N5 · Thermal Bath Coupling',
  'N6 · Provenance Anchor',
];

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ||
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
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

export default function HologramCanvas({
  active,
  simulationProgress,
  simulationState,
  parameters,
  particles,
}: Props) {
  const { t } = useTranslation();
  const mountRef = useRef<HTMLDivElement | null>(null);

  const [webglFailed, setWebglFailed] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [layers, setLayers] = useState({
    core: true,
    particles: true,
    cluster: true,
    grid: true,
  });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Store reactive props in refs so WebGL scene never tears down on state changes
  const stateRef = useRef({
    active,
    simulationProgress,
    parameters,
    particles,
    autoRotate,
    layers,
  });

  useEffect(() => {
    stateRef.current = {
      active,
      simulationProgress,
      parameters,
      particles,
      autoRotate,
      layers,
    };
  }, [active, simulationProgress, parameters, particles, autoRotate, layers]);

  const cameraControlsRef = useRef<{
    reset: () => void;
  } | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    const isSoftwareGl = detectSoftwareWebGL();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        alpha: false,
      });
    } catch {
      setWebglFailed(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    renderer.setClearColor(0x07090e, 1);

    const width = Math.max(320, container.clientWidth);
    const height = Math.max(320, container.clientHeight);
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07090e);
    scene.fog = new THREE.FogExp2(0x07090e, 0.032);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 120);
    camera.position.copy(DEFAULT_CAMERA_POS);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 3.5;
    controls.maxDistance = 16;
    controls.target.copy(DEFAULT_TARGET);

    let resettingCamera = false;
    controls.addEventListener('start', () => {
      resettingCamera = false;
    });

    cameraControlsRef.current = {
      reset: () => {
        resettingCamera = true;
      },
    };

    // 3-Point Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x090d16, 0.75);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xf8fafc, 1.35);
    keyLight.position.set(5, 7, 6);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(0x06b6d4, 2.2, 24);
    rimLight.position.set(-4.5, -2.5, -4);
    scene.add(rimLight);

    // 1. Composite Multi-Part Spatial Core Group
    const coreGroup = new THREE.Group();
    scene.add(coreGroup);

    const knotGeo = new THREE.TorusKnotGeometry(1.45, 0.035, 160, 14, 2, 3);
    const knotMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x0891b2,
      emissiveIntensity: 0.9,
      metalness: 0.75,
      roughness: 0.25,
      wireframe: true,
    });
    const knotMesh = new THREE.Mesh(knotGeo, knotMat);
    coreGroup.add(knotMesh);

    const outerGimbalGeo = new THREE.TorusGeometry(2.35, 0.025, 16, 96);
    const gimbalMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.9,
      roughness: 0.2,
    });
    const outerGimbal = new THREE.Mesh(outerGimbalGeo, gimbalMat);
    outerGimbal.rotation.x = Math.PI / 3;
    coreGroup.add(outerGimbal);

    const innerGimbalGeo = new THREE.TorusGeometry(1.95, 0.02, 16, 80);
    const innerGimbalMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      metalness: 0.85,
      roughness: 0.25,
    });
    const innerGimbal = new THREE.Mesh(innerGimbalGeo, innerGimbalMat);
    innerGimbal.rotation.y = Math.PI / 4;
    coreGroup.add(innerGimbal);

    const crystalGeo = new THREE.IcosahedronGeometry(0.62, 1);
    const crystalMat = new THREE.MeshPhysicalMaterial({
      color: 0x06b6d4,
      metalness: 0.1,
      roughness: 0.15,
      transparent: true,
      opacity: 0.35,
      wireframe: false,
      clearcoat: 1.0,
    });
    const crystalMesh = new THREE.Mesh(crystalGeo, crystalMat);
    coreGroup.add(crystalMesh);

    // 6 Clickable Orbital Telemetry Node Assemblies (composite sphere + collar)
    const clickableNodes: THREE.Object3D[] = [];
    const nodeGeo = new THREE.SphereGeometry(0.085, 18, 18);
    const collarGeo = new THREE.TorusGeometry(0.13, 0.015, 10, 24);
    const nodeMeshes: THREE.Mesh[] = [];

    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const nodeGroup = new THREE.Group();
      nodeGroup.position.set(
        Math.cos(angle) * 2.35,
        Math.sin(angle) * 2.35 * Math.cos(Math.PI / 3),
        Math.sin(angle) * 2.35 * Math.sin(Math.PI / 3)
      );

      const nMat = new THREE.MeshStandardMaterial({
        color: 0x22d3ee,
        emissive: 0x06b6d4,
        emissiveIntensity: 1.1,
        metalness: 0.4,
        roughness: 0.2,
      });
      const nMesh = new THREE.Mesh(nodeGeo, nMat);
      nMesh.userData.label = TELEMETRY_NODE_LABELS[i];
      nMesh.layers.enable(1);
      nodeMeshes.push(nMesh);
      clickableNodes.push(nMesh);

      const collarMesh = new THREE.Mesh(collarGeo, gimbalMat);
      collarMesh.lookAt(0, 0, 0);

      nodeGroup.add(nMesh, collarMesh);
      coreGroup.add(nodeGroup);
    }

    // 2. Spatial Particle Field
    const particleCount = 750;
    const particlePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const r = 3.4 + Math.random() * 6.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      particlePositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      particlePositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      particlePositions[i * 3 + 2] = r * Math.cos(phi);
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(particlePositions, 3)
    );
    const particleMat = new THREE.PointsMaterial({
      color: 0x38bdf8,
      size: 0.04,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true,
    });
    const particlePoints = new THREE.Points(particleGeo, particleMat);
    scene.add(particlePoints);

    // 3. Molecular Dynamics Atom Cluster (InstancedMesh + Containment Sphere)
    const clusterGroup = new THREE.Group();
    scene.add(clusterGroup);

    const containmentGeo = new THREE.SphereGeometry(1.15, 24, 24);
    const containmentMat = new THREE.MeshBasicMaterial({
      color: 0x0ea5e9,
      wireframe: true,
      transparent: true,
      opacity: 0.14,
    });
    const containmentSphere = new THREE.Mesh(containmentGeo, containmentMat);
    clusterGroup.add(containmentSphere);

    const atomGeo = new THREE.SphereGeometry(0.09, 16, 16);
    const atomMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.2,
      metalness: 0.35,
    });
    const mdInstanced = new THREE.InstancedMesh(atomGeo, atomMat, MAX_ATOMS);
    mdInstanced.frustumCulled = false;

    // Default equilibrium lattice preview
    const defaultOffsets: Array<[number, number, number]> = [];
    for (let i = 0; i < MAX_ATOMS; i++) {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / MAX_ATOMS);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const rad = 0.45 + (i % 3) * 0.22;
      defaultOffsets.push([
        rad * Math.sin(phi) * Math.cos(theta),
        rad * Math.sin(phi) * Math.sin(theta),
        rad * Math.cos(phi),
      ]);
    }
    clusterGroup.add(mdInstanced);

    // 4. Calibrated Reference Polar Grid
    const polarGrid = new THREE.PolarGridHelper(4.8, 12, 6, 64, 0x1e293b, 0x0f172a);
    polarGrid.position.y = -3.05;
    scene.add(polarGrid);

    // Pointer Interaction / Raycasting
    _raycaster.layers.set(1);
    let lastHoverCheck = 0;

    function updatePointer(clientX: number, clientY: number) {
      const rect = renderer.domElement.getBoundingClientRect();
      _pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    }

    function onPointerMove(e: PointerEvent) {
      const now = performance.now();
      if (now - lastHoverCheck < 50) return;
      lastHoverCheck = now;
      updatePointer(e.clientX, e.clientY);
      _raycaster.setFromCamera(_pointer, camera);
      const hits = _raycaster.intersectObjects(clickableNodes, false);
      renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'grab';
    }

    function onClick(e: MouseEvent) {
      updatePointer(e.clientX, e.clientY);
      _raycaster.setFromCamera(_pointer, camera);
      const hits = _raycaster.intersectObjects(clickableNodes, false);
      if (hits.length > 0) {
        const label = hits[0].object.userData.label as string | undefined;
        setSelectedNode(label ?? null);
      } else {
        setSelectedNode(null);
      }
    }

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('click', onClick);

    function onContextLost(e: Event) {
      e.preventDefault();
      setContextLost(true);
    }
    function onContextRestored() {
      setContextLost(false);
    }
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(320, entry.contentRect.width);
        const h = Math.max(320, entry.contentRect.height);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    resizeObserver.observe(container);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    let frameId = 0;
    let disposed = false;
    const clock = new THREE.Clock();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (status === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsed = clock.getElapsedTime();
      const current = stateRef.current;

      // Visibility toggles
      coreGroup.visible = current.layers.core;
      particlePoints.visible = current.layers.particles;
      clusterGroup.visible = current.layers.cluster;
      polarGrid.visible = current.layers.grid;

      // Smooth camera reset damping
      if (resettingCamera) {
        const alpha = 1 - Math.exp(-6 * delta);
        camera.position.lerp(DEFAULT_CAMERA_POS, alpha);
        controls.target.lerp(DEFAULT_TARGET, alpha);
        if (
          camera.position.distanceTo(DEFAULT_CAMERA_POS) < 0.02 &&
          controls.target.distanceTo(DEFAULT_TARGET) < 0.02
        ) {
          camera.position.copy(DEFAULT_CAMERA_POS);
          controls.target.copy(DEFAULT_TARGET);
          resettingCamera = false;
        }
      }

      if (!prefersReducedMotion) {
        const spinMult = current.autoRotate ? (current.active ? 2.4 : 1.0) : 0.0;
        knotMesh.rotation.y += delta * 0.28 * spinMult;
        knotMesh.rotation.x += delta * 0.11 * spinMult;
        outerGimbal.rotation.z += delta * 0.18 * spinMult;
        innerGimbal.rotation.x -= delta * 0.22 * spinMult;
        particlePoints.rotation.y += delta * 0.04 * (current.active ? 2.2 : 1.0);
        crystalMesh.rotation.y -= delta * 0.35 * (current.active ? 2.0 : 1.0);
      }

      knotMat.emissiveIntensity = current.active ? 2.1 : 0.9;

      // Update MD InstancedMesh atom coordinates & thermal color scale
      const liveParticles = current.particles;
      const activeCount = liveParticles.length > 0 ? Math.min(liveParticles.length, MAX_ATOMS) : 28;
      mdInstanced.count = activeCount;

      const tempNorm = THREE.MathUtils.clamp(
        (current.parameters.temperature - 100) / 1100,
        0,
        1
      );
      // Calibrated Cyan (#06b6d4) -> Amber (#f59e0b) thermal hue mapping
      _color.setHSL(0.53 - tempNorm * 0.42, 0.85, 0.56);

      const jitterAmp = prefersReducedMotion
        ? 0
        : (current.active ? 0.04 : 0.012) * (0.5 + tempNorm);

      for (let i = 0; i < activeCount; i++) {
        if (liveParticles.length > 0) {
          const [px, py, pz] = liveParticles[i];
          _pos.set(
            px * 0.52 + Math.sin(elapsed * 4 + i) * jitterAmp,
            py * 0.52 + Math.cos(elapsed * 3.7 + i) * jitterAmp,
            pz * 0.52 + Math.sin(elapsed * 3.1 + i * 2) * jitterAmp
          );
        } else {
          const [ox, oy, oz] = defaultOffsets[i];
          _pos.set(
            ox + Math.sin(elapsed * 2 + i) * jitterAmp,
            oy + Math.cos(elapsed * 2.2 + i) * jitterAmp,
            oz
          );
        }
        _mat4.compose(_pos, _quat, _scale);
        mdInstanced.setMatrixAt(i, _mat4);
        mdInstanced.setColorAt(i, _color);
      }
      mdInstanced.instanceMatrix.needsUpdate = true;
      if (mdInstanced.instanceColor) mdInstanced.instanceColor.needsUpdate = true;

      const containmentScale =
        1 + (current.simulationProgress / 100) * 0.14 - Math.min(0.18, current.parameters.pressure * 0.002);
      containmentSphere.scale.setScalar(Math.max(0.75, containmentScale));

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);

      controls.dispose();
      knotGeo.dispose();
      knotMat.dispose();
      outerGimbalGeo.dispose();
      innerGimbalGeo.dispose();
      gimbalMat.dispose();
      innerGimbalMat.dispose();
      crystalGeo.dispose();
      crystalMat.dispose();
      nodeGeo.dispose();
      collarGeo.dispose();
      nodeMeshes.forEach((m) => (m.material as THREE.Material).dispose());
      particleGeo.dispose();
      particleMat.dispose();
      containmentGeo.dispose();
      containmentMat.dispose();
      atomGeo.dispose();
      atomMat.dispose();
      polarGrid.dispose();
      envTarget.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="relative h-[460px] lg:h-[540px] w-full rounded-xl border border-slate-800 bg-[#07090E] overflow-hidden">
      {/* Top Semantic Viewport Label (no backdrop-blur over WebGL) */}
      <div className="pointer-events-none absolute top-3.5 inset-x-4 z-10 flex items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-2.5 bg-[#0B101B]/90 border border-slate-800 px-3 py-1.5 rounded-md">
          <span className="font-medium text-slate-200">{t('viewport.title')}</span>
          <span className="text-slate-500" aria-hidden="true">·</span>
          <span className="font-mono-tabular text-cyan-400">
            {t(`simulation.states.${simulationState}`)}
          </span>
        </div>

        {selectedNode && (
          <div className="bg-[#0B101B]/95 border border-cyan-500/40 px-3 py-1.5 rounded-md text-cyan-300 font-mono-tabular">
            {t('viewport.selectedNode')}: {selectedNode}
          </div>
        )}
      </div>

      {/* Isolated WebGL Mount Container */}
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Graceful WebGL Fallback */}
      {(webglFailed || contextLost) && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#07090E] p-6 text-center">
          <svg
            viewBox="0 0 240 160"
            className="w-56 h-36 text-cyan-500/70 mb-4"
            fill="none"
            stroke="currentColor"
          >
            <circle cx="120" cy="80" r="56" strokeWidth="1.2" strokeDasharray="4 4" />
            <circle cx="120" cy="80" r="32" strokeWidth="1.5" />
            <ellipse cx="120" cy="80" rx="74" ry="22" strokeWidth="1" />
            <circle cx="120" cy="80" r="4" fill="currentColor" />
          </svg>
          <p className="max-w-md text-sm text-slate-300">{t('viewport.webglFallback')}</p>
        </div>
      )}

      {/* Collapsible Bottom Control Dock (solid/translucent non-blur surface) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center max-w-[94%]">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-medium text-slate-300 bg-[#0B101B]/95 border border-slate-800 rounded-t-md hover:text-cyan-300 transition-colors whitespace-nowrap"
        >
          {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {dockCollapsed ? t('viewport.showControls') : t('viewport.hideControls')}
        </button>

        {!dockCollapsed && (
          <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-2 bg-[#0B101B]/95 border border-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => cameraControlsRef.current?.reset()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-md whitespace-nowrap transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
              {t('viewport.resetCamera')}
            </button>

            <button
              type="button"
              onClick={() => setAutoRotate((v) => !v)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap transition-colors ${
                autoRotate
                  ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/50'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
            >
              {t('viewport.autoRotate')}
            </button>

            <span className="hidden sm:inline text-slate-700">|</span>

            <div className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              {(
                [
                  ['core', t('viewport.coreLabel')],
                  ['particles', t('viewport.particlesLabel')],
                  ['cluster', t('viewport.clusterLabel')],
                  ['grid', t('viewport.gridLabel')],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    setLayers((prev) => ({ ...prev, [key]: !prev[key] }))
                  }
                  className={`px-2 py-1 text-xs rounded border whitespace-nowrap transition-colors ${
                    layers[key]
                      ? 'bg-slate-800 text-slate-100 border-slate-600'
                      : 'bg-transparent text-slate-500 border-slate-800 hover:text-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
