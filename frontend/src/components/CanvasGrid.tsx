import { useEffect, useMemo, useRef, useState } from "react";
import type { Player, Stroke } from "../types/socket";

type Props = {
  players: Player[];
  mePlayerId?: string;
  phase: string;
  canDraw: boolean;
  strokesByPlayer: Record<string, Stroke[]>;
  brushColor: string;
  brushThickness: number;
  onStrokeBegin: (strokeId: string, color: string, thickness: number) => Promise<void>;
  onStrokePoints: (strokeId: string, points: Array<{ x: number; y: number }>) => Promise<void>;
  onStrokeEnd: (strokeId: string) => Promise<void>;
};

type DrawingState = {
  active: boolean;
  strokeId: string;
  points: Array<{ x: number; y: number }>;
  lastX: number;
  lastY: number;
};

export function CanvasGrid(props: Props) {
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const [drawing, setDrawing] = useState<DrawingState | null>(null);
  const pointsPerChunk = 20;

  const visiblePlayers = useMemo(() => {
    if (props.phase === "DRAWING" && props.mePlayerId) {
      return props.players.filter((p) => p.playerId === props.mePlayerId);
    }
    if (props.phase === "VIEW_GUESS" || props.phase === "REVEAL") return props.players;
    return [];
  }, [props.players, props.phase, props.mePlayerId]);

  useEffect(() => {
    for (const p of props.players) {
      const canvas = canvasRefs.current[p.playerId];
      if (!canvas) continue;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      const strokes = props.strokesByPlayer[p.playerId] ?? [];
      // Do not clear/redraw during DRAWING; preserve optimistic strokes
      if (props.phase === "DRAWING") {
        // But if server explicitly cleared this player's strokes, reflect it immediately.
        if (Array.isArray(props.strokesByPlayer[p.playerId]) && strokes.length === 0) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        continue;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const stroke of strokes) {
        if (!stroke.points.length) continue;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.thickness;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        const first = normToPixel(stroke.points[0], canvas);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < stroke.points.length; i++) {
          const pt = normToPixel(stroke.points[i], canvas);
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
      }
    }
  }, [props.players, props.strokesByPlayer, props.phase]);

  useEffect(() => {
    if (props.phase !== "DRAWING") return;
    // New DRAWING round should start with empty canvases on client.
    for (const p of props.players) {
      const canvas = canvasRefs.current[p.playerId];
      if (!canvas) continue;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [props.phase, props.players]);

  function normToPixel(point: { x: number; y: number }, canvas: HTMLCanvasElement) {
    return { x: point.x * canvas.width, y: point.y * canvas.height };
  }

  function getMousePos(e: MouseEvent | React.MouseEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width ? canvas.width / rect.width : 1;
    const scaleY = rect.height ? canvas.height / rect.height : 1;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function toNorm(pos: { x: number; y: number }, canvas: HTMLCanvasElement) {
    return { x: pos.x / canvas.width, y: pos.y / canvas.height };
  }

  async function start(e: React.MouseEvent, playerId: string) {
    if (!props.canDraw || playerId !== props.mePlayerId) return;
    const canvas = canvasRefs.current[playerId];
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getMousePos(e, canvas);
    const strokeId = `stroke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    ctx.beginPath();
    ctx.strokeStyle = props.brushColor;
    ctx.lineWidth = props.brushThickness;
    ctx.moveTo(pos.x, pos.y);
    setDrawing({
      active: true,
      strokeId,
      points: [toNorm(pos, canvas)],
      lastX: pos.x,
      lastY: pos.y,
    });
    await props.onStrokeBegin(strokeId, props.brushColor, props.brushThickness);
  }

  async function move(e: React.MouseEvent, playerId: string) {
    if (!drawing?.active || playerId !== props.mePlayerId) return;
    const canvas = canvasRefs.current[playerId];
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getMousePos(e, canvas);
    ctx.beginPath();
    ctx.strokeStyle = props.brushColor;
    ctx.lineWidth = props.brushThickness;
    ctx.moveTo(drawing.lastX, drawing.lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    const next = [...drawing.points, toNorm(pos, canvas)];
    setDrawing({ ...drawing, points: next, lastX: pos.x, lastY: pos.y });
    if (next.length % pointsPerChunk === 0) {
      const chunk = next.slice(next.length - pointsPerChunk);
      await props.onStrokePoints(drawing.strokeId, chunk);
    }
  }

  async function end(playerId: string) {
    if (!drawing?.active || playerId !== props.mePlayerId) return;
    const pendingStart = Math.floor((drawing.points.length - 1) / pointsPerChunk) * pointsPerChunk;
    const pending = drawing.points.slice(pendingStart);
    if (pending.length > 0) await props.onStrokePoints(drawing.strokeId, pending);
    await props.onStrokeEnd(drawing.strokeId);
    setDrawing(null);
  }

  return (
    <div className="canvas-grid">
      {visiblePlayers.map((p) => (
        <div key={p.playerId} className="canvas-card">
          <h4>
            {p.name}
            {p.playerId === props.mePlayerId ? " (You)" : ""}
          </h4>
          <canvas
            ref={(el) => {
              canvasRefs.current[p.playerId] = el;
            }}
            width={800}
            height={600}
            onMouseDown={(e) => void start(e, p.playerId)}
            onMouseMove={(e) => void move(e, p.playerId)}
            onMouseUp={() => void end(p.playerId)}
            onMouseLeave={() => void end(p.playerId)}
          />
        </div>
      ))}
    </div>
  );
}
