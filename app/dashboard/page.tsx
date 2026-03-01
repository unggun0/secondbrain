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

        ctx.globalAlpha = Math.min(finalAlpha * depthFade, 1.0);
        ctx.drawImage(
          sprite.canvas,
          sx - drawSize, sy - drawSize,
          drawSize * 2, drawSize * 2
        );
        ctx.globalAlpha = 1.0;
      });

      // 천천히 회전 (랜딩의 0.0005와 동일한 속도감)
      rotY.current -= 0.00045;
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
        // 0→0.5: 살짝 어두워짐, 0.5→1: 원래대로
        const dimAlpha = Math.sin(t * Math.PI) * 0.12;
        ctx.fillStyle = `rgba(0,0,0,${dimAlpha})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (t >= 1) transitionRef.current.active = false;
      }

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
    thoughtsRef.current.push({
      id: now, text: input,
      x: 200 + Math.random() * (window.innerWidth - 400),
      y: 100 + Math.random() * (window.innerHeight - 200),
      vx: 0, vy: 0, connections: [],
      createdAt: now, updatedAt: now, lastFocusedAt: now,
      layer: 0, depthProgress: 0, opacity: 1, blur: 0, scale: 1, saturation: 1,
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
          </div>

          {/* Thought 카드 */}
          {thoughts.map((thought) => {
            const isLongHovered = longHoverId === thought.id;
            const isSelected = selectedId === thought.id;
            const isHovered = hoveredId === thought.id;
            const currentColor = previewColor && isLongHovered ? previewColor : (thought.color || "rgba(255,255,255,0.1)");
            const { opacity, blur, interactive, glow } = getNodeRender(thought, isSelected ? 1 : thought.opacity, isSelected ? 0 : thought.blur);
            const visualScale = isSelected ? 1.08 : isHovered ? Math.max(thought.scale, 1.0) * 1.02 : isLongHovered ? thought.scale * 1.02 : thought.scale;
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

          {/* 입력창 */}
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 backdrop-blur-md bg-white/5 border border-white/10 rounded-full px-6 py-3 w-96 z-30">
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addThought(); if (e.key === "Escape") setConnecting(null); }}
              placeholder="Add a thought..." className="bg-transparent text-white placeholder-gray-500 outline-none flex-1 text-sm font-light tracking-tighter" />
            <button onClick={addThought} className="text-white/60 hover:text-white transition-colors text-sm">＋</button>
          </div>

          {/* 우측 상세 패널 */}
          <div className="fixed top-0 right-0 h-full w-72 z-40 pointer-events-none"
            style={{ transform: selectedThought ? "translateX(0)" : "translateX(100%)", transition: "transform 250ms cubic-bezier(0.4,0,0.2,1)" }}>
            {selectedThought && (
              <div className="pointer-events-auto h-full flex flex-col gap-4 p-5 border-l border-white/10 bg-black/60 backdrop-blur-xl overflow-y-auto">
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
      `}</style>
    </div>
  );
}