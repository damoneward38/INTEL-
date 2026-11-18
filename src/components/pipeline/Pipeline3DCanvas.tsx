import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Bot, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import type {
  CandidateRecord,
  ExtractedEntity,
  PipelineJobRecord,
  PipelineStageState,
  RoboticsReportRecord,
  StageStatus,
} from '../../services/pipelineApi';

interface Props {
  job: PipelineJobRecord | null;
  selectedStageId: string | null;
  onSelectStage: (stageId: string) => void;
}

const STATUS_HEX: Record<StageStatus, string> = {
  waiting: '#64748b',
  processing: '#38bdf8',
  completed: '#22c55e',
  needs_review: '#eab308',
  failed: '#ef4444',
  optimization: '#a855f7',
  selected: '#f8fafc',
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

function disposeGroupChildren(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    child.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    });
  }
}

const _twinPos = new THREE.Vector3();
const _twinNext = new THREE.Vector3();

export default function Pipeline3DCanvas({
  job,
  selectedStageId,
  onSelectStage,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [focusTwin, setFocusTwin] = useState(false);

  const stages: PipelineStageState[] = job?.stages ?? [];
  const candidates: CandidateRecord[] = job?.candidates ?? [];
  const entities: ExtractedEntity[] = job?.entities ?? [];
  const simStage = stages.find((s) => s.id === 'virtual-simulation');
  const roboticsReport =
    (simStage?.data?.roboticsReport as RoboticsReportRecord | undefined) ?? null;

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
    roboticsReport,
  });

  useEffect(() => {
    stateRef.current = {
      stages,
      candidates,
      entities,
      selectedStageId,
      autoOrbit,
      roboticsReport,
    };
  }, [stages, candidates, entities, selectedStageId, autoOrbit, roboticsReport]);

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
    scene.fog = new THREE.FogExp2('#060911', 0.02);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    scene.environment = pmrem.fromScene(roomEnv, 0.04).texture;
    roomEnv.dispose();
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 160);
    camera.position.set(0, 8.2, 18.5);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.target.set(0, 0.2, 0.5);
    controlsRef.current = controls;

    const keyLight = new THREE.DirectionalLight('#fff1e0', 1.8);
    keyLight.position.set(10, 14, 12);
    scene.add(keyLight);
    scene.add(new THREE.HemisphereLight('#38bdf8', '#090d16', 0.85));

    const grid = new THREE.GridHelper(36, 36, '#1e293b', '#0f172a');
    grid.position.y = -2.6;
    scene.add(grid);

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
      const row = Math.floor(i / 10);
      const colInRow = i % 10;
      const col = row % 2 === 1 ? 9 - colInRow : colInRow;
      const x = (col - 4.5) * 2.15;
      const z = (row - 1) * 3.4 - 1.2;
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

    const spineCurve = new THREE.CatmullRomCurve3(spinePoints);
    const tubeGeo = new THREE.TubeGeometry(spineCurve, 180, 0.055, 8, false);
    const tubeMat = new THREE.MeshStandardMaterial({
      color: '#1e3a5f',
      metalness: 0.6,
      roughness: 0.3,
    });
    scene.add(new THREE.Mesh(tubeGeo, tubeMat));

    const inputHub = new THREE.Group();
    inputHub.position.set(-11.4, 0.4, -4.6);
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

    const pulseMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 16),
      new THREE.MeshStandardMaterial({
        color: '#f8fafc',
        emissive: '#38bdf8',
        emissiveIntensity: 1.4,
      })
    );
    scene.add(pulseMesh);

    const kgGroup = new THREE.Group();
    kgGroup.position.set(0, 3.2, -2.5);
    scene.add(kgGroup);
    const kgBallGeo = new THREE.SphereGeometry(0.2, 14, 14);
    let lastEntityCount = -1;

    const candidateGroup = new THREE.Group();
    candidateGroup.position.set(11.6, 0.4, 0.2);
    scene.add(candidateGroup);
    const candGeo = new THREE.SphereGeometry(0.36, 18, 18);
    let lastCandSignature = '';

    // 3D Robotics Twin Bay seated forward of Stage 21-30 row
    const roboticsGroup = new THREE.Group();
    roboticsGroup.position.set(0, -2.55, 7.6);
    scene.add(roboticsGroup);
    let lastRoboticsSignature = '';

    let twinCurve: THREE.CatmullRomCurve3 | null = null;
    let twinActor: THREE.Group | null = null;
    let twinArmShoulder: THREE.Group | null = null;
    let twinArmElbow: THREE.Group | null = null;
    let twinArmFrames: Array<{ joint_angles_deg: [number, number] }> = [];
    let twinRotors: THREE.Mesh[] = [];
    let twinRobotType = '';

    const rebuildRoboticsTwin = (rep: RoboticsReportRecord | null) => {
      disposeGroupChildren(roboticsGroup);
      twinCurve = null;
      twinActor = null;
      twinArmShoulder = null;
      twinArmElbow = null;
      twinArmFrames = [];
      twinRotors = [];
      twinRobotType = '';

      if (!rep) return;
      twinRobotType = rep.robot.robot_type;

      // Grounded calibration plinth (bottom-center aligned onto grid y=-2.55)
      const plinth = new THREE.Mesh(
        new THREE.CylinderGeometry(4.4, 4.6, 0.14, 40),
        new THREE.MeshStandardMaterial({ color: '#0f172a', metalness: 0.65, roughness: 0.45 })
      );
      plinth.position.y = 0.07;
      roboticsGroup.add(plinth);

      const trimRing = new THREE.Mesh(
        new THREE.TorusGeometry(4.42, 0.04, 8, 48),
        new THREE.MeshStandardMaterial({
          color: '#06b6d4',
          emissive: '#0891b2',
          emissiveIntensity: 0.45,
          metalness: 0.3,
          roughness: 0.4,
        })
      );
      trimRing.rotation.x = Math.PI / 2;
      trimRing.position.y = 0.14;
      roboticsGroup.add(trimRing);

      if (rep.robot.robot_type === 'two_link_arm') {
        const l1 = Math.max(0.3, rep.robot.arm_link_1_m || 0.5) * 3.0;
        const l2 = Math.max(0.3, rep.robot.arm_link_2_m || 0.4) * 3.0;

        // 6-part articulated robotic arm assembly
        const pedestal = new THREE.Mesh(
          new THREE.CylinderGeometry(0.45, 0.58, 0.45, 24),
          new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.8, roughness: 0.25 })
        );
        pedestal.position.y = 0.36;
        roboticsGroup.add(pedestal);

        const shoulderGroup = new THREE.Group();
        shoulderGroup.position.set(0, 0.62, 0);
        roboticsGroup.add(shoulderGroup);
        twinArmShoulder = shoulderGroup;

        const shoulderDrum = new THREE.Mesh(
          new THREE.CylinderGeometry(0.24, 0.24, 0.32, 20),
          new THREE.MeshStandardMaterial({ color: '#0284c7', metalness: 0.55, roughness: 0.35 })
        );
        shoulderDrum.rotation.z = Math.PI / 2;
        shoulderGroup.add(shoulderDrum);

        const link1Mesh = new THREE.Mesh(
          new THREE.BoxGeometry(l1, 0.16, 0.16),
          new THREE.MeshStandardMaterial({ color: '#38bdf8', metalness: 0.45, roughness: 0.3 })
        );
        link1Mesh.position.set(l1 / 2, 0, 0);
        shoulderGroup.add(link1Mesh);

        const elbowGroup = new THREE.Group();
        elbowGroup.position.set(l1, 0, 0);
        shoulderGroup.add(elbowGroup);
        twinArmElbow = elbowGroup;

        const elbowCap = new THREE.Mesh(
          new THREE.CylinderGeometry(0.18, 0.18, 0.28, 18),
          new THREE.MeshStandardMaterial({ color: '#a855f7', metalness: 0.65, roughness: 0.28 })
        );
        elbowCap.rotation.z = Math.PI / 2;
        elbowGroup.add(elbowCap);

        const link2Mesh = new THREE.Mesh(
          new THREE.BoxGeometry(l2, 0.13, 0.13),
          new THREE.MeshStandardMaterial({ color: '#c084fc', metalness: 0.45, roughness: 0.32 })
        );
        link2Mesh.position.set(l2 / 2, 0, 0);
        elbowGroup.add(link2Mesh);

        const probe = new THREE.Mesh(
          new THREE.ConeGeometry(0.12, 0.26, 16),
          new THREE.MeshStandardMaterial({
            color: '#10b981',
            emissive: '#059669',
            emissiveIntensity: 0.5,
            metalness: 0.3,
            roughness: 0.4,
          })
        );
        probe.position.set(l2, 0, 0);
        probe.rotation.z = -Math.PI / 2;
        elbowGroup.add(probe);

        const firstTrial = (rep.trials[0] ?? {}) as {
          trajectory?: Array<{ joint_angles_deg: [number, number] }>;
          joint_angles_deg?: [number, number] | null;
        };
        if (Array.isArray(firstTrial.trajectory) && firstTrial.trajectory.length > 0) {
          twinArmFrames = firstTrial.trajectory.filter((f) => Array.isArray(f.joint_angles_deg));
        } else if (Array.isArray(firstTrial.joint_angles_deg)) {
          twinArmFrames = [{ joint_angles_deg: firstTrial.joint_angles_deg }];
        }
        return;
      }

      // Differential drive OR 3D Quadrotor arena mapping onto plinth [-3.1..3.1]
      const firstTrial = (rep.trials[0] ?? {}) as {
        trajectory?: number[][];
        collision_events?: number;
      };
      const rawTraj =
        Array.isArray(firstTrial.trajectory) && firstTrial.trajectory.length >= 2
          ? firstTrial.trajectory
          : [
              (rep.environment.start as number[]) ?? [0, 0],
              (rep.environment.goal as number[]) ?? [4, 4],
            ];
      const obstacles = rep.environment.obstacles ?? [];
      const margin = rep.simulation.obstacle_margin_m ?? 0.15;

      let minX = 0;
      let maxX = 4;
      let minY = 0;
      let maxY = 4;
      rawTraj.forEach((pt) => {
        minX = Math.min(minX, Number(pt[0]));
        maxX = Math.max(maxX, Number(pt[0]));
        minY = Math.min(minY, Number(pt[1]));
        maxY = Math.max(maxY, Number(pt[1]));
      });
      obstacles.forEach((o) => {
        minX = Math.min(minX, o.center[0] - o.radius);
        maxX = Math.max(maxX, o.center[0] + o.radius);
        minY = Math.min(minY, o.center[1] - o.radius);
        maxY = Math.max(maxY, o.center[1] + o.radius);
      });

      const cxWorld = (minX + maxX) / 2;
      const cyWorld = (minY + maxY) / 2;
      const arenaSpan = Math.max(3.2, maxX - minX, maxY - minY);
      const scale3d = 5.6 / arenaSpan;

      const to3d = (pt: number[]) =>
        new THREE.Vector3(
          (Number(pt[0]) - cxWorld) * scale3d,
          0.26 + (Number(pt[2] ?? 0)) * scale3d * 0.72,
          -(Number(pt[1]) - cyWorld) * scale3d
        );

      // Obstacles (Core tower + safety margin halo)
      obstacles.forEach((obs) => {
        const obsH = (obs.height_m ?? (rep.robot.robot_type === 'quadrotor_3d' ? 2.4 : 0.75)) * scale3d * 0.72;
        const obsMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(obs.radius * scale3d, obs.radius * scale3d, Math.max(0.45, obsH), 20),
          new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.45, metalness: 0.2 })
        );
        obsMesh.position.set(
          (obs.center[0] - cxWorld) * scale3d,
          0.14 + Math.max(0.45, obsH) / 2,
          -(obs.center[1] - cyWorld) * scale3d
        );
        roboticsGroup.add(obsMesh);

        const safeMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(
            (obs.radius + margin) * scale3d,
            (obs.radius + margin) * scale3d,
            0.16,
            24
          ),
          new THREE.MeshStandardMaterial({
            color: '#f59e0b',
            transparent: true,
            opacity: 0.25,
            roughness: 0.7,
          })
        );
        safeMesh.position.set(obsMesh.position.x, 0.22, obsMesh.position.z);
        roboticsGroup.add(safeMesh);
      });

      const curvePts = rawTraj.map(to3d);
      twinCurve = new THREE.CatmullRomCurve3(curvePts);
      const pathTube = new THREE.Mesh(
        new THREE.TubeGeometry(twinCurve, Math.max(24, curvePts.length * 4), 0.045, 8, false),
        new THREE.MeshStandardMaterial({
          color: firstTrial.collision_events ? '#f43f5e' : '#22d3ee',
          emissive: firstTrial.collision_events ? '#be123c' : '#0284c7',
          emissiveIntensity: 0.45,
          roughness: 0.35,
        })
      );
      roboticsGroup.add(pathTube);

      // Goal beacon ring
      const goalVec = to3d((rep.environment.goal as number[]) ?? rawTraj[rawTraj.length - 1]);
      const goalRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.26, 0.04, 10, 24),
        new THREE.MeshStandardMaterial({
          color: '#10b981',
          emissive: '#059669',
          emissiveIntensity: 0.65,
        })
      );
      goalRing.rotation.x = Math.PI / 2;
      goalRing.position.set(goalVec.x, 0.2, goalVec.z);
      roboticsGroup.add(goalRing);

      // Composite robot actor
      const actor = new THREE.Group();
      twinActor = actor;
      if (rep.robot.robot_type === 'quadrotor_3d') {
        const body = new THREE.Mesh(
          new THREE.SphereGeometry(0.18, 16, 12),
          new THREE.MeshStandardMaterial({ color: '#e2e8f0', metalness: 0.65, roughness: 0.25 })
        );
        body.scale.set(1.2, 0.6, 1.2);
        actor.add(body);

        const armMat = new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.8, roughness: 0.3 });
        const armA = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.04, 0.05), armMat);
        armA.rotation.y = Math.PI / 4;
        actor.add(armA);
        const armB = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.04, 0.05), armMat);
        armB.rotation.y = -Math.PI / 4;
        actor.add(armB);

        const rotorGeo = new THREE.TorusGeometry(0.14, 0.018, 6, 18);
        const rotorMat = new THREE.MeshStandardMaterial({
          color: '#38bdf8',
          emissive: '#0284c7',
          emissiveIntensity: 0.55,
        });
        [
          [0.25, 0.06, 0.25],
          [-0.25, 0.06, 0.25],
          [0.25, 0.06, -0.25],
          [-0.25, 0.06, -0.25],
        ].forEach(([rx, ry, rz]) => {
          const rotor = new THREE.Mesh(rotorGeo, rotorMat);
          rotor.rotation.x = Math.PI / 2;
          rotor.position.set(rx, ry, rz);
          twinRotors.push(rotor);
          actor.add(rotor);
        });
      } else {
        // 5-part Differential-drive rover
        const chassis = new THREE.Mesh(
          new THREE.BoxGeometry(0.42, 0.14, 0.3),
          new THREE.MeshStandardMaterial({ color: '#0284c7', metalness: 0.45, roughness: 0.32 })
        );
        chassis.position.y = 0.09;
        actor.add(chassis);

        const wheelGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 16);
        const wheelMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.78, metalness: 0.15 });
        [
          [-0.12, 0.08, 0.17],
          [0.12, 0.08, 0.17],
          [-0.12, 0.08, -0.17],
          [0.12, 0.08, -0.17],
        ].forEach(([wx, wy, wz]) => {
          const w = new THREE.Mesh(wheelGeo, wheelMat);
          w.rotation.x = Math.PI / 2;
          w.position.set(wx, wy, wz);
          actor.add(w);
        });

        const lidar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.08, 0.08, 16),
          new THREE.MeshStandardMaterial({
            color: '#f8fafc',
            emissive: '#38bdf8',
            emissiveIntensity: 0.65,
            metalness: 0.75,
            roughness: 0.2,
          })
        );
        lidar.position.set(0.06, 0.2, 0);
        actor.add(lidar);
      }
      roboticsGroup.add(actor);
    };

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
      const {
        stages: curStages,
        candidates: curCands,
        entities: curEntities,
        selectedStageId: selId,
        autoOrbit: orbitOn,
        roboticsReport: curRob,
      } = stateRef.current;

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

      const robSig = curRob ? `${curRob.job_id}:${curRob.sha256}` : '';
      if (robSig !== lastRoboticsSignature) {
        lastRoboticsSignature = robSig;
        rebuildRoboticsTwin(curRob);
      }

      // Animate robotics twin playback continuously without GC allocations
      if (twinRobotType === 'two_link_arm' && twinArmShoulder && twinArmElbow && twinArmFrames.length > 0) {
        const frameIdx = Math.floor((t * 2.2) % twinArmFrames.length);
        const [a1, a2] = twinArmFrames[frameIdx].joint_angles_deg;
        twinArmShoulder.rotation.z = (a1 * Math.PI) / 180;
        twinArmElbow.rotation.z = (a2 * Math.PI) / 180;
      } else if (twinCurve && twinActor) {
        const u = (t * 0.22) % 1;
        twinCurve.getPointAt(u, _twinPos);
        twinCurve.getPointAt(Math.min(1, u + 0.02), _twinNext);
        twinActor.position.copy(_twinPos);
        if (_twinNext.distanceToSquared(_twinPos) > 1e-6) {
          twinActor.lookAt(_twinNext.x + roboticsGroup.position.x, _twinPos.y + roboticsGroup.position.y, _twinNext.z + roboticsGroup.position.z);
        }
        for (let r = 0; r < twinRotors.length; r += 1) {
          twinRotors[r].rotation.z = t * 18;
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(rafId);
      resizeObs.disconnect();
      renderer.domElement.removeEventListener('click', handlePointerClick);
      disposeGroupChildren(roboticsGroup);
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

  function toggleFocusCamera(twinMode: boolean) {
    setFocusTwin(twinMode);
    if (twinMode) {
      cameraRef.current?.position.set(0, 2.2, 14.5);
      controlsRef.current?.target.set(0, -1.8, 7.6);
    } else {
      cameraRef.current?.position.set(0, 8.2, 18.5);
      controlsRef.current?.target.set(0, 0.2, 0.5);
    }
    controlsRef.current?.update();
  }

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

      {/* Top Left Active Node Telemetry HUD (no backdrop-filter over WebGL) */}
      <div className="absolute top-3 left-3 max-w-xs rounded-lg border border-slate-700/90 bg-slate-950/92 px-3 py-2 text-[11px] pointer-events-auto">
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
          <div className="mt-1.5 grid grid-cols-3 gap-x-2 gap-y-0.5 text-slate-300 font-mono tabular-nums">
            <span>Prog: {activeStage.progress}%</span>
            <span>In: {activeStage.inputCount}</span>
            <span>Out: {activeStage.outputCount}</span>
            <span>Dur: {activeStage.durationMs}ms</span>
            <span>Err: {activeStage.errorCount}</span>
            <span>Phase: {activeStage.phase}</span>
          </div>
        )}
        {roboticsReport && (
          <div className="mt-1.5 pt-1.5 border-t border-slate-800 text-[10px] font-mono text-emerald-300 flex items-center gap-1.5">
            <Bot className="w-3.5 h-3.5 shrink-0" />
            <span>
              3D Twin: {roboticsReport.robot.robot_type} · Score{' '}
              {String(roboticsReport.evaluation.score ?? 'N/A')}
            </span>
          </div>
        )}
      </div>

      {/* Top Right Controls & Color Legend */}
      <div className="absolute top-3 right-3 flex flex-col items-end gap-2">
        <div className="flex items-center gap-1.5">
          {roboticsReport && (
            <button
              type="button"
              onClick={() => toggleFocusCamera(!focusTwin)}
              className={`px-2.5 py-1 text-[11px] rounded-md border whitespace-nowrap ${
                focusTwin
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'
                  : 'bg-slate-950/92 border-slate-700 text-slate-300'
              }`}
            >
              {focusTwin ? 'Pipeline Overview' : 'Focus 3D Twin'}
            </button>
          )}
          <button
            type="button"
            data-testid="safe-ui-test"
            onClick={() => setAutoOrbit((v) => !v)}
            className={`px-2.5 py-1 text-[11px] rounded-md border whitespace-nowrap ${
              autoOrbit
                ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-200'
                : 'bg-slate-950/92 border-slate-700 text-slate-300'
            }`}
          >
            {autoOrbit ? 'Orbit On' : 'Orbit Off'}
          </button>
          <button
            type="button"
            data-testid="safe-ui-test"
            onClick={() => toggleFocusCamera(false)}
            className="p-1.5 rounded-md border border-slate-700 bg-slate-950/92 text-slate-300 hover:text-white"
            title="Reset Camera"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            data-testid="safe-ui-test"
            onClick={() => setLegendCollapsed((v) => !v)}
            className="p-1.5 rounded-md border border-slate-700 bg-slate-950/92 text-slate-300 hover:text-white"
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
          <div className="rounded-lg border border-slate-800 bg-slate-950/92 px-2.5 py-2 text-[10px] grid grid-cols-2 gap-x-3 gap-y-1 text-slate-300">
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
