"use client";
import DigitalLoomBackground from "@/components/ui/digital-loom-background";
import { useState, useRef, useCallback, useEffect } from "react";

interface Thought {
  id: number;
  text: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  connections: number[];
  color?: string;
  createdAt?: number;
  updatedAt?: number;
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
  
  // 모든 thought 데이터를 ref로 관리 (physics loop에서 직접 수정)
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

  const getConnectedGroup = useCallback((id: number, all: Thought[]): number[] => {
    const visited = new Set<number>();
    const queue = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const thought = all.find((t) => t.id === current);
      if (thought) thought.connections.forEach((cid) => { if (!visited.has(cid)) queue.push(cid); });
    }
    return Array.from(visited);
  }, []);

  // 메인 루프: physics + canvas 한 번에
  useEffect(() => {
    const STIFFNESS = 0.1;
    const DAMPING = 0.80;
    const MIN_DIST = 110;

    const loop = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const thoughts = thoughtsRef.current;
      const leaderId = dragLeaderIdRef.current;
      const leaderPos = leaderPosRef.current;

      // --- Physics ---
      if (leaderId && leaderPos) {
        const group = getConnectedGroup(leaderId, thoughts);

        thoughts.forEach((t) => {
          if (t.id === leaderId) {
            t.x = leaderPos.x;
            t.y = leaderPos.y;
            t.vx = 0;
            t.vy = 0;
            return;
          }

          if (group.includes(t.id)) {
            const dx = leaderPos.x - t.x;
            const dy = leaderPos.y - t.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const groupRadius = 160;

            let fx = 0;
            let fy = 0;

            if (dist > groupRadius) {
              const ratio = (dist - groupRadius) / dist;
              fx += dx * ratio * STIFFNESS;
              fy += dy * ratio * STIFFNESS;
            }

            // 멤버 간 반발
            thoughts.forEach((other) => {
              if (other.id === t.id) return;
              if (!group.includes(other.id)) return;
              const rx = t.x - other.x;
              const ry = t.y - other.y;
              const rd = Math.sqrt(rx * rx + ry * ry);
              if (rd < MIN_DIST && rd > 0) {
                fx += (rx / rd) * (MIN_DIST - rd) * 0.05;
                fy += (ry / rd) * (MIN_DIST - rd) * 0.05;
              }
            });

            t.vx = (t.vx + fx) * DAMPING;
            t.vy = (t.vy + fy) * DAMPING;
            t.x += t.vx;
            t.y += t.vy;
          }

          // 비그룹 충돌 반발
          if (!group.includes(t.id)) {
            thoughts.forEach((other) => {
              if (other.id === t.id) return;
              if (group.includes(other.id)) {
                const rx = t.x - other.x;
                const ry = t.y - other.y;
                const rd = Math.sqrt(rx * rx + ry * ry);
                if (rd < MIN_DIST && rd > 0) {
                  const force = (MIN_DIST - rd) / rd * 0.3;
                  t.x += rx * force;
                  t.y += ry * force;
                }
              }
            });
          }
        });

        forceRender((n) => n + 1);
      }

      // --- Canvas ---
      if (canvas && ctx) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const now = Date.now() / 1000;

        thoughts.forEach((thought) => {
          thought.connections.forEach((targetId) => {
            const target = thoughts.find((t) => t.id === targetId);
            if (!target || targetId < thought.id) return;
            const x1 = thought.x + 40;
            const y1 = thought.y + 16;
            const x2 = target.x + 40;
            const y2 = target.y + 16;
            const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            if (len < 1) return;
            const dx = (x2 - x1) / len;
            const dy = (y2 - y1) / len;
            const density = Math.max(8, Math.floor(len / 18));
            const speed = 60;
            for (let i = 0; i < density; i++) {
              const phase = i / density;
              const t = ((now * speed / len) + phase) % 1;
              const px = x1 + dx * len * t;
              const py = y1 + dy * len * t;
              const distFromCenter = Math.abs(t - 0.5) * 2;
              const alpha = 0.2 + (1 - distFromCenter) * 0.5;
              const vibration = Math.sin(now * 2.5 + i * 1.2) * 0.8;
              const perpX = -dy * vibration;
              const perpY = dx * vibration;
              const gradient = ctx.createRadialGradient(px + perpX, py + perpY, 0, px + perpX, py + perpY, 3.5);
              gradient.addColorStop(0, `rgba(200,200,255,${alpha})`);
              gradient.addColorStop(1, `rgba(100,100,255,0)`);
              ctx.beginPath();
              ctx.arc(px + perpX, py + perpY, 3.5, 0, Math.PI * 2);
              ctx.fillStyle = gradient;
              ctx.fill();
            }
          });
        });
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [getConnectedGroup]);

  // ESC + Ctrl+Z
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setConnecting(null); setShowColorPicker(null); }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && deletedThought) {
        thoughtsRef.current.splice(deletedThought.index, 0, deletedThought.thought);
        setDeletedThought(null);
        forceRender((n) => n + 1);
        if (undoTimer.current) clearTimeout(undoTimer.current);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deletedThought]);

  const addThought = () => {
    if (!input.trim()) return;
    thoughtsRef.current.push({
      id: Date.now(),
      text: input,
      x: 200 + Math.random() * (window.innerWidth - 400),
      y: 100 + Math.random() * (window.innerHeight - 200),
      vx: 0, vy: 0,
      connections: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setInput("");
    forceRender((n) => n + 1);
  };

  const handleMouseDown = useCallback((e: React.MouseEvent, thought: Thought) => {
    e.stopPropagation();
    isDragging.current = false;
    if (longHoverTimer.current) clearTimeout(longHoverTimer.current);
    setLongHoverId(null);
    setShowColorPicker(null);

    dragLeaderIdRef.current = thought.id;
    leaderPosRef.current = { x: thought.x, y: thought.y };
    dragging.current = { id: thought.id, offsetX: e.clientX - thought.x, offsetY: e.clientY - thought.y };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      isDragging.current = true;
      const { offsetX, offsetY } = dragging.current;
      leaderPosRef.current = { x: e.clientX - offsetX, y: e.clientY - offsetY };
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      dragLeaderIdRef.current = null;
      leaderPosRef.current = null;
      dragging.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, []);

  const handleConnect = useCallback((fromId: number, toId: number) => {
    if (fromId === toId) return;
    const thoughts = thoughtsRef.current;
    thoughts.forEach((t) => {
      if (t.id === fromId) {
        const already = t.connections.includes(toId);
        t.connections = already ? t.connections.filter((c) => c !== toId) : [...t.connections, toId];
      }
      if (t.id === toId) {
        const already = t.connections.includes(fromId);
        t.connections = already ? t.connections.filter((c) => c !== fromId) : [...t.connections, fromId];
      }
    });
    setConnecting(null);
    forceRender((n) => n + 1);
}, []);

  const handleThoughtClick = useCallback((thought: Thought) => {
    if (isDragging.current) return;
    const now = Date.now();
    const last = lastClickTime.current[thought.id] || 0;
    const isDoubleClick = now - last < 300;
    lastClickTime.current[thought.id] = now;
    if (isDoubleClick) { setConnecting(thought.id); return; }
    if (connecting !== null) { handleConnect(connecting, thought.id); return; }
  }, [connecting, handleConnect]);

  const handleMouseEnter = useCallback((thought: Thought) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (longHoverTimer.current) clearTimeout(longHoverTimer.current);
    longHoverTimer.current = setTimeout(() => {
      setLongHoverId(thought.id);
    }, 700);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (longHoverTimer.current) clearTimeout(longHoverTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setLongHoverId(null);
      setShowColorPicker(null);
      setPreviewColor(null);
    }, 200);
  }, []);

  const handleDelete = useCallback((thought: Thought) => {
    const index = thoughtsRef.current.findIndex((t) => t.id === thought.id);
    setDeletedThought({ thought, index });
    thoughtsRef.current = thoughtsRef.current.filter((t) => t.id !== thought.id);
    setLongHoverId(null);
    setShowColorPicker(null);
    forceRender((n) => n + 1);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setDeletedThought(null), 3000);
  }, []);

  const handleColorChange = useCallback((id: number, color: string) => {
    const t = thoughtsRef.current.find((t) => t.id === id);
    if (t) t.color = color;
    setShowColorPicker(null);
    setPreviewColor(null);
    forceRender((n) => n + 1);
  }, []);

  const handleUngroup = useCallback((thought: Thought) => {
    thoughtsRef.current.forEach((t) => {
      if (t.id === thought.id) t.connections = [];
      else t.connections = t.connections.filter((c) => c !== thought.id);
    });
    setLongHoverId(null);
    forceRender((n) => n + 1);
  }, []);

  // 패널용 편집 상태
  const [panelEditText, setPanelEditText] = useState<string>("");

  // selectedId 변경 시 편집 텍스트 동기화
  useEffect(() => {
    const selected = thoughtsRef.current.find((t) => t.id === selectedId);
    if (selected) setPanelEditText(selected.text);
  }, [selectedId]);

  const handlePanelTextSave = useCallback(() => {
    const t = thoughtsRef.current.find((t) => t.id === selectedId);
    if (t && panelEditText.trim()) {
      t.text = panelEditText.trim();
      t.updatedAt = Date.now();
      forceRender((n) => n + 1);
    }
  }, [selectedId, panelEditText]);

  const handlePanelFocus = useCallback((targetId: number) => {
    const target = thoughtsRef.current.find((t) => t.id === targetId);
    if (!target) return;
    setSelectedId(targetId);
  }, []);

  const formatTime = (ts?: number) => {
    if (!ts) return "—";
    return new Date(ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  };

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

  return (
    <div className="w-screen h-screen overflow-hidden relative bg-black">
      <div className="absolute inset-0 pointer-events-none">
        <DigitalLoomBackground threadColor="rgba(100, 100, 255, 0.05)" threadCount={30}>
          <div />
        </DigitalLoomBackground>
      </div>

<canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-10" />

      {/* 빈 공간 클릭 시 패널 닫기 */}
      {selectedId !== null && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setSelectedId(null)}
        />
      )}
      {thoughts.map((thought) => {
        const isLongHovered = longHoverId === thought.id;
        const currentColor = previewColor && isLongHovered ? previewColor : (thought.color || "rgba(255,255,255,0.1)");

        return (
          <div
            key={thought.id}
            className="absolute z-20"
            style={{ left: thought.x, top: thought.y }}
            onMouseEnter={() => handleMouseEnter(thought)}
            onMouseLeave={handleMouseLeave}
          >
            {isLongHovered && (
              <div
                className="absolute -top-9 left-0 flex gap-1 z-30"
                style={{ animation: "fadeInUp 0.1s ease forwards" }}
                onMouseEnter={() => { if (hideTimer.current) clearTimeout(hideTimer.current); }}
              >
                <div className="flex gap-1 px-2 py-1 rounded-xl bg-black/60 border border-white/10 backdrop-blur-md">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(thought); }}
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-white/50 hover:text-red-400 hover:bg-red-500/20 transition-all hover:scale-110 active:scale-95"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14H6L5 6"/>
                      <path d="M10 11v6M14 11v6"/>
                    </svg>
                  </button>

                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowColorPicker(showColorPicker === thought.id ? null : thought.id); }}
                      className="w-6 h-6 rounded-lg flex items-center justify-center text-white/50 hover:text-purple-400 hover:bg-purple-500/20 transition-all hover:scale-110 active:scale-95"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <circle cx="12" cy="12" r="4"/>
                      </svg>
                    </button>
                    {showColorPicker === thought.id && (
                      <div
                        className="absolute top-8 left-0 flex gap-1.5 p-2 rounded-xl bg-black/70 border border-white/10 backdrop-blur-md z-40"
                        style={{ animation: "scaleIn 0.1s ease forwards" }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseLeave={() => setPreviewColor(null)}
                      >
                        {PRESET_COLORS.map((color) => (
                          <button
                            key={color}
                            onMouseEnter={() => setPreviewColor(color)}
                            onMouseLeave={() => setPreviewColor(null)}
                            onClick={() => handleColorChange(thought.id, color)}
                            className="w-5 h-5 rounded-full border border-white/20 hover:scale-125 transition-transform"
                            style={{ background: color }}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={(e) => { e.stopPropagation(); handleUngroup(thought); }}
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-white/50 hover:text-orange-400 hover:bg-orange-500/20 transition-all hover:scale-110 active:scale-95"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                      <line x1="5" y1="5" x2="19" y2="19"/>
                    </svg>
                  </button>
                </div>
              </div>
            )}

            <div
              className={`backdrop-blur-sm border rounded-2xl px-4 py-2 text-white text-sm select-none transition-all duration-150 ${
                connecting === thought.id
                  ? "border-blue-400/50 cursor-crosshair"
                  : connecting !== null
                  ? "border-white/30 cursor-crosshair hover:border-blue-400/50"
                  : "border-white/20 cursor-grab"
              }`}
              style={{
                background: currentColor,
                transform: selectedId === thought.id
                  ? "scale(1.08)"
                  : hoveredId === thought.id
                  ? "scale(1.06)"
                  : isLongHovered
                  ? "scale(1.04)"
                  : "scale(1)",
                boxShadow: selectedId === thought.id
                  ? `0 0 16px 4px ${thought.color
                      ? thought.color.replace(/[\d.]+\)$/, "0.5)")
                      : "rgba(100,100,255,0.45)"}`
                  : isLongHovered
                  ? "0 0 18px rgba(100,100,255,0.25)"
                  : "none",
                transition: "transform 180ms ease-out, box-shadow 220ms ease-out",
                animation: "float 4s ease-in-out infinite",
              }}
              onMouseDown={(e) => {
                setSelectedId(thought.id);
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

      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 backdrop-blur-md bg-white/5 border border-white/10 rounded-full px-6 py-3 w-96 z-30">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addThought();
            if (e.key === "Escape") setConnecting(null);
          }}
          placeholder="Add a thought..."
          className="bg-transparent text-white placeholder-gray-500 outline-none flex-1 text-sm"
        />
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
            
            {/* 헤더 */}
            <div className="flex items-center justify-between">
              <span className="text-white/30 text-xs tracking-widest uppercase">Detail</span>
              <button
                onClick={() => setSelectedId(null)}
                className="text-white/30 hover:text-white/70 transition-colors text-lg leading-none"
              >×</button>
            </div>

            {/* 텍스트 편집 */}
            <div className="flex flex-col gap-2">
              <span className="text-white/30 text-xs">Content</span>
              <textarea
                value={panelEditText}
                onChange={(e) => setPanelEditText(e.target.value)}
                onBlur={handlePanelTextSave}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handlePanelTextSave(); } }}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none resize-none focus:border-white/25 transition-colors"
                rows={3}
              />
            </div>

            {/* 생성/수정 시간 */}
            <div className="flex flex-col gap-1.5">
              <span className="text-white/30 text-xs">Info</span>
              <div className="flex justify-between text-xs text-white/40">
                <span>Created</span><span>{formatTime(selectedThought.createdAt)}</span>
              </div>
              <div className="flex justify-between text-xs text-white/40">
                <span>Updated</span><span>{formatTime(selectedThought.updatedAt)}</span>
              </div>
            </div>

            {/* 연결된 Thought */}
            <div className="flex flex-col gap-2">
              <span className="text-white/30 text-xs">
                Connections <span className="text-white/20">({connectedThoughts.length})</span>
              </span>
              {connectedThoughts.length === 0 ? (
                <span className="text-white/20 text-xs">None</span>
              ) : (
                <div className="flex flex-col gap-1">
                  {connectedThoughts.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handlePanelFocus(t.id)}
                      className="text-left px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/60 text-xs hover:text-white hover:bg-white/10 transition-all"
                    >{t.text}</button>
                  ))}
                </div>
              )}
            </div>

            {/* 그룹 정보 */}
            {groupThoughts.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-white/30 text-xs">
                  Group <span className="text-white/20">({groupIds.length} nodes)</span>
                </span>
                <div className="flex flex-col gap-1">
                  {groupThoughts.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => handlePanelFocus(t.id)}
                      className="text-left px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/40 text-xs hover:text-white/70 hover:bg-white/10 transition-all"
                    >{t.text}</button>
                  ))}
                </div>
              </div>
            )}

            {/* 색상 변경 */}
            <div className="flex flex-col gap-2">
              <span className="text-white/30 text-xs">Color</span>
              <div className="flex gap-1.5 flex-wrap">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => handleColorChange(selectedThought.id, color)}
                    className="w-5 h-5 rounded-full border border-white/20 hover:scale-125 transition-transform"
                    style={{ background: color }}
                  />
                ))}
              </div>
            </div>

            {/* 삭제 */}
            <div className="mt-auto pt-4 border-t border-white/10">
              <button
                onClick={() => handleDelete(selectedThought)}
                className="w-full py-2 rounded-xl text-white/30 hover:text-red-400 hover:bg-red-500/10 border border-white/10 hover:border-red-500/20 text-xs transition-all"
              >Delete thought</button>
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