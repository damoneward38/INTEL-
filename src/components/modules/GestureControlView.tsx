import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Hand, Keyboard } from 'lucide-react';

export type GestureCommandId =
  | 'nav:workspace'
  | 'nav:knowledge'
  | 'nav:lab'
  | 'nav:governance'
  | 'action:run_simulation'
  | 'action:toggle_language';

interface GestureMapping {
  gesture: string;
  shortcut: string;
  command: GestureCommandId;
  label: string;
}

const DEFAULT_MAPPINGS: GestureMapping[] = [
  { gesture: 'Open_Palm', shortcut: '1', command: 'nav:workspace', label: 'Open Command Center' },
  { gesture: 'Pointing_Up', shortcut: '2', command: 'nav:knowledge', label: 'Open Knowledge & 3D' },
  { gesture: 'Victory', shortcut: '3', command: 'nav:lab', label: 'Open Lab & Synthesis' },
  { gesture: 'Closed_Fist', shortcut: '4', command: 'nav:governance', label: 'Open Governance & Edge' },
  { gesture: 'Thumb_Up', shortcut: 'Space / S', command: 'action:run_simulation', label: 'Launch MD Simulation' },
  { gesture: 'Thumb_Down', shortcut: 'L', command: 'action:toggle_language', label: 'Switch EN / HE Language' },
];

interface Props {
  onExecuteCommand: (command: GestureCommandId) => void;
}

export default function GestureControlView({ onExecuteCommand }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  const [mappings, setMappings] = useState<GestureMapping[]>(DEFAULT_MAPPINGS);
  const [cameraActive, setCameraActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    'Camera off. Use keyboard shortcuts or enable camera for MediaPipe landmark detection.'
  );
  const [lastTriggered, setLastTriggered] = useState<string>('None yet');
  const [keyboardEnabled, setKeyboardEnabled] = useState(true);

  useEffect(() => {
    if (!keyboardEnabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      if (e.key === '1') trigger('nav:workspace', 'Key 1');
      else if (e.key === '2') trigger('nav:knowledge', 'Key 2');
      else if (e.key === '3') trigger('nav:lab', 'Key 3');
      else if (e.key === '4') trigger('nav:governance', 'Key 4');
      else if (e.key.toLowerCase() === 's') trigger('action:run_simulation', 'Key S');
      else if (e.key.toLowerCase() === 'l') trigger('action:toggle_language', 'Key L');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keyboardEnabled]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  function trigger(cmd: GestureCommandId, via: string) {
    setLastTriggered(`${cmd} (${via})`);
    onExecuteCommand(cmd);
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatusMessage(
        'Browser camera API unavailable in this environment. Keyboard and accessibility controls remain active.'
      );
      return;
    }

    try {
      setStatusMessage('Requesting browser camera permission...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 480, height: 320, facingMode: 'user' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      setStatusMessage(
        'Camera active. Initializing MediaPipe HandLandmarker geometric gesture classifier...'
      );

      // Load MediaPipe HandLandmarker cleanly; degrade gracefully if offline CDN blocked
      try {
        const vision = await import('@mediapipe/tasks-vision');
        const fileset = await vision.FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
        const handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          },
          runningMode: 'VIDEO',
          numHands: 1,
        });

        setStatusMessage('MediaPipe HandLandmarker active (real-time landmark tracking).');
        let lastCmdTime = 0;

        const detectFrame = () => {
          if (!videoRef.current || !streamRef.current) return;
          if (videoRef.current.readyState >= 2) {
            const result = handLandmarker.detectForVideo(
              videoRef.current,
              performance.now()
            );
            const lm = result.landmarks?.[0];
            if (lm && Date.now() - lastCmdTime > 1600) {
              // Geometric finger extension classification
              const indexUp = lm[8].y < lm[6].y;
              const middleUp = lm[12].y < lm[10].y;
              const ringUp = lm[16].y < lm[14].y;
              const pinkyUp = lm[20].y < lm[18].y;
              const thumbUp = lm[4].y < lm[3].y;

              let detectedGesture = '';
              if (indexUp && middleUp && ringUp && pinkyUp) detectedGesture = 'Open_Palm';
              else if (indexUp && !middleUp && !ringUp && !pinkyUp) detectedGesture = 'Pointing_Up';
              else if (indexUp && middleUp && !ringUp && !pinkyUp) detectedGesture = 'Victory';
              else if (!indexUp && !middleUp && !ringUp && !pinkyUp && !thumbUp) detectedGesture = 'Closed_Fist';
              else if (thumbUp && !indexUp && !middleUp) detectedGesture = 'Thumb_Up';

              if (detectedGesture) {
                const match = mappings.find((m) => m.gesture === detectedGesture);
                if (match) {
                  lastCmdTime = Date.now();
                  trigger(match.command, `Gesture: ${detectedGesture}`);
                }
              }
            }
          }
          rafRef.current = requestAnimationFrame(detectFrame);
        };
        rafRef.current = requestAnimationFrame(detectFrame);
      } catch {
        setStatusMessage(
          'Camera stream active, but MediaPipe WASM model assets are unreachable offline. Use accessible command buttons or keyboard shortcuts.'
        );
      }
    } catch (err) {
      setCameraActive(false);
      setStatusMessage(
        err instanceof Error
          ? `Camera permission denied or unavailable: ${err.message}. Keyboard shortcuts active.`
          : 'Camera unavailable. Use keyboard shortcuts.'
      );
    }
  }

  function stopCamera() {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }

  function updateMappingCommand(index: number, newCommand: GestureCommandId) {
    const labelMap: Record<GestureCommandId, string> = {
      'nav:workspace': 'Open Command Center',
      'nav:knowledge': 'Open Knowledge & 3D',
      'nav:lab': 'Open Lab & Synthesis',
      'nav:governance': 'Open Governance & Edge',
      'action:run_simulation': 'Launch MD Simulation',
      'action:toggle_language': 'Switch EN / HE Language',
    };
    setMappings((prev) =>
      prev.map((m, i) =>
        i === index ? { ...m, command: newCommand, label: labelMap[newCommand] } : m
      )
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left: Camera / MediaPipe Feed */}
      <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Hand className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Smart Gesture Camera & MediaPipe
            </h2>
          </div>
          {cameraActive ? (
            <button
              type="button"
              onClick={stopCamera}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-rose-500/40 text-rose-300 rounded-lg hover:bg-rose-500/10"
            >
              <CameraOff className="w-3.5 h-3.5" />
              <span>Stop Camera</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={startCamera}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Enable Camera</span>
            </button>
          )}
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#07090E] aspect-video flex items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            muted
            playsInline
            className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
          />
          {!cameraActive && (
            <div className="text-center px-4 text-xs text-slate-500">
              Camera feed idle. Click Enable Camera to grant permission for MediaPipe HandLandmarker.
            </div>
          )}
        </div>

        <p className="text-xs text-slate-300">{statusMessage}</p>
        <div className="text-[11px] font-mono text-cyan-300">
          Last Executed Command: {lastTriggered}
        </div>
      </div>

      {/* Right: Configurable Gesture-to-Command Mapping + Keyboard Alternatives */}
      <div className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#0D121D] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-slate-100">
              Configurable Gesture-to-Command Map & Accessibility Shortcuts
            </h3>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={keyboardEnabled}
              onChange={(e) => setKeyboardEnabled(e.target.checked)}
              className="accent-cyan-500"
            />
            <span>Global Keyboard Shortcuts</span>
          </label>
        </div>

        <div className="space-y-2.5">
          {mappings.map((m, idx) => (
            <div
              key={m.gesture}
              className="rounded-lg border border-slate-800 bg-[#07090E] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs"
            >
              <div className="min-w-[160px]">
                <div className="font-mono font-semibold text-cyan-300">{m.gesture}</div>
                <div className="text-[11px] text-slate-400">Keyboard: {m.shortcut}</div>
              </div>

              <select
                value={m.command}
                onChange={(e) =>
                  updateMappingCommand(idx, e.target.value as GestureCommandId)
                }
                aria-label={`Command for ${m.gesture}`}
                className="rounded-lg border border-slate-700 bg-[#0D121D] px-2.5 py-1.5 text-xs text-slate-100"
              >
                <option value="nav:workspace">Open Command Center</option>
                <option value="nav:knowledge">Open Knowledge & 3D</option>
                <option value="nav:lab">Open Lab & Synthesis</option>
                <option value="nav:governance">Open Governance & Edge</option>
                <option value="action:run_simulation">Launch MD Simulation</option>
                <option value="action:toggle_language">Switch EN / HE Language</option>
              </select>

              <button
                type="button"
                onClick={() => trigger(m.command, `Accessible Button (${m.gesture})`)}
                className="px-3 py-1.5 text-[11px] border border-slate-700 rounded-md text-slate-200 hover:bg-slate-800"
              >
                Trigger
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
