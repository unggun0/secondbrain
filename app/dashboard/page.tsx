"use client";
import { useState, useRef, useCallback, useEffect } from "react";

// ─────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────
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
  spawnScale: number;  // 생성 시 pop 애니메이션용
  spawnedAt: number;   // 생성 시각
}

// ── Parallax Starfield 파티클 타입 ──
interface StarParticle {
  x: number; y: number; z: number;
  baseX: number; baseY: number;
  vx: number; vy: number;
  alpha: number; size: number;
  speed: number;
  layer: 0 | 1 | 2;
  twinkle: number;
  spriteType: number; // 0~3 (S/M/L/XL)
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
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const computeVisuals = (layer: LayerIndex, progress: number) => {
  if (layer === 0) return { opacity: lerp(1.0, 0.7, progress), blur: lerp(0, 1, progress), scale: lerp(1.0, 0.92, progress), saturation: lerp(1.0, 0.85, progress) };
  if (layer === 1) return { opacity: lerp(0.7, 0.45, progress), blur: lerp(1, 4, progress), scale: lerp(0.92, 0.82, progress), saturation: lerp(0.85, 0.65, progress) };
  return { opacity: lerp(0.45, 0.25, progress), blur: lerp(4, 8, progress), scale: lerp(0.82, 0.72, progress), saturation: lerp(0.65, 0.55, progress) };
};


// ─────────────────────────────────────────────
// Cognitive Load Minimap
// ─────────────────────────────────────────────
function CognitiveMinimap({
  thoughts,
  onLayerClick,
  currentLayer = 0,
  size = 80,
}: {
  thoughts: { layer: 0 | 1 | 2; connections: number[] }[];
  onLayerClick: (layer: 0 | 1 | 2) => void;
  currentLayer?: 0 | 1 | 2;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  // ── 과부하 지수 계산 ──
  // CurrentLayerLoad = (NodesInLayer × 1.0) + (ConnectionsInLayer × 1.5)
  // 레이어 가중치: Active=1.0, Emerging=0.7, Abyssal=0.3 (깊을수록 자연스러운 침전)
  const layerWeights = [1.0, 0.7, 0.3];
  const layerLoads = ([0, 1, 2] as const).map((l) => {
    const nodes = thoughts.filter((t) => t.layer === l);
    const nodeCount = nodes.length;
    const connCount = nodes.reduce((sum, t) => sum + t.connections.length, 0) / 2;
    const raw = nodeCount * 1.0 + connCount * 1.5;
    return raw * layerWeights[l];
  });

  // 상태 판정: 현재 레이어 기준 가장 크게 반영
  const getStatus = (load: number) =>
    load < 30 ? "normal" : load < 60 ? "active" : "overload";

  const layerStatuses = layerLoads.map(getStatus);
  const currentLoad = layerLoads[currentLayer];
  const currentStatus = getStatus(currentLoad);

  // 상태별 색상
  const statusColors: Record<string, [number, number, number]> = {
    normal:   [120, 180, 255],
    active:   [255, 180,  60],
    overload: [255,  60,  60],
  };

  useEffect(() => {
    const W = size, H = size;
    const CX = W / 2, CY = H / 2;
    const sc = size / 80;

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
        { rx: 11 * sc, ry:  8 * sc, z: 2 as const },
      ];

      ellipses.forEach(({ rx, ry, z }) => {
        const load = layerLoads[z];
        const status = layerStatuses[z];
        const [cr, cg, cb] = statusColors[status];
        const isCurrent = z === currentLayer;

        // 과부하 강도 (0~1)
        const intensity = Math.min(load / 60, 1);

        // 박동 속도: normal=느림, active=보통, overload=빠름+떨림
        const pulseSpeed = status === "normal" ? 1.2 : status === "active" ? 2.5 : 5.0;
        const pulse = 0.55 + 0.45 * Math.sin(now * pulseSpeed + z * 1.1);

        // overload: 미세 떨림
        const shake = status === "overload"
          ? Math.sin(now * 28 + z) * 1.5 * sc
          : 0;

        // glow (상태별 색 가스)
        if (intensity > 0.05) {
          const glowAlpha = intensity * (isCurrent ? 0.45 : 0.2) * pulse;
          const grd = ctx.createRadialGradient(
            CX + shake, CY + shake * 0.5, 0,
            CX, CY, rx * 1.6
          );
          grd.addColorStop(0, `rgba(${cr},${cg},${cb},${glowAlpha})`);
          grd.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.ellipse(CX + shake, CY + shake * 0.5, rx * 1.5, ry * 1.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        // overload: 빨간 가스 추가 레이어
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

        // active: 스파크 (신경 발화)
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

        // 타원 테두리
        ctx.beginPath();
        ctx.ellipse(CX + shake, CY + shake * 0.5, rx, ry, 0, 0, Math.PI * 2);
        const strokeAlpha = (isCurrent ? 0.55 : 0.2) * (0.7 + 0.3 * pulse);
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${strokeAlpha})`;
        ctx.lineWidth = isCurrent ? 1.2 : 0.6;
        ctx.stroke();

        // 수평선 (뇌 주름)
        ctx.beginPath();
        ctx.moveTo(CX - rx + shake, CY + shake * 0.3);
        ctx.lineTo(CX + rx + shake, CY + shake * 0.3);
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${strokeAlpha * 0.25})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      });

      // 수직 연결선
      ctx.beginPath();
      ctx.moveTo(CX, CY - 28 * sc);
      ctx.lineTo(CX, CY + 28 * sc);
      ctx.strokeStyle = `rgba(180,180,255,0.1)`;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // 상태 텍스트 + 노드 수
      const total = thoughts.length;
      const statusLabel = currentStatus === "normal" ? "calm"
        : currentStatus === "active" ? "active" : "overload";
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
          const bs = [{ w: 64*sc, h: 44*sc }, { w: 44*sc, h: 30*sc }, { w: 22*sc, h: 16*sc }];
          const b = bs[l];
          return (
            <button key={l} onClick={() => onLayerClick(l)}
              className="absolute rounded-full hover:bg-white/5 transition-colors"
              style={{ width: b.w, height: b.h, left: (size - b.w) / 2, top: (size - b.h) / 2 }}
              title={["Active", "Emerging", "Abyssal"][l]}
            />
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
  // ── 씬 상태 ──
  // "cosmos" = 우주 인트로
  // "entering" = 진입 애니메이션
  // "mindspace" = 노드 공간
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
  const [bgOpacity, setBgOpacity] = useState(0.85);
  const bgOpacityRef = useRef(0.85);
  const bgOpacityTargetRef = useRef(0.85);
  const overloadLevelRef = useRef(0); // 0=normal, 1=active, 2=overload — 파티클 속도 연동

  // ── Parallax Starfield 캔버스 ──
  const starCanvasRef = useRef<HTMLCanvasElement>(null);
  const starAnimRef = useRef<number>(0);
  const starParticlesRef = useRef<StarParticle[]>([]);
  const bgOffsetRef = useRef({ x: 0, y: 0 }); // 시차 오프셋

  // ── 기존 refs ──
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
  // 뉴런 발화 궤적
  const spawnTrailsRef = useRef<{ x1: number; y1: number; x2: number; y2: number; createdAt: number }[]>([]);

  // ─────────────────────────────────────────────
  // 파티클 구체 배경 (랜딩과 동일한 감도, Canvas 2D)
  // ─────────────────────────────────────────────
  useEffect(() => {
    const W = window.innerWidth, H = window.innerHeight;
    const CX = W / 2, CY = H / 2;
    const COUNT = 1500;
    const RADIUS = Math.sqrt(W * W + H * H) * 0.52;

    // 구 표면에 균등 분포 (Fibonacci sphere)
    starParticlesRef.current = Array.from({ length: COUNT }, (_, i) => {
      const phi = Math.acos(-1 + (2 * i) / COUNT);
      const theta = Math.sqrt(COUNT * Math.PI) * phi;
      const r = RADIUS + (Math.random() - 0.5) * RADIUS * 0.18;
      return {
        x: r * Math.sin(phi) * Math.cos(theta),
        y: r * Math.cos(phi),
        z: r * Math.sin(phi) * Math.sin(theta),
        baseX: 0, baseY: 0,
        vx: 0, vy: 0,
        alpha: 0.25 + Math.random() * 0.65,
        size: Math.random() < 0.12
          ? 1.2 + Math.random() * 0.8
          : 0.3 + Math.random() * 0.6,
        speed: 0,
        layer: 0 as 0 | 1 | 2,
        twinkle: Math.random() * Math.PI * 2,
        spriteType: 0, // 아래서 덮어씀
      };
    });

    const rotY = { current: 0 };
    const dpr = window.devicePixelRatio || 1;

    // ── Glow Sprite 4종 미리 굽기 (오프스크린 Canvas) ──
    // 크기/밝기 다른 4가지 → 성단 깊이감
    const SPRITES = [
      { r: 3,  brightness: 1.0,  halo: 0.55 }, // S: 작고 보통
      { r: 6,  brightness: 1.0,  halo: 0.45 }, // M: 중간
      { r: 10, brightness: 1.15, halo: 0.50 }, // L: 크고 밝음
      { r: 16, brightness: 1.3,  halo: 0.60 }, // XL: 가장 밝은 별
    ];

    const glowSprites = SPRITES.map(({ r, brightness, halo }) => {
      const size = r * 4;
      const oc = document.createElement("canvas");
      oc.width = size * 2; oc.height = size * 2;
      const oc2 = oc.getContext("2d")!;
      const cx = size, cy = size;

      // 외곽 halo
      const haloGrd = oc2.createRadialGradient(cx, cy, 0, cx, cy, size);
      haloGrd.addColorStop(0,   `rgba(255,255,255,${halo})`);
      haloGrd.addColorStop(0.35,`rgba(255,255,255,${halo * 0.4})`);
      haloGrd.addColorStop(1,   "rgba(255,255,255,0)");
      oc2.fillStyle = haloGrd;
      oc2.fillRect(0, 0, size * 2, size * 2);

      // 코어 (선명한 흰 점)
      const coreGrd = oc2.createRadialGradient(cx, cy, 0, cx, cy, r * 0.9);
      coreGrd.addColorStop(0,   `rgba(255,255,255,${brightness})`);
      coreGrd.addColorStop(0.5, `rgba(235,240,255,${brightness * 0.85})`);
      coreGrd.addColorStop(1,   "rgba(200,210,255,0)");
      oc2.fillStyle = coreGrd;
      oc2.beginPath();
      oc2.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
      oc2.fill();

      return { canvas: oc, r, size };
    });

    // 파티클마다 sprite 타입 할당
    starParticlesRef.current.forEach((p) => {
      if (p.size > 1.8) p.spriteType = 3;
      else if (p.size > 1.2) p.spriteType = 2;
      else if (p.size > 0.7) p.spriteType = 1;
      else p.spriteType = 0;
    });

    const draw = () => {
      const canvas = starCanvasRef.current;
      if (!canvas) { starAnimRef.current = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext("2d")!;

      // devicePixelRatio 적용: 실제 물리 픽셀 크기로 캔버스 설정
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx.scale(dpr, dpr); // 좌표계는 논리 픽셀 기준 유지

      ctx.clearRect(0, 0, W, H);

      // 배경: 순수 딥블랙
      ctx.fillStyle = "#03030e";
      ctx.fillRect(0, 0, W, H);

      const rot = rotY.current;
      const now = performance.now() / 1000;

      // z-sort: 앞에 있는 파티클이 위에 그려짐
      const sorted = (starParticlesRef.current as typeof starParticlesRef.current).slice().sort((a, b) => {
        const az = a.z * Math.cos(rot) - a.x * Math.sin(rot);
        const bz = b.z * Math.cos(rot) - b.x * Math.sin(rot);
        return az - bz;
      });

      const cam = camDepthRef.current;
      // Active(0): 구 표면 바로 앞 → 화면 꽉 참 (랜딩과 동일한 느낌)
      // Emerging(1): 구 안으로 진입
      // Abyssal(2): 구 중앙, 사방이 파티클
      const cameraZ = cam < 1
        ? lerp(-RADIUS * 0.02, RADIUS * 0.35, cam)  // 표면 바로 앞 → 안쪽
        : cam < 2
        ? lerp(RADIUS * 0.35, RADIUS * 0.7, cam - 1) // 안쪽 → 중앙
        : lerp(RADIUS * 0.7, RADIUS * 0.88, cam - 2); // 중앙 깊이

      const fov = cam < 1
        ? lerp(480, 560, cam)
        : cam < 2
        ? lerp(560, 660, cam - 1)
        : lerp(660, 720, cam - 2);

      sorted.forEach((p, _si) => {
        // Y축 회전 변환
        const rx = p.x * Math.cos(rot) + p.z * Math.sin(rot);
        const ry = p.y;
        const rz = -p.x * Math.sin(rot) + p.z * Math.cos(rot);

        // 카메라 Z 오프셋 적용
        const relZ = rz - cameraZ;
        const sc = relZ < -fov * 0.98 ? 0 : fov / (fov + relZ);
        const sx = CX + rx * sc;
        const sy = CY + ry * sc;

        if (sc <= 0) return;

        // 카메라에서 파티클까지 실제 거리 (가까울수록 크고 밝게)
        const distFromCam = Math.abs(relZ);
        const proximity = Math.max(0, 1 - distFromCam / (RADIUS * 2));

        // 구 안에 있을수록 깊이 대비 강화 (가까운건 확 크게, 먼건 확 희미하게)
        const depthContrast = cam < 1 ? 1.0 : cam < 2 ? lerp(1.0, 2.8, cam - 1) : lerp(2.8, 3.5, cam - 2);
        const depthAlpha = cam < 1
          ? Math.max(0, (rz + RADIUS) / (RADIUS * 2))
          : Math.pow(Math.max(0, proximity), depthContrast);

        const twinkle = 0.85 + 0.15 * Math.sin(now * 0.9 + p.twinkle);

        // 구 안: 가까운 파티클은 훨씬 크게
        const sizeBoost = cam < 1 ? 1.0 : lerp(1.0, 1 + proximity * 2.5, cam - 1);
        const finalAlpha = Math.min(p.alpha * Math.min(sc, 1.6) * depthAlpha * twinkle, 1.0);
        const finalSize = Math.max(p.size * Math.min(sc, 2.2) * sizeBoost, 0.25);

        if (finalAlpha < 0.015) return;

        // ── Glow Sprite 렌더 ──
        // Abyssal 깊어질수록 천천히 어두워지며 사라짐
        const depthFade = cam < 1 ? 1.0
          : cam < 2 ? lerp(1.0, 0.75, cam - 1)
          : lerp(0.75, 0.45, cam - 2);

        const si = p.spriteType ?? 0;
        const sprite = glowSprites[si];
        const drawSize = finalSize * sprite.r * (cam < 1 ? 2.8 : lerp(2.8, 4.5, Math.min(cam - 1, 1)));

        // bgOpacity lerp (슬라이더 부드럽게 반영)
        bgOpacityRef.current = lerp(bgOpacityRef.current, bgOpacityTargetRef.current, 0.06);
        const finalOpacity = Math.min(finalAlpha * depthFade * bgOpacityRef.current, 1.0);
        ctx.globalAlpha = finalOpacity;
        ctx.drawImage(
          sprite.canvas,
          sx - drawSize, sy - drawSize,
          drawSize * 2, drawSize * 2
        );
        ctx.globalAlpha = 1.0;
      });

      // 천천히 회전 (랜딩의 0.0005와 동일한 속도감)
      // 과부하 레벨에 따라 회전 속도 + 불규칙성 증가
      const ol = overloadLevelRef.current;
      const baseSpeed = 0.00045;
      const overloadSpeed = ol === 2
        ? baseSpeed * (2.5 + Math.sin(performance.now() * 0.003) * 1.2) // overload: 불규칙
        : ol === 1
        ? baseSpeed * 1.6  // active: 빠름
        : baseSpeed;       // normal: 평상시
      rotY.current -= overloadSpeed;
      starAnimRef.current = requestAnimationFrame(draw);
    };

    starAnimRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(starAnimRef.current);
  }, []);




  // ─────────────────────────────────────────────
  // mindspace 진입 후 휠 → 깊이 이동
  // ─────────────────────────────────────────────
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.4 : 0.4;
      camTargetRef.current = Math.min(2.99, Math.max(0, camTargetRef.current + delta));
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // ─────────────────────────────────────────────
  // mindspace: 효과 캔버스 루프
  // ─────────────────────────────────────────────
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
      camVelRef.current = camVelRef.current * 0.75 + diff * 0.04;
      camDepthRef.current = Math.min(2.99, Math.max(0, camDepthRef.current + camVelRef.current));

      const cam = camDepthRef.current;
      const speed = Math.abs(camVelRef.current);
      const moving = speed > 0.0002;
      const cx = canvas.width / 2, cy = canvas.height / 2;

      // 레이어 전환 감지
      const camLayer = Math.floor(cam) as LayerIndex;
      if (camLayer !== prevCamLayerRef.current) {
        prevCamLayerRef.current = camLayer;
        camLayerRef.current = camLayer;
        transitionRef.current = { active: true, phase: 0, startTime: performance.now() };
        setHudVisible(false);
        setTimeout(() => { setHudLayer(camLayer); setHudVisible(true); }, 120);
      }

      // Breath 전환: 0.8초 dimming (레이어 전환 시)
      if (transitionRef.current.active) {
        const t = Math.min((performance.now() - transitionRef.current.startTime) / 800, 1);
        const dimAlpha = Math.sin(t * Math.PI) * 0.12;
        ctx.fillStyle = `rgba(0,0,0,${dimAlpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (t >= 1) transitionRef.current.active = false;
      }

      const nowMs = Date.now();

      fid = requestAnimationFrame(loop);
    };
    fid = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(fid);
  }, []);

  // ─────────────────────────────────────────────
  // BFS
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // 메인 루프 (mindspace only)
  // ─────────────────────────────────────────────
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

        // spawn scale pop: 0 → 1.4 → 1.0 elastic (600ms) — spawnedAt 도달 후 시작
        if (!t.spawnScale) t.spawnScale = 0;
        if (t.spawnScale < 0.999) {
          const elapsed = now - t.spawnedAt;
          if (elapsed < 0) {
            t.spawnScale = 0; // 아직 날아가는 중
          } else {
            const p = Math.min(elapsed / 600, 1);
            const elastic = p === 1 ? 1
              : 1 - Math.pow(2, -10 * p) * Math.cos(p * Math.PI * 2.5);
            t.spawnScale = Math.max(0, elastic);
          }
        } else {
          t.spawnScale = 1;
        }

        // 날아가는 중: 타겟으로 spring 이동 + scale 0.2→1.0
        if (t.spawnedAt > now) {
          // 초기 타겟 저장
          if (!(t as any)._tx) {
            (t as any)._tx = t.x + t.vx * 8;
            (t as any)._ty = t.y + t.vy * 8;
          }
          const tx = (t as any)._tx, ty = (t as any)._ty;
          const tdx = tx - t.x, tdy = ty - t.y;
          const tdist = Math.sqrt(tdx * tdx + tdy * tdy);

          // scale: 거리 기반 0.2→1.0
          const W2 = window.innerWidth, H2 = window.innerHeight;
          const startDist = Math.sqrt(Math.pow(tx - W2/2, 2) + Math.pow(ty - (H2-80), 2));
          t.spawnScale = lerp(0.2, 1.0, Math.max(0, 1 - tdist / (startDist || 1)));

          if (tdist > 6) {
            // 타겟 방향으로 강하게 당기기
            t.vx = t.vx * 0.7 + (tdx / tdist) * Math.min(tdist * 0.4, 28);
            t.vy = t.vy * 0.7 + (tdy / tdist) * Math.min(tdist * 0.4, 28);
            t.x += t.vx; t.y += t.vy;
          } else {
            // 도달 — ring 효과 시작
            t.x = tx; t.y = ty;
            t.vx = 0; t.vy = 0;
            t.spawnScale = 1;
            t.spawnedAt = now; // ring 트리거
          }
        }
      });

      // Radial Push
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

      // Cognitive Filtering
      const baseCount = thoughts.length;
      const maxVisible = Math.max(3, Math.round(baseCount * Math.exp(-cam * DENSITY_FACTOR)));
      const connGroup = selectedId ? getConnectedGroup(selectedId, thoughts) : [];
      const sorted = [...thoughts].sort((a, b) => {
        const sa = a.id === selectedId ? 4 : connGroup.includes(a.id) ? 3 : a.layer === 0 ? 2 : 1;
        const sb = b.id === selectedId ? 4 : connGroup.includes(b.id) ? 3 : b.layer === 0 ? 2 : 1;
        return sb - sa;
      });
      const visibleIds = new Set(sorted.slice(0, maxVisible).map((t) => t.id));

      // 항상 작동: 모든 노드 간 반발 (부드럽게 밀리기)
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

      // 반발 움직임 있을 때만 리렌더
      const hasMotion = thoughts.some(t => Math.abs(t.vx) > 0.01 || Math.abs(t.vy) > 0.01);
      if (hasMotion) forceRender((n) => n + 1);

      // 현재 레이어 과부하 지수 계산 → overloadLevelRef 업데이트
      const curLayer = camLayerRef.current;
      const curNodes = thoughts.filter(t => t.layer === curLayer);
      const curConns = curNodes.reduce((sum, t) => sum + t.connections.length, 0) / 2;
      const load = curNodes.length * 1.0 + curConns * 1.5;
      overloadLevelRef.current = load < 30 ? 0 : load < 60 ? 1 : 2;

      // Physics
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

      // Canvas 연결선
      if (canvas && ctx) {
        canvas.width = window.innerWidth; canvas.height = window.innerHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const ns = now / 1000;
        thoughts.forEach((th) => {
          if (!visibleIds.has(th.id) || th.opacity < 0.04) return;
          th.connections.forEach((tid) => {
            const tg = thoughts.find((t) => t.id === tid);
            if (!tg || tid < th.id || !visibleIds.has(tid) || tg.opacity < 0.04) return;
            const x1 = th.x + 40, y1 = th.y + 16, x2 = tg.x + 40, y2 = tg.y + 16;
            const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2); if (len < 1) return;
            const dx = (x2 - x1) / len, dy = (y2 - y1) / len;
            const density = Math.max(8, Math.floor(len / 18));
            // C. 레이어별 line-opacity (디자이너 스펙)
            const baseLineOp = camDepthRef.current < 1 ? 0.6
              : camDepthRef.current < 2 ? 0.3 : 0.1;
            const lineOp = ((th.opacity + tg.opacity) / 2) * baseLineOp;
            for (let i = 0; i < density; i++) {
              const t = ((ns * 60 / len) + i / density) % 1;
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

  // 키보드 (mindspace)
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
    // 시작: 입력창 위치 (하단 중앙)
    const startX = W / 2;
    const startY = H - 80;
    // 타겟: 중앙 근처 랜덤
    const targetX = W * 0.3 + Math.random() * W * 0.4;
    const targetY = H * 0.2 + Math.random() * H * 0.45;
    // 빠른 발사 (전기 신호 느낌 — dist/8로 빠르게)
    const dx = targetX - startX, dy = targetY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const speed = dist / 8;
    thoughtsRef.current.push({
      id: now, text: input,
      x: startX, y: startY,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      connections: [],
      createdAt: now, updatedAt: now, lastFocusedAt: now,
      layer: 0, depthProgress: 0, opacity: 1, blur: 0, scale: 1, saturation: 1,
      spawnScale: 0, spawnedAt: now + 99999, // 도착 전까지 pop 안 터짐
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
    if (dist === 1) return { opacity: baseOpacity * 0.28, blur: 15, interactive: false, glow: false };
    return { opacity: baseOpacity * 0.07, blur: 28, interactive: false, glow: false };
  };

  const selectedThought = thoughtsRef.current.find((t) => t.id === selectedId) ?? null;
  const connectedThoughts = selectedThought ? thoughtsRef.current.filter((t) => selectedThought.connections.includes(t.id)) : [];
  const groupIds = selectedThought ? getConnectedGroup(selectedThought.id, thoughtsRef.current) : [];
  const groupThoughts = thoughtsRef.current.filter((t) => groupIds.includes(t.id) && t.id !== selectedThought?.id);
  const thoughts = thoughtsRef.current;

  // ─────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-[#050510]">

      {/* ══ 별 구체 배경 (항상) ══ */}
      <canvas ref={starCanvasRef} className="fixed inset-0 w-full h-full pointer-events-none z-0" />

      {/* ══ 마인드스페이스 UI ══ */}
      <>
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-10" />
        <canvas ref={zoomCanvasRef} className="fixed inset-0 w-full h-full pointer-events-none z-50" />

        {selectedId !== null && <div className="fixed inset-0 z-10" onClick={() => setSelectedId(null)} />}

          {/* 레이어 HUD */}
          <div className="fixed top-6 left-6 z-40 flex flex-col gap-2 select-none">
            <div
              className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl backdrop-blur-md border border-white/10 bg-black/50"
              style={{ transition: "opacity 120ms ease", opacity: hudVisible ? 1 : 0 }}
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
            {/* Ambient 슬라이더 — HUD 바로 아래 */}
            <div className="flex items-center gap-3 px-1 opacity-40 hover:opacity-100 transition-opacity duration-500">
              <span className="text-[8px] uppercase tracking-[0.2em] text-white/35 font-light w-12">Ambient</span>
              <input
                type="range" min="0" max="1" step="0.01"
                value={bgOpacity}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setBgOpacity(v);
                  bgOpacityTargetRef.current = v;
                }}
                className="w-20 cursor-pointer"
                style={{
                  WebkitAppearance: "none", appearance: "none",
                  height: "1px",
                  background: `linear-gradient(to right, rgba(255,255,255,0.6) ${bgOpacity * 100}%, rgba(255,255,255,0.12) ${bgOpacity * 100}%)`,
                  outline: "none", border: "none",
                }}
              />
            </div>
          </div>

          {/* Thought 카드 */}
          {thoughts.map((thought) => {
            const isLongHovered = longHoverId === thought.id;
            const isSelected = selectedId === thought.id;
            const isHovered = hoveredId === thought.id;
            const currentColor = previewColor && isLongHovered ? previewColor : (thought.color || "rgba(255,255,255,0.1)");
            const isSpawning = (thought.spawnScale ?? 1) < 0.999;
            const { opacity, blur, interactive, glow } = getNodeRender(thought, isSelected || isSpawning ? 1 : thought.opacity, isSelected || isSpawning ? 0 : thought.blur);
            const spawnS = thought.spawnScale ?? 1;
            const visualScale = (isSelected ? 1.08 : isHovered ? Math.max(thought.scale, 1.0) * 1.02 : isLongHovered ? thought.scale * 1.02 : thought.scale) * spawnS;
            const glowColor = thought.color ? thought.color.replace(/[\d.]+\)$/, "0.6)") : hudLayer === 0 ? "rgba(180,200,255,0.5)" : hudLayer === 1 ? "rgba(140,100,255,0.5)" : "rgba(80,100,255,0.55)";
            const boxShadowValue = isSelected
              ? `0 0 24px 8px ${glowColor}, 0 0 48px 12px ${glowColor.replace("0.6)", "0.2)")}`
              : glow ? `0 0 14px 3px ${glowColor.replace("0.6)", "0.35)")}` : isLongHovered ? "0 0 18px rgba(100,100,255,0.25)" : "none";

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
                <div
                  className={`backdrop-blur-sm border rounded-2xl px-4 py-2 text-white text-sm select-none ${connecting === thought.id ? "border-blue-400/50 cursor-crosshair" : connecting !== null ? "border-white/30 cursor-crosshair hover:border-blue-400/50" : "border-white/20 cursor-grab"}`}
                  style={{ background: currentColor, transform: `scale(${visualScale})`, boxShadow: boxShadowValue, transition: "transform 180ms ease-out, box-shadow 220ms ease-out", animation: "none" }}
                  onMouseDown={(e) => { setSelectedId(thought.id); const t = thoughtsRef.current.find((t) => t.id === thought.id); if (t) t.lastFocusedAt = Date.now(); handleMouseDown(e, thought); }}
                  onClick={() => handleThoughtClick(thought)}
                  onMouseEnter={() => setHoveredId(thought.id)} onMouseLeave={() => setHoveredId(null)}
                >
                  {thought.text}
                  {connecting === thought.id && <span className="ml-2 text-blue-300 text-xs animate-pulse">●</span>}
                </div>
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

          {/* 좌측 하단: Mind Minimap (크게) */}
          <div className="fixed bottom-8 left-8 z-30 opacity-78 hover:opacity-100 transition-opacity duration-500">
            <CognitiveMinimap
              size={220}
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
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes scrollDot {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(6px); opacity: 0.9; }
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 8px; height: 8px;
          border-radius: 50%;
          background: rgba(255,255,255,0.9);
          cursor: pointer;
          box-shadow: 0 0 6px rgba(255,255,255,0.5);
        }
        input[type=range]::-moz-range-thumb {
          width: 8px; height: 8px;
          border-radius: 50%;
          background: rgba(255,255,255,0.9);
          border: none;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}