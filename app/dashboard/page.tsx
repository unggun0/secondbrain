"use client";
import { useState, useRef, useCallback, useEffect } from "react";

// ─────────────────────────────────────────────
// 타입 정의
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

// ─────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────
const PRESET_COLORS = [
  "rgba(255,255,255,0.12)",
  "rgba(100,100,255,0.25)",
  "rgba(255,90,90,0.25)",
  "rgba(80,220,140,0.25)",
  "rgba(255,190,80,0.25)",
  "rgba(200,90,255,0.25)",
  "rgba(80,200,255,0.25)",
];

const LAYER_DURATION = {
  0: 30_000,
  1: 120_000,
  2: Infinity,
};

// ── 레이어 이름 ──
const LAYER_NAMES = ["Active", "Emerging", "Abyssal"] as const;
type LayerIndex = 0 | 1 | 2;

const lerp = (a: number, b: number, t: number) =>
  a + (b - a) * Math.min(Math.max(t, 0), 1);

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const computeVisuals = (layer: LayerIndex, progress: number) => {
  if (layer === 0) return {
    opacity: lerp(1.0, 0.7, progress),
    blur: lerp(0, 1, progress),
    scale: lerp(1.0, 0.92, progress),
    saturation: lerp(1.0, 0.85, progress),
  };
  if (layer === 1) return {
    opacity: lerp(0.7, 0.45, progress),
    blur: lerp(1, 4, progress),
    scale: lerp(0.92, 0.82, progress),
    saturation: lerp(0.85, 0.65, progress),
  };
  return {
    opacity: lerp(0.45, 0.25, progress),
    blur: lerp(4, 8, progress),
    scale: lerp(0.82, 0.72, progress),
    saturation: lerp(0.65, 0.55, progress),
  };
};

// ─────────────────────────────────────────────
// 컴포넌트
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

  // ── 2️⃣ HUD 상태 ──
  const [hudLayer, setHudLayer] = useState<LayerIndex>(0);
  const [hudVisible, setHudVisible] = useState(true);

  // ── 카메라 현재 레이어 ref (렌더 루프에서 직접 읽기용) ──
  const camLayerRef = useRef<LayerIndex>(0);

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

  // ── 1️⃣ 깊이 이동 refs ──
  // camDepth: 0.0~2.99 (0~1=Active, 1~2=Emerging, 2~3=Abyssal)
  const camDepthRef = useRef(0);       // 현재 카메라 깊이
  const camTargetRef = useRef(0);      // 목표 깊이 (휠로 조정)
  const camVelRef = useRef(0);         // 스프링 속도
  const zoomCanvasRef = useRef<HTMLCanvasElement>(null);
  const prevCamLayerRef = useRef<LayerIndex>(0);

  // 입자
  const particlesRef = useRef<{
    x: number; y: number;
    vx: number; vy: number;
    alpha: number; size: number;
    life: number;
  }[]>([]);

  // 레이어 전환 충격
  const transitionRef = useRef({
    active: false, phase: 0, startTime: 0,
  });

  // ─────────────────────────────────────────────
  // 1️⃣ 휠 → 카메라 목표 깊이 조정
  //   휠 위(deltaY 음수) = 더 깊이(depth 증가)
  //   휠 아래(deltaY 양수) = 바깥(depth 감소)
  // ─────────────────────────────────────────────
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // 위 = 더 깊이 = depth 증가
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      camTargetRef.current = Math.min(2.99, Math.max(0, camTargetRef.current + delta));
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // ─────────────────────────────────────────────
  // 효과 캔버스 루프 (카메라 스프링 + 비네팅 + 입자 + 안개)
  // ─────────────────────────────────────────────
  useEffect(() => {
    let fid: number;

    particlesRef.current = Array.from({ length: 80 }, () => ({
      x: Math.random() * (window.innerWidth || 1200),
      y: Math.random() * (window.innerHeight || 800),
      vx: 0, vy: 0, alpha: 0,
      size: Math.random() * 1.5 + 0.5,
      life: Math.random(),
    }));

    const loop = () => {
      const canvas = zoomCanvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) { fid = requestAnimationFrame(loop); return; }

      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // ── 스프링 기반 카메라 이동 (easeInOut 느낌) ──
      const diff = camTargetRef.current - camDepthRef.current;
      camVelRef.current = camVelRef.current * 0.75 + diff * 0.04;
      camDepthRef.current = Math.min(2.99, Math.max(0,
        camDepthRef.current + camVelRef.current
      ));

      const cam = camDepthRef.current;
      const speed = Math.abs(camVelRef.current);
      const moving = speed > 0.0002;

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      // ── 레이어 전환 감지 → HUD 업데이트 ──
      const camLayer = Math.floor(cam) as LayerIndex;
      if (camLayer !== prevCamLayerRef.current) {
        prevCamLayerRef.current = camLayer;
        camLayerRef.current = camLayer;
        transitionRef.current = { active: true, phase: 0, startTime: performance.now() };

        // HUD fade 처리
        setHudVisible(false);
        setTimeout(() => {
          setHudLayer(camLayer);
          setHudVisible(true);
        }, 120);
      }

      // ── 레이어 전환 충격 효과 ──
      if (transitionRef.current.active) {
        const elapsed = performance.now() - transitionRef.current.startTime;
        const t = Math.min(elapsed / 600, 1);
        if (t < 0.25) {
          ctx.fillStyle = `rgba(0,0,0,${easeInOutCubic(t / 0.25) * 0.15})`;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else if (t < 0.5) {
          const spikeAlpha = easeInOutCubic((t - 0.25) / 0.25) * 0.28;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy,
            Math.min(canvas.width, canvas.height) * 0.5);
          g.addColorStop(0, `rgba(150,130,255,${spikeAlpha})`);
          g.addColorStop(1, `rgba(0,0,0,0)`);
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else if (t < 0.8) {
          const swapAlpha = (1 - easeInOutCubic((t - 0.5) / 0.3)) * 0.18;
          ctx.fillStyle = `rgba(5,3,15,${swapAlpha})`;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        if (t >= 1) transitionRef.current.active = false;
      }

      // ── 비네팅 + 수렴선 (이동 중) ──
      if (moving) {
        const v = Math.min(speed * 14, 0.48);
        const vig = ctx.createRadialGradient(cx, cy, 0, cx, cy,
          Math.max(canvas.width, canvas.height) * 0.7);
        vig.addColorStop(0, `rgba(0,0,0,0)`);
        vig.addColorStop(0.55, `rgba(0,0,0,0)`);
        vig.addColorStop(1, `rgba(0,0,0,${v})`);
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        const goingDeep = camVelRef.current > 0;
        for (let i = 0; i < 6; i++) {
          const angle = (i / 6) * Math.PI * 2;
          const ex = cx + Math.cos(angle) * canvas.width;
          const ey = cy + Math.sin(angle) * canvas.height;
          const lg = ctx.createLinearGradient(ex, ey, cx, cy);
          lg.addColorStop(0, `rgba(110,100,255,${v * (goingDeep ? 0.15 : 0.07)})`);
          lg.addColorStop(1, `rgba(110,100,255,0)`);
          ctx.beginPath();
          ctx.moveTo(ex, ey); ctx.lineTo(cx, cy);
          ctx.strokeStyle = lg; ctx.lineWidth = 1; ctx.stroke();
        }
        ctx.restore();
      }

      // ── 입자 흐름 ──
      const spawnRate = speed * 8;
      particlesRef.current.forEach((p) => {
        const dx = cx - p.x;
        const dy = cy - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (moving) {
          if (camVelRef.current > 0) {
            p.vx += (dx / dist) * speed * 10 * 0.09;
            p.vy += (dy / dist) * speed * 10 * 0.09;
          } else {
            p.vx -= (dx / dist) * speed * 7 * 0.07;
            p.vy -= (dy / dist) * speed * 7 * 0.07;
          }
          p.alpha = Math.min(p.alpha + spawnRate * 0.03, 0.25);
        } else {
          p.alpha = Math.max(p.alpha - 0.008, 0);
        }
        p.vx *= 0.87; p.vy *= 0.87;
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width || p.y < 0 || p.y > canvas.height || dist < 6) {
          p.x = Math.random() * canvas.width;
          p.y = Math.random() * canvas.height;
          p.vx = 0; p.vy = 0; p.alpha = 0;
        }
        if (p.alpha > 0.01) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(160,150,255,${p.alpha})`;
          ctx.fill();
        }
      });

      // ── 깊이 안개 ──
      const fog = cam / 3;
      if (fog > 0.02) {
        const haze = lerp(0, 0.32, fog);
        ctx.fillStyle = `rgba(8,4,18,${haze * 0.7})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const clearG = ctx.createRadialGradient(cx, cy, 0, cx, cy,
          Math.min(canvas.width, canvas.height) * 0.38);
        clearG.addColorStop(0, `rgba(8,4,18,0)`);
        clearG.addColorStop(1, `rgba(8,4,18,${haze * 0.5})`);
        ctx.fillStyle = clearG;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
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
      const t = all.find((t) => t.id === cur);
      if (t) t.connections.forEach((c) => { if (!visited.has(c)) queue.push(c); });
    }
    return Array.from(visited);
  }, []);

  // 패널 텍스트 동기화
  useEffect(() => {
    const sel = thoughtsRef.current.find((t) => t.id === selectedId);
    if (sel) setPanelEditText(sel.text);
  }, [selectedId]);

  // ─────────────────────────────────────────────
  // 메인 루프: aging + radial push + physics + canvas
  // ─────────────────────────────────────────────
  useEffect(() => {
    const STIFFNESS = 0.1;
    const DAMPING = 0.80;
    const MIN_DIST = 110;
    const DENSITY_FACTOR = 0.7;

    const loop = () => {
      const now = Date.now();
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const thoughts = thoughtsRef.current;
      const leaderId = dragLeaderIdRef.current;
      const leaderPos = leaderPosRef.current;
      const cam = camDepthRef.current;
      const camSpeed = Math.abs(camVelRef.current);

      const W = window.innerWidth;
      const H = window.innerHeight;
      const cx = W / 2;
      const cy = H / 2;

      // ── 1. Aging ──
      thoughts.forEach((t) => {
        const age = now - t.createdAt;
        let layer: LayerIndex = 0;
        let progress = 0;
        if (age < LAYER_DURATION[0]) {
          layer = 0; progress = age / LAYER_DURATION[0];
        } else if (age < LAYER_DURATION[0] + LAYER_DURATION[1]) {
          layer = 1; progress = (age - LAYER_DURATION[0]) / LAYER_DURATION[1];
        } else {
          layer = 2; progress = Math.min((age - LAYER_DURATION[0] - LAYER_DURATION[1]) / 60_000, 1);
        }
        t.layer = layer;
        t.depthProgress = progress;

        const isFocused = t.id === selectedId;
        const visuals = computeVisuals(layer, progress);
        t.opacity = Math.min(visuals.opacity + (isFocused ? 0.4 : 0), 1.0);
        t.blur = isFocused ? 0 : visuals.blur;
        t.scale = visuals.scale + (isFocused ? 0.08 : 0);
        t.saturation = visuals.saturation + (isFocused ? 0.3 : 0);
      });

      // ── 2. Radial Push: 카메라 이동 시 현재 레이어 노드를 중심 바깥으로 밀어냄 ──
      if (camSpeed > 0.0003) {
        const camLayer = Math.floor(cam) as LayerIndex;
        thoughts.forEach((t) => {
          if (t.layer !== camLayer) return;
          const dx = t.x - cx;
          const dy = t.y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          // camVelRef > 0 = 깊이 진입 → 현재 레이어 바깥으로 밀림
          const pushForce = camVelRef.current * 38 * (1 - t.depthProgress * 0.5);
          t.x += (dx / dist) * pushForce;
          t.y += (dy / dist) * pushForce;
        });
      }

      // ── 3. Cognitive Filtering (깊이 기반 노드 가시성) ──
      const depth = cam;
      const baseCount = thoughts.length;
      const maxVisible = Math.max(3, Math.round(baseCount * Math.exp(-depth * DENSITY_FACTOR)));
      const connGroup = selectedId ? getConnectedGroup(selectedId, thoughts) : [];
      const sorted = [...thoughts].sort((a, b) => {
        const sa = a.id === selectedId ? 4 : connGroup.includes(a.id) ? 3 : a.layer === 0 ? 2 : 1;
        const sb = b.id === selectedId ? 4 : connGroup.includes(b.id) ? 3 : b.layer === 0 ? 2 : 1;
        return sb - sa;
      });
      const visibleIds = new Set(sorted.slice(0, maxVisible).map((t) => t.id));

      // ── 4. Physics ──
      if (leaderId && leaderPos) {
        const group = getConnectedGroup(leaderId, thoughts);
        thoughts.forEach((t) => {
          if (t.id === leaderId) {
            t.x = leaderPos.x; t.y = leaderPos.y; t.vx = 0; t.vy = 0; return;
          }
          if (group.includes(t.id)) {
            const dx = leaderPos.x - t.x;
            const dy = leaderPos.y - t.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            let fx = 0, fy = 0;
            if (dist > 160) {
              const ratio = (dist - 160) / dist;
              fx += dx * ratio * STIFFNESS;
              fy += dy * ratio * STIFFNESS;
            }
            thoughts.forEach((other) => {
              if (other.id === t.id || !group.includes(other.id)) return;
              const rx = t.x - other.x; const ry = t.y - other.y;
              const rd = Math.sqrt(rx * rx + ry * ry);
              if (rd < MIN_DIST && rd > 0) {
                fx += (rx / rd) * (MIN_DIST - rd) * 0.05;
                fy += (ry / rd) * (MIN_DIST - rd) * 0.05;
              }
            });
            t.vx = (t.vx + fx) * DAMPING; t.vy = (t.vy + fy) * DAMPING;
            t.x += t.vx; t.y += t.vy;
          }
          if (!group.includes(t.id)) {
            thoughts.forEach((other) => {
              if (other.id === t.id || !group.includes(other.id)) return;
              const rx = t.x - other.x; const ry = t.y - other.y;
              const rd = Math.sqrt(rx * rx + ry * ry);
              if (rd < MIN_DIST && rd > 0) {
                t.x += rx * (MIN_DIST - rd) / rd * 0.3;
                t.y += ry * (MIN_DIST - rd) / rd * 0.3;
              }
            });
          }
        });
        forceRender((n) => n + 1);
      }

      // ── 5. Canvas 연결선 ──
      if (canvas && ctx) {
        canvas.width = W; canvas.height = H;
        ctx.clearRect(0, 0, W, H);
        const ns = now / 1000;

        thoughts.forEach((thought) => {
          if (!visibleIds.has(thought.id)) return;
          thought.connections.forEach((tid) => {
            const tg = thoughts.find((t) => t.id === tid);
            if (!tg || tid < thought.id || !visibleIds.has(tid)) return;
            const x1 = thought.x + 40, y1 = thought.y + 16;
            const x2 = tg.x + 40, y2 = tg.y + 16;
            const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            if (len < 1) return;
            const dx = (x2 - x1) / len, dy = (y2 - y1) / len;
            const density = Math.max(8, Math.floor(len / 18));
            const lineOp = (thought.opacity + tg.opacity) / 2;
            for (let i = 0; i < density; i++) {
              const phase = i / density;
              const t = ((ns * 60 / len) + phase) % 1;
              const px = x1 + dx * len * t;
              const py = y1 + dy * len * t;
              const dfc = Math.abs(t - 0.5) * 2;
              const alpha = (0.2 + (1 - dfc) * 0.5) * lineOp;
              const vib = Math.sin(ns * 2.5 + i * 1.2) * 0.8;
              const grd = ctx.createRadialGradient(
                px - dy * vib, py + dx * vib, 0,
                px - dy * vib, py + dx * vib, 3.5
              );
              grd.addColorStop(0, `rgba(200,200,255,${alpha})`);
              grd.addColorStop(1, `rgba(100,100,255,0)`);
              ctx.beginPath();
              ctx.arc(px - dy * vib, py + dx * vib, 3.5, 0, Math.PI * 2);
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

  // ─────────────────────────────────────────────
  // 키보드
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // Thought 추가
  // ─────────────────────────────────────────────
  const addThought = () => {
    if (!input.trim()) return;
    const now = Date.now();
    thoughtsRef.current.push({
      id: now, text: input,
      x: 200 + Math.random() * (window.innerWidth - 400),
      y: 100 + Math.random() * (window.innerHeight - 200),
      vx: 0, vy: 0, connections: [],
      createdAt: now, updatedAt: now, lastFocusedAt: now,
      layer: 0, depthProgress: 0,
      opacity: 1, blur: 0, scale: 1, saturation: 1,
    });
    setInput(""); forceRender((n) => n + 1);
  };

  // ─────────────────────────────────────────────
  // 드래그
  // ─────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent, thought: Thought) => {
    e.stopPropagation();
    isDragging.current = false;
    if (longHoverTimer.current) clearTimeout(longHoverTimer.current);
    setLongHoverId(null); setShowColorPicker(null);
    dragLeaderIdRef.current = thought.id;
    leaderPosRef.current = { x: thought.x, y: thought.y };
    dragging.current = { id: thought.id, offsetX: e.clientX - thought.x, offsetY: e.clientY - thought.y };
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      isDragging.current = true;
      leaderPosRef.current = { x: e.clientX - dragging.current.offsetX, y: e.clientY - dragging.current.offsetY };
    };
    const onUp = () => {
      isDragging.current = false;
      dragLeaderIdRef.current = null; leaderPosRef.current = null; dragging.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // 연결
  const handleConnect = useCallback((fromId: number, toId: number) => {
    if (fromId === toId) return;
    thoughtsRef.current.forEach((t) => {
      if (t.id === fromId) {
        const a = t.connections.includes(toId);
        t.connections = a ? t.connections.filter((c) => c !== toId) : [...t.connections, toId];
      }
      if (t.id === toId) {
        const a = t.connections.includes(fromId);
        t.connections = a ? t.connections.filter((c) => c !== fromId) : [...t.connections, fromId];
      }
    });
    setConnecting(null); forceRender((n) => n + 1);
  }, []);

  const handleThoughtClick = useCallback((thought: Thought) => {
    if (isDragging.current) return;
    const now = Date.now();
    const last = lastClickTime.current[thought.id] || 0;
    const isDbl = now - last < 300;
    lastClickTime.current[thought.id] = now;
    if (isDbl) { setConnecting(thought.id); return; }
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
    hideTimer.current = setTimeout(() => {
      setLongHoverId(null); setShowColorPicker(null); setPreviewColor(null);
    }, 200);
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
    setShowColorPicker(null); setPreviewColor(null);
    forceRender((n) => n + 1);
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
    if (t && panelEditText.trim()) {
      t.text = panelEditText.trim(); t.updatedAt = Date.now();
      forceRender((n) => n + 1);
    }
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

  // ─────────────────────────────────────────────
  // 3️⃣ 필터 적용 → 노드별 최종 opacity / blur / pointer-events
  // ─────────────────────────────────────────────
  // 카메라 레이어와 노드 레이어의 거리에 따라 흐림 결정
  // 거리 0 (같은 레이어) → 선명, 클릭 가능
  // 거리 1 (한 단계 차이) → 조금 흐림
  // 거리 2 (두 단계 차이) → 많이 흐림
  const getNodeRender = (thought: Thought, baseOpacity: number, baseBlur: number) => {
    // hudLayer는 React state → 렌더와 완전 동기화
    const dist = Math.abs(thought.layer - hudLayer);

    if (dist === 0) {
      // 같은 레이어: aging 무시하고 항상 선명하게
      return {
        opacity: thought.id === selectedId ? 1.0 : 0.92,
        blur: 0,
        interactive: true,
      };
    }
    if (dist === 1) {
      return {
        opacity: baseOpacity * 0.35,
        blur: baseBlur + 4,
        interactive: false,
      };
    }
    // dist === 2
    return {
      opacity: baseOpacity * 0.1,
      blur: baseBlur + 9,
      interactive: false,
    };
  };

  // 파생 데이터
  const selectedThought = thoughtsRef.current.find((t) => t.id === selectedId) ?? null;
  const connectedThoughts = selectedThought
    ? thoughtsRef.current.filter((t) => selectedThought.connections.includes(t.id))
    : [];
  const groupIds = selectedThought
    ? getConnectedGroup(selectedThought.id, thoughtsRef.current)
    : [];
  const groupThoughts = thoughtsRef.current.filter(
    (t) => groupIds.includes(t.id) && t.id !== selectedThought?.id
  );
  const thoughts = thoughtsRef.current;

  // ─────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-black">



      {/* 연결선 캔버스 */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-10" />
      {/* 효과 캔버스 */}
      <canvas ref={zoomCanvasRef} className="fixed inset-0 w-full h-full pointer-events-none z-50" />

      {/* 빈 공간 클릭 → 패널 닫기 */}
      {selectedId !== null && (
        <div className="fixed inset-0 z-10" onClick={() => setSelectedId(null)} />
      )}

      {/* ══════════════════════════════════════
          레이어 HUD (좌측 상단)
      ══════════════════════════════════════ */}
      <div className="fixed top-6 left-6 z-40 flex flex-col gap-2 select-none">

        {/* 현재 레이어 HUD */}
        <div
          className="flex items-center gap-2.5 px-3.5 py-2 rounded-2xl backdrop-blur-md border border-white/10 bg-black/50"
          style={{ transition: "opacity 120ms ease", opacity: hudVisible ? 1 : 0 }}
        >
          {/* 깊이 도트 인디케이터 */}
          <div className="flex gap-1.5 items-center">
            {([0, 1, 2] as const).map((i) => (
              <div
                key={i}
                style={{
                  width: hudLayer === i ? 9 : 5,
                  height: hudLayer === i ? 9 : 5,
                  borderRadius: "50%",
                  background: hudLayer === i
                    ? "rgba(190,175,255,1)"
                    : "rgba(255,255,255,0.18)",
                  boxShadow: hudLayer === i
                    ? "0 0 7px rgba(170,150,255,0.8)"
                    : "none",
                  transition: "all 250ms ease",
                }}
              />
            ))}
          </div>
          <span
            className="text-xs tracking-widest font-light"
            style={{ color: "rgba(200,185,255,0.85)" }}
          >
            {LAYER_NAMES[hudLayer]}
          </span>
        </div>
      </div>

      {/* ══════════════════════════════════════
          Thought 카드
      ══════════════════════════════════════ */}
      {thoughts.map((thought) => {
        const isLongHovered = longHoverId === thought.id;
        const isSelected = selectedId === thought.id;
        const isHovered = hoveredId === thought.id;
        const currentColor = previewColor && isLongHovered
          ? previewColor : (thought.color || "rgba(255,255,255,0.1)");

        const baseOpacity = isSelected ? 1 : thought.opacity;
        const baseBlur = isSelected ? 0 : thought.blur;
        const { opacity, blur, interactive } = getNodeRender(thought, baseOpacity, baseBlur);

        const visualScale = isSelected ? 1.08
          : isHovered ? Math.max(thought.scale, 1.0) * 1.06
          : isLongHovered ? thought.scale * 1.04
          : thought.scale;

        return (
          <div
            key={thought.id}
            className="absolute z-20"
            style={{
              left: thought.x, top: thought.y,
              opacity,
              filter: `blur(${blur}px) saturate(${thought.saturation})`,
              transition: "opacity 1.2s ease, filter 1.2s ease",
              pointerEvents: interactive ? "auto" : "none",
            }}
            onMouseEnter={() => handleMouseEnter(thought)}
            onMouseLeave={handleMouseLeave}
          >
            {/* 퀵 액션 */}
            {isLongHovered && interactive && (
              <div
                className="absolute -top-9 left-0 flex gap-1 z-30"
                style={{ animation: "fadeInUp 0.1s ease forwards" }}
                onMouseEnter={() => { if (hideTimer.current) clearTimeout(hideTimer.current); }}
              >
                <div className="flex gap-1 px-2 py-1 rounded-xl bg-black/60 border border-white/10 backdrop-blur-md">
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(thought); }}
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-white/50 hover:text-red-400 hover:bg-red-500/20 transition-all hover:scale-110 active:scale-95">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>
                    </svg>
                  </button>
                  <div className="relative">
                    <button onClick={(e) => { e.stopPropagation(); setShowColorPicker(showColorPicker === thought.id ? null : thought.id); }}
                      className="w-6 h-6 rounded-lg flex items-center justify-center text-white/50 hover:text-purple-400 hover:bg-purple-500/20 transition-all hover:scale-110 active:scale-95">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/>
                      </svg>
                    </button>
                    {showColorPicker === thought.id && (
                      <div className="absolute top-8 left-0 flex gap-1.5 p-2 rounded-xl bg-black/70 border border-white/10 backdrop-blur-md z-40"
                        style={{ animation: "scaleIn 0.1s ease forwards" }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseLeave={() => setPreviewColor(null)}>
                        {PRESET_COLORS.map((c) => (
                          <button key={c}
                            onMouseEnter={() => setPreviewColor(c)}
                            onMouseLeave={() => setPreviewColor(null)}
                            onClick={() => handleColorChange(thought.id, c)}
                            className="w-5 h-5 rounded-full border border-white/20 hover:scale-125 transition-transform"
                            style={{ background: c }} />
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); handleUngroup(thought); }}
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-white/50 hover:text-orange-400 hover:bg-orange-500/20 transition-all hover:scale-110 active:scale-95">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                      <line x1="5" y1="5" x2="19" y2="19"/>
                    </svg>
                  </button>
                </div>
              </div>
            )}

            {/* 카드 본체 */}
            <div
              className={`backdrop-blur-sm border rounded-2xl px-4 py-2 text-white text-sm select-none ${
                connecting === thought.id ? "border-blue-400/50 cursor-crosshair"
                : connecting !== null ? "border-white/30 cursor-crosshair hover:border-blue-400/50"
                : "border-white/20 cursor-grab"
              }`}
              style={{
                background: currentColor,
                transform: `scale(${visualScale})`,
                boxShadow: isSelected
                  ? `0 0 16px 4px ${thought.color ? thought.color.replace(/[\d.]+\)$/, "0.5)") : "rgba(100,100,255,0.45)"}`
                  : isLongHovered ? "0 0 18px rgba(100,100,255,0.25)" : "none",
                transition: "transform 180ms ease-out, box-shadow 220ms ease-out",
                animation: "float 4s ease-in-out infinite",
              }}
              onMouseDown={(e) => {
                setSelectedId(thought.id);
                const t = thoughtsRef.current.find((t) => t.id === thought.id);
                if (t) t.lastFocusedAt = Date.now();
                handleMouseDown(e, thought);
              }}
              onClick={() => handleThoughtClick(thought)}
              onMouseEnter={() => setHoveredId(thought.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {thought.text}
              {connecting === thought.id && (
                <span className="ml-2 text-blue-300 text-xs animate-pulse">●</span>
              )}
            </div>
          </div>
        );
      })}

      {/* 연결 모드 안내 */}
      {connecting !== null && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 backdrop-blur-md bg-blue-500/20 border border-blue-400/30 rounded-full px-6 py-2 text-blue-200 text-sm">
          Click another thought to connect · ESC to cancel
        </div>
      )}

      {/* Undo 안내 */}
      {deletedThought && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 backdrop-blur-md bg-white/10 border border-white/20 rounded-full px-5 py-2 text-white/50 text-xs">
          Ctrl+Z to undo
        </div>
      )}

      {/* 입력창 */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 backdrop-blur-md bg-white/5 border border-white/10 rounded-full px-6 py-3 w-96 z-30">
        <input type="text" value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addThought(); if (e.key === "Escape") setConnecting(null); }}
          placeholder="Add a thought..."
          className="bg-transparent text-white placeholder-gray-500 outline-none flex-1 text-sm" />
        <button onClick={addThought} className="text-white/60 hover:text-white transition-colors text-sm">＋</button>
      </div>

      {/* 우측 상세 패널 */}
      <div
        className="fixed top-0 right-0 h-full w-72 z-40 pointer-events-none"
        style={{
          transform: selectedThought ? "translateX(0)" : "translateX(100%)",
          transition: "transform 250ms cubic-bezier(0.4,0,0.2,1)",
        }}
      >
        {selectedThought && (
          <div className="pointer-events-auto h-full flex flex-col gap-4 p-5 border-l border-white/10 bg-black/60 backdrop-blur-xl overflow-y-auto">
            <div className="flex items-center justify-between">
              <span className="text-white/30 text-xs tracking-widest uppercase">Detail</span>
              <button onClick={() => setSelectedId(null)} className="text-white/30 hover:text-white/70 transition-colors text-lg leading-none">×</button>
            </div>

            {/* 레이어 배지 */}
            <div className="flex gap-2 items-center">
              {(["Fluent", "Latent", "Dormant"] as const).map((label, i) => (
                <span key={label} className="text-xs px-2 py-0.5 rounded-full border"
                  style={{
                    borderColor: selectedThought.layer === i ? "rgba(150,130,255,0.5)" : "rgba(255,255,255,0.08)",
                    color: selectedThought.layer === i ? "rgba(200,185,255,0.9)" : "rgba(255,255,255,0.2)",
                    background: selectedThought.layer === i ? "rgba(120,100,255,0.15)" : "transparent",
                  }}>{label}</span>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-white/30 text-xs">Content</span>
              <textarea value={panelEditText}
                onChange={(e) => setPanelEditText(e.target.value)}
                onBlur={handlePanelTextSave}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handlePanelTextSave(); } }}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none resize-none focus:border-white/25 transition-colors"
                rows={3} />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-white/30 text-xs">Info</span>
              <div className="flex justify-between text-xs text-white/40">
                <span>Created</span><span>{formatTime(selectedThought.createdAt)}</span>
              </div>
              <div className="flex justify-between text-xs text-white/40">
                <span>Updated</span><span>{formatTime(selectedThought.updatedAt)}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-white/30 text-xs">
                Connections <span className="text-white/20">({connectedThoughts.length})</span>
              </span>
              {connectedThoughts.length === 0
                ? <span className="text-white/20 text-xs">None</span>
                : <div className="flex flex-col gap-1">
                  {connectedThoughts.map((t) => (
                    <button key={t.id} onClick={() => handlePanelFocus(t.id)}
                      className="text-left px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/60 text-xs hover:text-white hover:bg-white/10 transition-all">
                      {t.text}
                    </button>
                  ))}
                </div>
              }
            </div>

            {groupThoughts.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-white/30 text-xs">
                  Group <span className="text-white/20">({groupIds.length} nodes)</span>
                </span>
                <div className="flex flex-col gap-1">
                  {groupThoughts.map((t) => (
                    <button key={t.id} onClick={() => handlePanelFocus(t.id)}
                      className="text-left px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/40 text-xs hover:text-white/70 hover:bg-white/10 transition-all">
                      {t.text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-white/30 text-xs">Color</span>
              <div className="flex gap-1.5 flex-wrap">
                {PRESET_COLORS.map((color) => (
                  <button key={color} onClick={() => handleColorChange(selectedThought.id, color)}
                    className="w-5 h-5 rounded-full border border-white/20 hover:scale-125 transition-transform"
                    style={{ background: color }} />
                ))}
              </div>
            </div>

            <div className="mt-auto pt-4 border-t border-white/10">
              <button onClick={() => handleDelete(selectedThought)}
                className="w-full py-2 rounded-xl text-white/30 hover:text-red-400 hover:bg-red-500/10 border border-white/10 hover:border-red-500/20 text-xs transition-all">
                Delete thought
              </button>
            </div>
          </div>
        )}
      </div>

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
      `}</style>
    </div>
  );
}