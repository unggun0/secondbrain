"use client";
import { useState, useRef, useCallback, useEffect, Suspense } from "react";
import React from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface Thought {
  id: number;
  text: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  connections: number[];
  color?: string;
  createdAt: number;
  updatedAt: number;
  lastFocusedAt: number;
  layer: 0 | 1 | 2;
  depthProgress: number;
  opacity: number;
  blur: number;
  scale: number;
  saturation: number;
  spawnScale: number;
  spawnedAt: number;
  nodeWidth?: number;
  nodeHeight?: number;
  attribute?: "problem" | "aware" | null;
}

const PRESET_COLORS = [
  "rgba(255,255,255,0.12)",
  "rgba(100,100,255,0.25)",
  "rgba(255,90,90,0.25)",
  "rgba(80,220,140,0.25)",
  "rgba(255,190,80,0.25)",
  "rgba(200,90,255,0.25)",
  "rgba(80,200,255,0.25)",
];

const LAYER_DURATION = { 0: 30_000, 1: 120_000, 2: Infinity };
const LAYER_NAMES = ["Active", "Emerging", "Abyssal"] as const;
type LayerIndex = 0 | 1 | 2;

const lerp = (a: number, b: number, t: number) =>
  a + (b - a) * Math.min(Math.max(t, 0), 1);
const computeVisuals = (layer: LayerIndex, progress: number) => {
  if (layer === 0) return { opacity: lerp(1.0, 0.7, progress), blur: lerp(0, 1, progress), scale: lerp(1.0, 0.92, progress), saturation: lerp(1.0, 0.85, progress) };
  if (layer === 1) return { opacity: lerp(0.7, 0.45, progress), blur: lerp(1, 4, progress), scale: lerp(0.92, 0.82, progress), saturation: lerp(0.85, 0.65, progress) };
  return { opacity: lerp(0.45, 0.25, progress), blur: lerp(4, 8, progress), scale: lerp(0.82, 0.72, progress), saturation: lerp(0.65, 0.55, progress) };
};

// ─────────────────────────────────────────────
// ParticleSphere
// ─────────────────────────────────────────────
function ParticleSphere({ camDepth }: { camDepth: React.MutableRefObject<number> }) {
  const PARTICLE_COUNT = 500;
  const SPHERE_RADIUS = 9;
  const ROTATION_SPEED_Y = 0.0005;
  const groupRef = useRef<THREE.Group>(null);

  const particles = useRef((() => {
    const arr = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const phi = Math.acos(-1 + (2 * i) / PARTICLE_COUNT);
      const theta = Math.sqrt(PARTICLE_COUNT * Math.PI) * phi;
      const r = SPHERE_RADIUS + (Math.random() - 0.5) * 4;
      arr.push({
        position: [
          r * Math.cos(theta) * Math.sin(phi),
          r * Math.cos(phi),
          r * Math.sin(theta) * Math.sin(phi),
        ] as [number, number, number],
        scale: 0.005 + Math.random() * 0.005,
        color: new THREE.Color().setHSL(
          Math.random() * 0.1 + 0.05,
          0.8,
          0.6 + Math.random() * 0.3,
        ),
      });
    }
    return arr;
  })()).current;

  useFrame(({ camera }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += ROTATION_SPEED_Y;
    }
    const cam = camDepth.current;
    const targetZ = cam < 1
      ? 10 - cam * 8
      : cam < 2
      ? 2 - (cam - 1) * 4
      : -2 - (cam - 2) * 2;
    camera.position.z += (targetZ - camera.position.z) * 0.06;
    camera.position.x += (-10 - camera.position.x) * 0.02;
    camera.position.y += (1.5 - camera.position.y) * 0.02;
  });

  return (
    <group ref={groupRef}>
      {particles.map((p, i) => (
        <mesh key={i} position={p.position} scale={p.scale}>
          <sphereGeometry args={[1, 4, 3]} />
          <meshBasicMaterial color={p.color} />
        </mesh>
      ))}
    </group>
  );
}

// ─────────────────────────────────────────────
// Cognitive Load Minimap
// ─────────────────────────────────────────────
function CognitiveMinimap({
  thoughts, onLayerClick, currentLayer = 0, size = 80,
}: {
  thoughts: { layer: 0 | 1 | 2; connections: number[] }[];
  onLayerClick: (layer: 0 | 1 | 2) => void;
  currentLayer?: 0 | 1 | 2;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const layerWeights = [1.0, 0.7, 0.3];
  const layerLoads = ([0, 1, 2] as const).map((l) => {
    const nodes = thoughts.filter((t) => t.layer === l);
    const connCount = nodes.reduce((sum, t) => sum + t.connections.length, 0) / 2;
    return (nodes.length * 1.0 + connCount * 1.5) * layerWeights[l];
  });
  const getStatus = (load: number) => load < 30 ? "normal" : load < 60 ? "active" : "overload";
  const layerStatuses = layerLoads.map(getStatus);
  const currentStatus = getStatus(layerLoads[currentLayer]);
  const statusColors: Record<string, [number, number, number]> = {
    normal: [120, 180, 255], active: [255, 180, 60], overload: [255, 60, 60],
  };

  useEffect(() => {
    const W = size, H = size, CX = W / 2, CY = H / 2, sc = size / 80;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) { animRef.current = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext("2d")!;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);
      const now = performance.now() / 1000;
      const ellipses = [
        { rx: 32 * sc, ry: 22 * sc, z: 0 as const },
        { rx: 22 * sc, ry: 15 * sc, z: 1 as const },
        { rx: 11 * sc, ry: 8 * sc, z: 2 as const },
      ];
      ellipses.forEach(({ rx, ry, z }) => {
        const load = layerLoads[z];
        const status = layerStatuses[z];
        const [cr, cg, cb] = statusColors[status];
        const isCurrent = z === currentLayer;
        const intensity = Math.min(load / 60, 1);
        const pulseSpeed = status === "normal" ? 1.2 : status === "active" ? 2.5 : 5.0;
        const pulse = 0.55 + 0.45 * Math.sin(now * pulseSpeed + z * 1.1);
        const shake = status === "overload" ? Math.sin(now * 28 + z) * 1.5 * sc : 0;
        if (intensity > 0.05) {
          const glowAlpha = intensity * (isCurrent ? 0.45 : 0.2) * pulse;
          const grd = ctx.createRadialGradient(CX + shake, CY + shake * 0.5, 0, CX, CY, rx * 1.6);
          grd.addColorStop(0, `rgba(${cr},${cg},${cb},${glowAlpha})`);
          grd.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.ellipse(CX + shake, CY + shake * 0.5, rx * 1.5, ry * 1.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        if (status === "overload") {
          const gasAlpha = 0.15 + 0.1 * Math.sin(now * 3.5 + z * 2);
          const gasGrd = ctx.createRadialGradient(CX, CY, rx * 0.3, CX, CY, rx * 1.8);
          gasGrd.addColorStop(0, `rgba(255,40,40,${gasAlpha})`);
          gasGrd.addColorStop(0.6, `rgba(200,20,20,${gasAlpha * 0.5})`);
          gasGrd.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = gasGrd;
          ctx.beginPath();
          ctx.ellipse(CX + shake, CY + shake * 0.5, rx * 1.8, ry * 1.8, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        if (status === "active" || status === "overload") {
          const sparkCount = status === "overload" ? 6 : 3;
          for (let i = 0; i < sparkCount; i++) {
            const angle = (now * 1.8 + i * (Math.PI * 2 / sparkCount) + z) % (Math.PI * 2);
            const sparkR = rx * (0.8 + 0.2 * Math.sin(now * 3 + i));
            const sx = CX + Math.cos(angle) * sparkR;
            const sy = CY + Math.sin(angle) * sparkR * (ry / rx);
            const sparkAlpha = (0.4 + 0.6 * Math.sin(now * 4 + i * 1.7)) * intensity;
            ctx.beginPath();
            ctx.arc(sx, sy, 1.2 * sc, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${sparkAlpha})`;
            ctx.fill();
          }
        }
        ctx.beginPath();
        ctx.ellipse(CX + shake, CY + shake * 0.5, rx, ry, 0, 0, Math.PI * 2);
        const strokeAlpha = (isCurrent ? 0.55 : 0.2) * (0.7 + 0.3 * pulse);
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${strokeAlpha})`;
        ctx.lineWidth = isCurrent ? 1.2 : 0.6;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(CX - rx + shake, CY + shake * 0.3);
        ctx.lineTo(CX + rx + shake, CY + shake * 0.3);
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${strokeAlpha * 0.25})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(CX, CY - 28 * sc);
      ctx.lineTo(CX, CY + 28 * sc);
      ctx.strokeStyle = "rgba(180,180,255,0.1)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
      const total = thoughts.length;
      const statusLabel = currentStatus === "normal" ? "calm" : currentStatus === "active" ? "active" : "overload";
      const [lr, lg, lb] = statusColors[currentStatus];
      ctx.fillStyle = `rgba(${lr},${lg},${lb},0.5)`;
      ctx.font = `${6 * sc}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(`${statusLabel} · ${total}`, CX, H - 3);
      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [layerLoads, layerStatuses, currentLayer, currentStatus, size]);

  const sc = size / 80;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-[8px] uppercase tracking-[0.2em] text-white/25 font-light">Mind</span>
      <div className="relative" style={{ width: size, height: size }}>
        <canvas ref={canvasRef} style={{ width: size, height: size }} />
        {([0, 1, 2] as const).map((l) => {
          const bs = [{ w: 64 * sc, h: 44 * sc }, { w: 44 * sc, h: 30 * sc }, { w: 22 * sc, h: 16 * sc }];
          const b = bs[l];
          return (
            <button key={l} onClick={() => onLayerClick(l)}
              className="absolute rounded-full hover:bg-white/5 transition-colors"
              style={{ width: b.w, height: b.h, left: (size - b.w) / 2, top: (size - b.h) / 2 }}
              title={["Active", "Emerging", "Abyssal"][l]} />
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────
export default function Dashboard() {
  const [, forceRender] = useState(0);
  const [input, setInput] = useState("");
  const [connecting, setConnecting] = useState<number | null>(null);
  const [longHoverId, setLongHoverId] = useState<number | null>(null);
  const [showColorPicker, setShowColorPicker] = useState<number | null>(null);
  const [previewColor, setPreviewColor] = useState<string | null>(null);
  const [deletedThought, setDeletedThought] = useState<{ thought: Thought; index: number } | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [panelEditText, setPanelEditText] = useState<string>("");
  const [hudLayer, setHudLayer] = useState<LayerIndex>(0);
  const [hudVisible, setHudVisible] = useState(true);
  const [bgOpacity] = useState(0.85);
  const [nodeSize, setNodeSize] = useState(1.0); // 1.0 = 기본값
  const bgOpacityRef = useRef(0.85);
  const bgOpacityTargetRef = useRef(0.85);
  const overloadLevelRef = useRef(0);

  // ── 빈 배경 드래그 (캔버스 패닝) ──
  const bgDragging = useRef(false);
  const bgDragStart = useRef({ x: 0, y: 0 });
  const bgOffset = useRef({ x: 0, y: 0 });
  const bgOffsetRef = useRef({ x: 0, y: 0 });
  const thoughtsRef = useRef<Thought[]>([]);
  const dragging = useRef<{ id: number; offsetX: number; offsetY: number } | null>(null);
  const isDragging = useRef(false);
  const lastClickTime = useRef<{ [id: number]: number }>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const leaderPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragLeaderIdRef = useRef<number | null>(null);
  const longHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const camDepthRef = useRef(0);
  const camTargetRef = useRef(0);
  const camVelRef = useRef(0);
  const zoomCanvasRef = useRef<HTMLCanvasElement>(null);
  const prevCamLayerRef = useRef<LayerIndex>(0);
  const camLayerRef = useRef<LayerIndex>(0);
  const particlesRef = useRef<{ x: number; y: number; vx: number; vy: number; alpha: number; size: number; life: number }[]>([]);
  const transitionRef = useRef({ active: false, phase: 0, startTime: 0 });
  // spawnTrailsRef 제거됨

  // ── 빈 배경 드래그 핸들러 ──
  const handleBgMouseDown = useCallback((e: React.MouseEvent) => {
    // 노드 클릭이 아닐 때만 (z-index로 노드가 위에 있으므로 여기까지 오면 빈 배경)
    if (connecting !== null) return;
    bgDragging.current = true;
    bgDragStart.current = { x: e.clientX - bgOffset.current.x, y: e.clientY - bgOffset.current.y };
  }, [connecting]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!bgDragging.current) return;
      bgOffset.current = {
        x: e.clientX - bgDragStart.current.x,
        y: e.clientY - bgDragStart.current.y,
      };
      // 모든 노드를 offset만큼 이동
      thoughtsRef.current.forEach((t) => {
        t.x += e.movementX;
        t.y += e.movementY;
      });
      forceRender((n) => n + 1);
    };
    const onUp = () => { bgDragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1.0 : 1.0;
      camTargetRef.current = Math.min(2.99, Math.max(0, camTargetRef.current + delta));
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    let fid: number;
    const loop = () => {
      const canvas = zoomCanvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) { fid = requestAnimationFrame(loop); return; }
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const diff = camTargetRef.current - camDepthRef.current;
      camVelRef.current = camVelRef.current * 0.3 + diff * 0.15;
      camDepthRef.current = Math.min(2.99, Math.max(0, camDepthRef.current + camVelRef.current));
      const cam = camDepthRef.current;
      const camLayer = Math.floor(cam) as LayerIndex;
      if (camLayer !== prevCamLayerRef.current) {
        prevCamLayerRef.current = camLayer;
        camLayerRef.current = camLayer;
        // transition 제거 — canvas dim은 유지하되 state 변경은 rAF 밖으로 분리
        transitionRef.current = { active: true, phase: 0, startTime: performance.now() };
        // setTimeout 대신 requestIdleCallback으로 state 업데이트 → 렌더 부하 분산
        const idleCb = typeof requestIdleCallback !== "undefined" ? requestIdleCallback : setTimeout;
        idleCb(() => { setHudLayer(camLayer); setHudVisible(true); });
        setHudVisible(false);
      }
      if (transitionRef.current.active) {
        const t = Math.min((performance.now() - transitionRef.current.startTime) / 800, 1);
        const dimAlpha = Math.sin(t * Math.PI) * 0.12;
        ctx.fillStyle = `rgba(0,0,0,${dimAlpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (t >= 1) transitionRef.current.active = false;
      }

      const nowMs = Date.now();
      const W = canvas.width, H = canvas.height;
      const depthCam = camDepthRef.current;

      // ── 1. Left-side Vignette: 레이어 깊이에 따라 왼쪽에서 밀려오는 칠흑 안개 ──
      if (depthCam > 0.05) {
        const fogStrength = Math.min(depthCam / 2.99, 1); // 0→1 (레이어 깊이)
        const fogReach = 0.15 + fogStrength * 0.55; // 화면의 15%~70%까지 침범
        const fogAlpha = fogStrength * 0.88;
        const fogGrd = ctx.createLinearGradient(0, 0, W * fogReach, 0);
        fogGrd.addColorStop(0, `rgba(0,0,0,${fogAlpha})`);
        fogGrd.addColorStop(0.6, `rgba(0,0,0,${fogAlpha * 0.4})`);
        fogGrd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = fogGrd;
        ctx.fillRect(0, 0, W, H);

        // 상하 vignette도 살짝 (공간감 강화)
        const edgeAlpha = fogStrength * 0.35;
        const topGrd = ctx.createLinearGradient(0, 0, 0, H * 0.3);
        topGrd.addColorStop(0, `rgba(0,0,0,${edgeAlpha})`);
        topGrd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = topGrd;
        ctx.fillRect(0, 0, W, H);
        const btmGrd = ctx.createLinearGradient(0, H, 0, H * 0.7);
        btmGrd.addColorStop(0, `rgba(0,0,0,${edgeAlpha})`);
        btmGrd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = btmGrd;
        ctx.fillRect(0, 0, W, H);
      }

      // ── 2. Abyssal 극미세 입자: 얼굴 쪽으로 아주 천천히 다가오는 20개 ──
      if (depthCam > 1.5) {
        const abyssalDepth = Math.min((depthCam - 1.5) / 1.49, 1); // 0→1
        if (!particlesRef.current.length || particlesRef.current.length < 20) {
          // 파티클 초기화
          particlesRef.current = Array.from({ length: 20 }, () => ({
            x: Math.random() * W,
            y: Math.random() * H,
            vx: 0,
            vy: 0,
            alpha: Math.random() * 0.15 + 0.03,
            size: Math.random() * 1.2 + 0.3,
            life: Math.random(),
          }));
        }
        particlesRef.current.forEach((p) => {
          // 화면 중앙에서 바깥으로 밀려나는 원근감 (카메라가 다가오는 느낌)
          const cx = W / 2, cy = H / 2;
          const dx = p.x - cx, dy = p.y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const speed = 0.04 + abyssalDepth * 0.08; // 매우 느림
          p.x += (dx / dist) * speed;
          p.y += (dy / dist) * speed;
          p.life += 0.001;

          // 화면 밖으로 나가면 중앙 근처에서 재생성
          if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) {
            p.x = cx + (Math.random() - 0.5) * W * 0.3;
            p.y = cy + (Math.random() - 0.5) * H * 0.3;
            p.alpha = Math.random() * 0.12 + 0.02;
            p.size = Math.random() * 1.2 + 0.3;
          }

          const alpha = p.alpha * abyssalDepth;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(180,190,255,${alpha})`;
          ctx.fill();
        });
      } else {
        // Abyssal 아닐 때 파티클 초기화
        particlesRef.current = [];
      }

      // ── 3. Abyssal에서 Three.js 구체(오른쪽) 위에 어둠 오버레이 (밝기 40% 이하) ──
      if (depthCam > 1.5) {
        const dimStrength = Math.min((depthCam - 1.5) / 1.49, 1) * 0.65; // 최대 65% 어둡게
        // 오른쪽 영역만 어둡게 (구체가 오른쪽에 있음)
        const rightGrd = ctx.createLinearGradient(W * 0.4, 0, W, 0);
        rightGrd.addColorStop(0, 'rgba(0,0,0,0)');
        rightGrd.addColorStop(0.4, `rgba(0,0,0,${dimStrength * 0.5})`);
        rightGrd.addColorStop(1, `rgba(0,0,0,${dimStrength})`);
        ctx.fillStyle = rightGrd;
        ctx.fillRect(0, 0, W, H);
      }

      fid = requestAnimationFrame(loop);
    };
    fid = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(fid);
  }, []);

  const getConnectedGroup = useCallback((id: number, all: Thought[]): number[] => {
    const visited = new Set<number>();
    const queue = [id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      all.find((t) => t.id === cur)?.connections.forEach((c) => { if (!visited.has(c)) queue.push(c); });
    }
    return Array.from(visited);
  }, []);

  useEffect(() => {
    const s = thoughtsRef.current.find((t) => t.id === selectedId);
    if (s) setPanelEditText(s.text);
  }, [selectedId]);

  useEffect(() => {
    const STIFFNESS = 0.08, DAMPING = 0.93, MIN_DIST = 110, DENSITY_FACTOR = 0.7;
    const loop = () => {
      const now = Date.now();
      const thoughts = thoughtsRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const leaderId = dragLeaderIdRef.current;
      const leaderPos = leaderPosRef.current;
      const cam = camDepthRef.current;

      thoughts.forEach((t) => {
        const age = now - t.createdAt;
        let layer: LayerIndex = 0, progress = 0;
        if (age < LAYER_DURATION[0]) { layer = 0; progress = age / LAYER_DURATION[0]; }
        else if (age < LAYER_DURATION[0] + LAYER_DURATION[1]) { layer = 1; progress = (age - LAYER_DURATION[0]) / LAYER_DURATION[1]; }
        else { layer = 2; progress = Math.min((age - LAYER_DURATION[0] - LAYER_DURATION[1]) / 60_000, 1); }
        t.layer = layer; t.depthProgress = progress;
        const isFocused = t.id === selectedId;
        const v = computeVisuals(layer, progress);
        t.opacity = Math.min(v.opacity + (isFocused ? 0.4 : 0), 1.0);
        t.blur = isFocused ? 0 : v.blur;
        t.scale = v.scale + (isFocused ? 0.08 : 0);
        t.saturation = v.saturation + (isFocused ? 0.3 : 0);

        if (!t.spawnScale) t.spawnScale = 0;
        if (t.spawnScale < 0.999) {
          const elapsed = now - t.spawnedAt;
          if (elapsed < 0) {
            t.spawnScale = 0;
          } else {
            const p = Math.min(elapsed / 600, 1);
            const elastic = p === 1 ? 1 : 1 - Math.pow(2, -10 * p) * Math.cos(p * Math.PI * 2.5);
            t.spawnScale = Math.max(0, elastic);
          }
        } else {
          t.spawnScale = 1;
        }

        if (t.spawnedAt > now) {
          if (!(t as any)._tx) {
            (t as any)._tx = t.x + t.vx * 8;
            (t as any)._ty = t.y + t.vy * 8;
          }
          const tx = (t as any)._tx, ty = (t as any)._ty;
          const tdx = tx - t.x, tdy = ty - t.y;
          const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
          const W2 = window.innerWidth, H2 = window.innerHeight;
          const startDist = Math.sqrt(Math.pow(tx - W2 / 2, 2) + Math.pow(ty - (H2 - 80), 2));
          t.spawnScale = lerp(0.2, 1.0, Math.max(0, 1 - tdist / (startDist || 1)));
          if (tdist > 6) {
            t.vx = t.vx * 0.7 + (tdx / tdist) * Math.min(tdist * 0.4, 28);
            t.vy = t.vy * 0.7 + (tdy / tdist) * Math.min(tdist * 0.4, 28);
            t.x += t.vx; t.y += t.vy;
          } else {
            t.x = tx; t.y = ty; t.vx = 0; t.vy = 0;
            t.spawnScale = 1; t.spawnedAt = now;
          }
        }
      });

      const camSpeed = Math.abs(camVelRef.current);
      if (camSpeed > 0.0003) {
        const camLayer = Math.floor(cam) as LayerIndex;
        const W = window.innerWidth, H = window.innerHeight;
        const cx = W / 2, cy = H / 2;
        thoughts.forEach((t) => {
          if (t.layer !== camLayer) return;
          const dx = t.x - cx, dy = t.y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const pf = camVelRef.current * 38 * (1 - t.depthProgress * 0.5);
          t.x += (dx / dist) * pf; t.y += (dy / dist) * pf;
        });
      }

      const baseCount = thoughts.length;
      const maxVisible = Math.max(3, Math.round(baseCount * Math.exp(-cam * DENSITY_FACTOR)));
      const connGroup = selectedId ? getConnectedGroup(selectedId, thoughts) : [];
      const sorted = [...thoughts].sort((a, b) => {
        const sa = a.id === selectedId ? 4 : connGroup.includes(a.id) ? 3 : a.layer === 0 ? 2 : 1;
        const sb = b.id === selectedId ? 4 : connGroup.includes(b.id) ? 3 : b.layer === 0 ? 2 : 1;
        return sb - sa;
      });
      const visibleIds = new Set(sorted.slice(0, maxVisible).map((t) => t.id));

      thoughts.forEach((t) => {
        if (t.id === dragLeaderIdRef.current) return;
        let fx = 0, fy = 0;
        thoughts.forEach((o) => {
          if (o.id === t.id) return;
          const rx = t.x - o.x, ry = t.y - o.y;
          const rd = Math.sqrt(rx * rx + ry * ry);
          if (rd < MIN_DIST && rd > 0) {
            const force = (MIN_DIST - rd) / rd * 0.018;
            fx += rx * force; fy += ry * force;
          }
        });
        t.vx = (t.vx + fx) * DAMPING;
        t.vy = (t.vy + fy) * DAMPING;
        t.x += t.vx; t.y += t.vy;
      });

      const hasMotion = thoughts.some(t => Math.abs(t.vx) > 0.01 || Math.abs(t.vy) > 0.01);
      if (hasMotion) forceRender((n) => n + 1);

      const curLayer = camLayerRef.current;
      const curNodes = thoughts.filter(t => t.layer === curLayer);
      const curConns = curNodes.reduce((sum, t) => sum + t.connections.length, 0) / 2;
      const load = curNodes.length * 1.0 + curConns * 1.5;
      overloadLevelRef.current = load < 30 ? 0 : load < 60 ? 1 : 2;

      if (leaderId && leaderPos) {
        const group = getConnectedGroup(leaderId, thoughts);
        thoughts.forEach((t) => {
          if (t.id === leaderId) { t.x = leaderPos.x; t.y = leaderPos.y; t.vx = 0; t.vy = 0; return; }
          if (group.includes(t.id)) {
            const dx = leaderPos.x - t.x, dy = leaderPos.y - t.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            let fx = 0, fy = 0;
            if (dist > 160) { const ratio = (dist - 160) / dist; fx += dx * ratio * STIFFNESS; fy += dy * ratio * STIFFNESS; }
            group.forEach((oid) => {
              if (oid === t.id) return;
              const o = thoughts.find((t) => t.id === oid); if (!o) return;
              const rx = t.x - o.x, ry = t.y - o.y, rd = Math.sqrt(rx * rx + ry * ry);
              if (rd < MIN_DIST && rd > 0) { fx += (rx / rd) * (MIN_DIST - rd) * 0.05; fy += (ry / rd) * (MIN_DIST - rd) * 0.05; }
            });
            t.vx = (t.vx + fx) * DAMPING; t.vy = (t.vy + fy) * DAMPING; t.x += t.vx; t.y += t.vy;
          }
        });
        forceRender((n) => n + 1);
      }

      if (canvas && ctx) {
        canvas.width = window.innerWidth; canvas.height = window.innerHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const ns = now / 1000;
        thoughts.forEach((th) => {
          if (!visibleIds.has(th.id) || th.opacity < 0.04) return;
          th.connections.forEach((tid) => {
            const tg = thoughts.find((t) => t.id === tid);
            if (!tg || tid < th.id || !visibleIds.has(tid) || tg.opacity < 0.04 || th.connections.length === 0) return;
            if (th.layer !== camLayerRef.current || tg.layer !== camLayerRef.current) return;
            const x1 = th.x + 40, y1 = th.y + 16, x2 = tg.x + 40, y2 = tg.y + 16;
            const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2); if (len < 1) return;
            const dx = (x2 - x1) / len, dy = (y2 - y1) / len;
            const density = Math.max(8, Math.floor(len / 18));
            const baseLineOp = camDepthRef.current < 1 ? 0.6 : camDepthRef.current < 2 ? 0.5 : 0.4;
            const lineOp = ((th.opacity + tg.opacity) / 2) * baseLineOp;
            for (let i = 0; i < density; i++) {
              const t = ((ns * 0.3) + i / density) % 1;
              const px = x1 + dx * len * t, py = y1 + dy * len * t;
              const alpha = (0.2 + (1 - Math.abs(t - 0.5) * 2) * 0.5) * lineOp;
              const vib = Math.sin(ns * 2.5 + i * 1.2) * 0.8;
              const grd = ctx.createRadialGradient(px - dy * vib, py + dx * vib, 0, px - dy * vib, py + dx * vib, 3.5);
              grd.addColorStop(0, `rgba(200,200,255,${alpha})`); grd.addColorStop(1, "rgba(100,100,255,0)");
              ctx.beginPath(); ctx.arc(px - dy * vib, py + dx * vib, 3.5, 0, Math.PI * 2);
              ctx.fillStyle = grd; ctx.fill();
            }
          });
        });
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [getConnectedGroup, selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setConnecting(null); setShowColorPicker(null); setSelectedId(null); }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && deletedThought) {
        thoughtsRef.current.splice(deletedThought.index, 0, deletedThought.thought);
        setDeletedThought(null); forceRender((n) => n + 1);
        if (undoTimer.current) clearTimeout(undoTimer.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deletedThought]);

  const addThought = () => {
    if (!input.trim()) return;
    const now = Date.now();
    const W = window.innerWidth, H = window.innerHeight;
    const startX = W / 2, startY = H - 80;
    const targetX = W * 0.3 + Math.random() * W * 0.4;
    const targetY = H * 0.2 + Math.random() * H * 0.45;
    const dx = targetX - startX, dy = targetY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const speed = dist / 8;
    thoughtsRef.current.push({
      id: now, text: input,
      x: startX, y: startY,
      vx: (dx / dist) * speed, vy: (dy / dist) * speed,
      connections: [],
      createdAt: now, updatedAt: now, lastFocusedAt: now,
      layer: 0, depthProgress: 0, opacity: 1, blur: 0, scale: 1, saturation: 1,
      spawnScale: 0, spawnedAt: now + 99999,
    });
    setInput(""); forceRender((n) => n + 1);
  };

  const handleMouseDown = useCallback((e: React.MouseEvent, thought: Thought) => {
    e.stopPropagation(); isDragging.current = false;
    if (longHoverTimer.current) clearTimeout(longHoverTimer.current);
    setLongHoverId(null); setShowColorPicker(null);
    dragLeaderIdRef.current = thought.id;
    leaderPosRef.current = { x: thought.x, y: thought.y };
    dragging.current = { id: thought.id, offsetX: e.clientX - thought.x, offsetY: e.clientY - thought.y };
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return; isDragging.current = true;
      leaderPosRef.current = { x: e.clientX - dragging.current.offsetX, y: e.clientY - dragging.current.offsetY };
    };
    const onUp = () => {
      isDragging.current = false; dragLeaderIdRef.current = null; leaderPosRef.current = null; dragging.current = null;
      window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }, []);

  const handleConnect = useCallback((fromId: number, toId: number) => {
    if (fromId === toId) return;
    thoughtsRef.current.forEach((t) => {
      if (t.id === fromId) { const a = t.connections.includes(toId); t.connections = a ? t.connections.filter((c) => c !== toId) : [...t.connections, toId]; }
      if (t.id === toId) { const a = t.connections.includes(fromId); t.connections = a ? t.connections.filter((c) => c !== fromId) : [...t.connections, fromId]; }
    });
    // 연결 후 그룹 전체 속성 통일 (속성 있는 노드 기준)
    const group = getConnectedGroup(fromId, thoughtsRef.current);
    const dominantAttr = thoughtsRef.current
      .filter((t) => group.includes(t.id) && t.attribute != null)
      .map((t) => t.attribute)[0] ?? null;
    if (dominantAttr !== null) {
      thoughtsRef.current.forEach((t) => { if (group.includes(t.id)) t.attribute = dominantAttr; });
    }
    setConnecting(null); forceRender((n) => n + 1);
  }, []);

  const handleThoughtClick = useCallback((thought: Thought) => {
    if (isDragging.current) return;
    const now = Date.now(), last = lastClickTime.current[thought.id] || 0;
    lastClickTime.current[thought.id] = now;
    if (now - last < 300) { setConnecting(thought.id); return; }
    if (connecting !== null) { handleConnect(connecting, thought.id); return; }
  }, [connecting, handleConnect]);

  const handleMouseEnter = useCallback((thought: Thought) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (longHoverTimer.current) clearTimeout(longHoverTimer.current);
    longHoverTimer.current = setTimeout(() => setLongHoverId(thought.id), 700);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (longHoverTimer.current) clearTimeout(longHoverTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { setLongHoverId(null); setShowColorPicker(null); setPreviewColor(null); }, 200);
  }, []);

  const handleDelete = useCallback((thought: Thought) => {
    const idx = thoughtsRef.current.findIndex((t) => t.id === thought.id);
    setDeletedThought({ thought, index: idx });
    thoughtsRef.current = thoughtsRef.current.filter((t) => t.id !== thought.id);
    setLongHoverId(null); setShowColorPicker(null); setSelectedId(null);
    forceRender((n) => n + 1);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setDeletedThought(null), 3000);
  }, []);

  const handleColorChange = useCallback((id: number, color: string) => {
    const t = thoughtsRef.current.find((t) => t.id === id);
    if (t) t.color = color;
    setShowColorPicker(null); setPreviewColor(null); forceRender((n) => n + 1);
  }, []);

  const handleUngroup = useCallback((thought: Thought) => {
    thoughtsRef.current.forEach((t) => {
      if (t.id === thought.id) t.connections = [];
      else t.connections = t.connections.filter((c) => c !== thought.id);
    });
    setLongHoverId(null); forceRender((n) => n + 1);
  }, []);

  const handlePanelTextSave = useCallback(() => {
    const t = thoughtsRef.current.find((t) => t.id === selectedId);
    if (t && panelEditText.trim()) { t.text = panelEditText.trim(); t.updatedAt = Date.now(); forceRender((n) => n + 1); }
  }, [selectedId, panelEditText]);

  const handlePanelFocus = useCallback((tid: number) => {
    const t = thoughtsRef.current.find((t) => t.id === tid);
    if (t) t.lastFocusedAt = Date.now();
    setSelectedId(tid);
  }, []);

  const formatTime = (ts?: number) => {
    if (!ts) return "—";
    return new Date(ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  };

  const getNodeRender = (thought: Thought, baseOpacity: number, baseBlur: number) => {
    const dist = Math.abs(thought.layer - hudLayer);
    if (dist === 0) return { opacity: thought.id === selectedId ? 1.0 : 0.92, blur: 0, interactive: true, glow: true };
    if (dist === 1) return { opacity: 0, blur: 0, interactive: false, glow: false };
    return { opacity: 0, blur: 0, interactive: false, glow: false };
  };

  const selectedThought = thoughtsRef.current.find((t) => t.id === selectedId) ?? null;
  const connectedThoughts = selectedThought ? thoughtsRef.current.filter((t) => selectedThought.connections.includes(t.id)) : [];
  const groupIds = selectedThought ? getConnectedGroup(selectedThought.id, thoughtsRef.current) : [];
  const groupThoughts = thoughtsRef.current.filter((t) => groupIds.includes(t.id) && t.id !== selectedThought?.id);
  const thoughts = thoughtsRef.current;

  return (
    <div
      className="w-screen h-screen overflow-hidden relative bg-[#050510]"
      onMouseDown={handleBgMouseDown}
      style={{ cursor: bgDragging.current ? "grabbing" : "default" }}
    >
      {/* Three.js 배경 */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <Canvas camera={{ position: [-10, 1.5, 10], fov: 50 }}>
          <Suspense fallback={null}>
            <ParticleSphere camDepth={camDepthRef} />
          </Suspense>
        </Canvas>
      </div>

      <>
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-10" />
        <canvas ref={zoomCanvasRef} className="fixed inset-0 w-full h-full pointer-events-none z-50" />

        {selectedId !== null && <div className="fixed inset-0 z-10" onClick={() => setSelectedId(null)} />}

        {/* 레이어 HUD */}
        <div className="fixed top-6 left-6 z-[60] flex flex-col gap-2 select-none" style={{ opacity: 1, isolation: "isolate" }}>
          <div
            className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl backdrop-blur-md border border-white/10 bg-black/50"
            style={{ transition: "opacity 120ms ease", opacity: hudVisible ? 1 : 0, zIndex: 9999 }}
          >
            <div className="flex gap-1.5 items-center">
              {([0, 1, 2] as const).map((i) => (
                <div key={i} style={{
                  width: hudLayer === i ? 9 : 5, height: hudLayer === i ? 9 : 5, borderRadius: "50%",
                  background: hudLayer === i ? "rgba(190,175,255,1)" : "rgba(255,255,255,0.18)",
                  boxShadow: hudLayer === i ? "0 0 7px rgba(170,150,255,0.8)" : "none",
                  transition: "all 250ms ease",
                }} />
              ))}
            </div>
            <span className="text-xs tracking-tighter font-light" style={{ color: "rgba(200,185,255,0.85)" }}>
              {LAYER_NAMES[hudLayer]}
            </span>
          </div>
        </div>

        {/* 노드 크기 슬라이더 — 우측 하단 고스트 UI */}
        <div className="fixed bottom-8 right-8 z-30 flex flex-col items-end gap-2 opacity-20 hover:opacity-100 transition-opacity duration-500 select-none">
          <span className="text-[8px] uppercase tracking-[0.2em] text-white/35 font-light">Node Size</span>
          <div className="flex items-center gap-3">
            <span className="text-[9px] text-white/25">S</span>
            <input
              type="range" min="0.3" max="2.0" step="0.05"
              value={nodeSize}
              onChange={(e) => setNodeSize(parseFloat(e.target.value))}
              className="w-24 cursor-pointer"
              style={{
                WebkitAppearance: "none", appearance: "none",
                height: "1px",
                background: `linear-gradient(to right, rgba(255,200,120,0.7) ${((nodeSize - 0.3) / 1.7) * 100}%, rgba(255,255,255,0.12) ${((nodeSize - 0.3) / 1.7) * 100}%)`,
                outline: "none", border: "none",
              }}
            />
            <span className="text-[9px] text-white/25">L</span>
          </div>
        </div>

        {/* Thought 카드 */}
        {thoughts.map((thought) => {
          const isLongHovered = longHoverId === thought.id;
          const isSelected = selectedId === thought.id;
          const isHovered = hoveredId === thought.id;
          const currentColor = previewColor && isLongHovered ? previewColor : (thought.color || "rgba(255,255,255,0.08)");
          const isSpawning = (thought.spawnScale ?? 1) < 0.999;
          const { opacity, blur, interactive, glow } = getNodeRender(thought, isSelected || isSpawning ? 1 : thought.opacity, isSelected || isSpawning ? 0 : thought.blur);
          const spawnS = thought.spawnScale ?? 1;

          const visualScale = (isSelected ? 1.08 : isHovered ? Math.max(thought.scale, 1.0) * 1.02 : isLongHovered ? thought.scale * 1.02 : thought.scale) * spawnS;

          // ── Attribute 시각 변수 ──
          const isProblem = thought.attribute === "problem";
          const isAware   = thought.attribute === "aware";

          // ── 중립 배경색 계열 테두리 (차가운 블루/퍼플 계열) ──
          const particleHue = "rgba(180, 185, 220,";
          const glowColor = thought.color
            ? thought.color.replace(/[\d.]+\)$/, "0.6)")
            : `${particleHue}0.4)`;
          const borderColor = thought.color
            ? thought.color.replace(/[\d.]+\)$/, "0.4)")
            : connecting === thought.id
            ? `${particleHue}0.5)`
            : `${particleHue}0.15)`;

          const boxShadowValue = isSelected
            ? `0 0 24px 8px ${glowColor}, 0 0 48px 12px ${glowColor.replace("0.4)", "0.15)")}`
            : glow ? `0 0 12px 2px ${particleHue}0.18)` : "none";

          return (
            <div key={thought.id} className="absolute z-20"
              style={{ left: thought.x, top: thought.y, opacity, filter: `blur(${blur}px) saturate(${thought.saturation})`, transition: "opacity 1.2s ease, filter 1.2s ease", pointerEvents: interactive ? "auto" : "none" }}
              onMouseEnter={() => handleMouseEnter(thought)} onMouseLeave={handleMouseLeave}
            >
              {isLongHovered && interactive && (
                <div className="absolute -top-9 left-0 flex gap-1 z-30" style={{ animation: "fadeInUp 0.1s ease forwards" }}
                  onMouseEnter={() => { if (hideTimer.current) clearTimeout(hideTimer.current); }}>
                  <div className="flex gap-1 px-2 py-1 rounded-xl bg-black/60 border border-white/10 backdrop-blur-md">
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(thought); }} className="w-6 h-6 rounded-lg flex items-center justify-center text-white/50 hover:text-red-400 hover:bg-red-500/20 transition-all hover:scale-110 active:scale-95">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                    </button>
                    <div className="relative">
                      <button onClick={(e) => { e.stopPropagation(); setShowColorPicker(showColorPicker === thought.id ? null : thought.id); }} className="w-6 h-6 rounded-lg flex items-center justify-center text-white/50 hover:text-purple-400 hover:bg-purple-500/20 transition-all hover:scale-110 active:scale-95">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>
                      </button>
                      {showColorPicker === thought.id && (
                        <div className="absolute top-8 left-0 flex gap-1.5 p-2 rounded-xl bg-black/70 border border-white/10 backdrop-blur-md z-40" style={{ animation: "scaleIn 0.1s ease forwards" }} onClick={(e) => e.stopPropagation()} onMouseLeave={() => setPreviewColor(null)}>
                          {PRESET_COLORS.map((c) => (<button key={c} onMouseEnter={() => setPreviewColor(c)} onMouseLeave={() => setPreviewColor(null)} onClick={() => handleColorChange(thought.id, c)} className="w-5 h-5 rounded-full border border-white/20 hover:scale-125 transition-transform" style={{ background: c }} />))}
                        </div>
                      )}
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); handleUngroup(thought); }} className="w-6 h-6 rounded-lg flex items-center justify-center text-white/50 hover:text-orange-400 hover:bg-orange-500/20 transition-all hover:scale-110 active:scale-95">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/><line x1="5" y1="5" x2="19" y2="19"/></svg>
                    </button>
                  </div>
                </div>
              )}
              {(() => {
                const nw = thought.nodeWidth ?? 0;
                const nh = thought.nodeHeight ?? 0;
                const hasSize = nw > 0;
                // 폰트: FS = k * sqrt(W), k=0.9
                const baseFontSize = Math.round(9 + nodeSize * 4);
                const dynFontSize = hasSize ? Math.round(0.9 * Math.sqrt(nw)) : baseFontSize;
                const clampedFont = Math.max(10, Math.min(dynFontSize, 48));
                // depth glow: 노드 클수록 더 밝게
                const sizeRatio = hasSize ? Math.min(nw / 200, 2) : 1;
                const depthBrightness = 1 + sizeRatio * 0.18;
                const depthGlow = hasSize
                  ? `0 0 ${12 + sizeRatio * 20}px ${4 + sizeRatio * 8}px ${glowColor.replace("0.6)", `${0.15 + sizeRatio * 0.2})`)}, 0 0 ${30 + sizeRatio * 40}px ${glowColor.replace("0.6)", "0.08)")}`
                  : boxShadowValue;

                return (
                  <div
                    className={`backdrop-blur-sm border rounded-2xl text-white select-none relative ${connecting === thought.id ? "cursor-crosshair" : connecting !== null ? "cursor-crosshair" : "cursor-grab"}`}
                    style={{
                      background: isProblem ? "rgba(255,60,60,0.15)" : currentColor,
                      borderColor: isProblem ? "rgba(255,80,80,0.6)" : isAware ? "rgba(255,210,60,0.5)" : borderColor,
                      transform: `scale(${visualScale})`,
                      transformOrigin: "top left",
                      boxShadow: isProblem
                        ? (isSelected ? `0 0 24px 8px rgba(255,60,60,0.6), 0 0 48px 12px rgba(255,60,60,0.2)` : `0 0 8px 3px rgba(255,60,60,0.25)`)
                        : isAware
                        ? (isSelected ? `0 0 24px 8px rgba(255,210,60,0.5), 0 0 48px 12px rgba(255,210,60,0.15)` : undefined)
                        : isSelected ? depthGlow : glow ? depthGlow : "none",
                      animation: isProblem
                        ? `heartbeat ${1.3 + Math.sin(thought.id) * 0.25}s ease-in-out infinite`
                        : isAware
                        ? `awarePulse ${2.0 + Math.sin(thought.id) * 0.35}s ease-in-out infinite`
                        : "none",
                      transition: isProblem || isAware ? "border-color 200ms, background 200ms" : "transform 180ms ease-out, box-shadow 220ms ease-out",
                      padding: hasSize ? `${Math.round(clampedFont * 0.5)}px ${Math.round(clampedFont * 0.7)}px` : `${Math.round(2 + nodeSize * 4)}px ${Math.round(6 + nodeSize * 8)}px`,
                      fontSize: `${clampedFont}px`,
                      width: hasSize ? `${nw}px` : "auto",
                      minWidth: "60px",
                      maxWidth: `${window.innerWidth * 0.4}px`,
                      minHeight: hasSize ? `${nh}px` : "auto",
                      filter: `brightness(${depthBrightness})`,
                      overflow: "hidden",
                      wordBreak: "break-word",
                    }}
                    onMouseDown={(e) => { setSelectedId(thought.id); const t = thoughtsRef.current.find((t) => t.id === thought.id); if (t) t.lastFocusedAt = Date.now(); handleMouseDown(e, thought); }}
                    onClick={() => handleThoughtClick(thought)}
                    onMouseEnter={() => setHoveredId(thought.id)} onMouseLeave={() => setHoveredId(null)}
                  >
                    {thought.text}
                    {connecting === thought.id && <span className="ml-2 text-orange-300 text-xs animate-pulse">●</span>}

                    
                  </div>
                );
              })()}
            </div>
          );
        })}

        {connecting !== null && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 backdrop-blur-md bg-blue-500/20 border border-blue-400/30 rounded-full px-6 py-2 text-blue-200 text-sm">
            Click another thought to connect · ESC to cancel
          </div>
        )}
        {deletedThought && (
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 backdrop-blur-md bg-white/10 border border-white/20 rounded-full px-5 py-2 text-white/50 text-xs">
            Ctrl+Z to undo
          </div>
        )}

        {/* 좌측 하단: Mind Minimap */}
        <div className="fixed bottom-8 left-8 z-30 opacity-25 hover:opacity-100 transition-opacity duration-500">
          <CognitiveMinimap
            size={130}
            thoughts={thoughtsRef.current}
            currentLayer={hudLayer}
            onLayerClick={(layer) => {
              camTargetRef.current = layer === 0 ? 0 : layer === 1 ? 1.2 : 2.2;
            }}
          />
        </div>

        {/* 입력창 */}
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 backdrop-blur-md bg-white/5 border border-white/10 rounded-full px-6 py-3 w-96 z-30">
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addThought(); if (e.key === "Escape") setConnecting(null); }}
            placeholder="Add a thought..." className="bg-transparent text-white placeholder-gray-500 outline-none flex-1 text-sm font-light tracking-tighter" />
          <button onClick={addThought} className="text-white/60 hover:text-white transition-colors text-sm">＋</button>
        </div>

        {/* 우측 상세 패널 */}
        <div className="fixed top-0 right-0 h-full w-72 z-40 pointer-events-none"
          style={{ transform: selectedThought ? "translateX(0)" : "translateX(100%)", transition: "transform 300ms cubic-bezier(0.4,0,0.2,1)" }}>
          {selectedThought && (
            <div className="pointer-events-auto h-full flex flex-col gap-4 p-5 border-l border-white/[0.07] bg-white/[0.03] backdrop-blur-2xl overflow-y-auto">
              <div className="flex items-center justify-between">
                <span className="text-white/30 text-xs tracking-tighter uppercase font-light">Detail</span>
                <button onClick={() => setSelectedId(null)} className="text-white/30 hover:text-white/70 transition-colors text-lg leading-none">×</button>
              </div>
              <div className="flex gap-2 items-center">
                {(["Fluent", "Latent", "Dormant"] as const).map((label, i) => (
                  <span key={label} className="text-xs px-2 py-0.5 rounded-full border"
                    style={{ borderColor: selectedThought.layer === i ? "rgba(150,130,255,0.5)" : "rgba(255,255,255,0.08)", color: selectedThought.layer === i ? "rgba(200,185,255,0.9)" : "rgba(255,255,255,0.2)", background: selectedThought.layer === i ? "rgba(120,100,255,0.15)" : "transparent" }}>
                    {label}
                  </span>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-white/30 text-xs">Content</span>
                <textarea value={panelEditText} onChange={(e) => setPanelEditText(e.target.value)} onBlur={handlePanelTextSave}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handlePanelTextSave(); } }}
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none resize-none focus:border-white/25 transition-colors" rows={3} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-white/30 text-xs">Info</span>
                <div className="flex justify-between text-xs text-white/40"><span>Created</span><span>{formatTime(selectedThought.createdAt)}</span></div>
                <div className="flex justify-between text-xs text-white/40"><span>Updated</span><span>{formatTime(selectedThought.updatedAt)}</span></div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-white/30 text-xs">Connections <span className="text-white/20">({connectedThoughts.length})</span></span>
                {connectedThoughts.length === 0 ? <span className="text-white/20 text-xs">None</span> : (
                  <div className="flex flex-col gap-1">
                    {connectedThoughts.map((t) => (<button key={t.id} onClick={() => handlePanelFocus(t.id)} className="text-left px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/60 text-xs hover:text-white hover:bg-white/10 transition-all">{t.text}</button>))}
                  </div>
                )}
              </div>
              {groupThoughts.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-white/30 text-xs">Group <span className="text-white/20">({groupIds.length} nodes)</span></span>
                  <div className="flex flex-col gap-1">
                    {groupThoughts.map((t) => (<button key={t.id} onClick={() => handlePanelFocus(t.id)} className="text-left px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/40 text-xs hover:text-white/70 hover:bg-white/10 transition-all">{t.text}</button>))}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <span className="text-white/30 text-xs">Attribute</span>
                <div className="flex gap-1.5">
                  {(["problem", "aware", null] as const).map((attr) => {
                    const isActive = selectedThought.attribute === attr;
                    const label = attr === "problem" ? "Problem" : attr === "aware" ? "Aware" : "Remove";
                    const activeColor = attr === "problem"
                      ? "rgba(255,80,80,0.3)" : attr === "aware"
                      ? "rgba(255,210,60,0.25)" : "rgba(255,255,255,0.08)";
                    const borderC = attr === "problem"
                      ? "rgba(255,80,80,0.6)" : attr === "aware"
                      ? "rgba(255,210,60,0.5)" : "rgba(255,255,255,0.15)";
                    return (
                      <button key={String(attr)}
                        onClick={() => {
                          const t = thoughtsRef.current.find((t) => t.id === selectedThought.id);
                          if (t) {
                            const group = getConnectedGroup(t.id, thoughtsRef.current);
                            thoughtsRef.current.forEach((n) => {
                              if (group.includes(n.id)) n.attribute = attr;
                            });
                          }
                          forceRender((n) => n + 1);
                        }}
                        className="px-2 py-1 rounded-lg text-xs transition-all"
                        style={{
                          background: isActive ? activeColor : "rgba(255,255,255,0.05)",
                          border: `1px solid ${isActive ? borderC : "rgba(255,255,255,0.1)"}`,
                          color: isActive
                            ? attr === "problem" ? "rgba(255,120,120,0.9)"
                            : attr === "aware" ? "rgba(255,220,80,0.9)"
                            : "rgba(255,255,255,0.5)"
                            : "rgba(255,255,255,0.35)",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-white/30 text-xs">Color</span>
                <div className="flex gap-1.5 flex-wrap">
                  {PRESET_COLORS.map((c) => (<button key={c} onClick={() => handleColorChange(selectedThought.id, c)} className="w-5 h-5 rounded-full border border-white/20 hover:scale-125 transition-transform" style={{ background: c }} />))}
                </div>
              </div>
              <div className="mt-auto pt-4 border-t border-white/10">
                <button onClick={() => handleDelete(selectedThought)} className="w-full py-2 rounded-xl text-white/30 hover:text-red-400 hover:bg-red-500/10 border border-white/10 hover:border-red-500/20 text-xs transition-all">Delete thought</button>
              </div>
            </div>
          )}
        </div>
      </>

      <style jsx global>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        @keyframes heartbeat {
          0%   { transform: scale(1); }
          14%  { transform: scale(1.0435); }
          28%  { transform: scale(1); }
          42%  { transform: scale(1.185); }
          70%  { transform: scale(1); }
          100% { transform: scale(1); }
        }
        @keyframes awarePulse {
          0%, 100% { box-shadow: 0 0 6px 2px rgba(255,220,80,0.3); }
          50%       { box-shadow: 0 0 14px 4px rgba(255,220,80,0.65); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 8px; height: 8px;
          border-radius: 50%;
          background: rgba(255,255,255,0.9);
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}