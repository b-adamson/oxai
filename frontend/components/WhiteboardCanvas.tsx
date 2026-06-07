'use client';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { TutorAnnotation, WhiteboardStroke } from '@/lib/types';

// ── Public handle exposed via ref ──────────────────────────────

export interface WhiteboardHandle {
  /** Returns a base64 PNG data URL of the current board (with white background). */
  getSnapshot: () => string | null;
}

// ── Props ──────────────────────────────────────────────────────

interface WhiteboardCanvasProps {
  strokes: WhiteboardStroke[];
  annotations: TutorAnnotation[];
  onStrokesChange: (strokes: WhiteboardStroke[]) => void;
  /** Optional: render a solution as a floating overlay without touching the canvas. */
  solutionOverlay?: React.ReactNode;
}

// ── Constants ──────────────────────────────────────────────────

const PALETTE = ['#1a1a1a', '#ef4444', '#3b82f6', '#16a34a', '#f59e0b', '#8b5cf6'] as const;
const WIDTHS = [2, 5, 10] as const;
const ERASER_WIDTH_MULTIPLIER = 4;
const CANVAS_HEIGHT = 340;

type Tool = 'pen' | 'eraser';

// ── Helpers ────────────────────────────────────────────────────

function redrawOnCanvas(canvas: HTMLCanvasElement, strokes: WhiteboardStroke[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const stroke of strokes) {
    if (stroke.points.length < 1) continue;
    ctx.save();
    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = stroke.color;
    }
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (stroke.points.length === 1) {
      ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
      ctx.fillStyle = stroke.tool === 'eraser' ? 'rgba(0,0,0,1)' : stroke.color;
      ctx.fill();
    } else {
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ── Annotation SVG shapes ──────────────────────────────────────

function AnnotationShape({ ann, w, h }: { ann: TutorAnnotation; w: number; h: number }) {
  const x = ann.x * w;
  const y = ann.y * h;
  const x2 = ann.x2 != null ? ann.x2 * w : x;
  const y2 = ann.y2 != null ? ann.y2 * h : y;
  const c = ann.color;

  switch (ann.type) {
    case 'circle':
      return <circle cx={x} cy={y} r={22} stroke={c} strokeWidth={2.5} fill="none" />;
    case 'highlight':
      return (
        <rect
          x={Math.min(x, x2)} y={Math.min(y, y2)}
          width={Math.abs(x2 - x) || 40} height={Math.abs(y2 - y) || 18}
          fill={c} fillOpacity={0.25} rx={3}
        />
      );
    case 'arrow': {
      const dx = x2 - x; const dy = y2 - y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len; const uy = dy / len;
      const headLen = 12;
      const ax1 = x2 - headLen * (ux - 0.4 * uy);
      const ay1 = y2 - headLen * (uy + 0.4 * ux);
      const ax2 = x2 - headLen * (ux + 0.4 * uy);
      const ay2 = y2 - headLen * (uy - 0.4 * ux);
      return (
        <g>
          <line x1={x} y1={y} x2={x2} y2={y2} stroke={c} strokeWidth={2.5} />
          <polygon points={`${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}`} fill={c} />
        </g>
      );
    }
    case 'question_mark':
      return (
        <g>
          <circle cx={x} cy={y} r={14} stroke={c} strokeWidth={2} fill="white" fillOpacity={0.85} />
          <text x={x} y={y + 5} textAnchor="middle" fontSize={16} fontWeight="bold" fill={c}>?</text>
        </g>
      );
    case 'cross': {
      const r = 10;
      return (
        <g>
          <line x1={x - r} y1={y - r} x2={x + r} y2={y + r} stroke={c} strokeWidth={2.5} />
          <line x1={x + r} y1={y - r} x2={x - r} y2={y + r} stroke={c} strokeWidth={2.5} />
        </g>
      );
    }
    case 'checkmark':
      return (
        <path
          d={`M${x - 10},${y} L${x - 2},${y + 9} L${x + 12},${y - 10}`}
          stroke={c} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round"
        />
      );
    default:
      return null;
  }
}

// ── Main component ─────────────────────────────────────────────

export const WhiteboardCanvas = forwardRef<WhiteboardHandle, WhiteboardCanvasProps>(
  function WhiteboardCanvas({ strokes, annotations, onStrokesChange, solutionOverlay }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [tool, setTool] = useState<Tool>('pen');
    const [color, setColor] = useState<string>(PALETTE[0]);
    const [width, setWidth] = useState<number>(WIDTHS[1]);
    const [canvasDims, setCanvasDims] = useState({ w: 600, h: CANVAS_HEIGHT });
    const [fullscreen, setFullscreen] = useState(false);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    const strokesRef = useRef<WhiteboardStroke[]>(strokes);
    const isDrawing = useRef(false);
    const currentPoints = useRef<{ x: number; y: number }[]>([]);
    const toolRef = useRef<Tool>(tool);
    const colorRef = useRef<string>(color);
    const widthRef = useRef<number>(width);
    const undoStack = useRef<WhiteboardStroke[][]>([]);
    const redoStack = useRef<WhiteboardStroke[][]>([]);

    useEffect(() => { strokesRef.current = strokes; }, [strokes]);
    useEffect(() => { toolRef.current = tool; }, [tool]);
    useEffect(() => { colorRef.current = color; }, [color]);
    useEffect(() => { widthRef.current = width; }, [width]);

    useImperativeHandle(ref, () => ({
      getSnapshot: () => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        return canvas.toDataURL('image/png');
      },
    }));

    useEffect(() => {
      if (canvasRef.current) redrawOnCanvas(canvasRef.current, strokes);
    }, [strokes]);

    const handleResize = useCallback(() => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;
      const w = container.clientWidth;
      const h = container.clientHeight || CANVAS_HEIGHT;
      if (w === canvas.width && h === canvas.height) return;
      canvas.width = w;
      canvas.height = h;
      setCanvasDims({ w, h });
      redrawOnCanvas(canvas, strokesRef.current);
    }, []);

    useEffect(() => {
      handleResize();
      const ro = new ResizeObserver(handleResize);
      if (containerRef.current) ro.observe(containerRef.current);
      return () => ro.disconnect();
    }, [handleResize]);

    // Trigger resize after fullscreen layout change
    useEffect(() => {
      const id = setTimeout(() => handleResize(), 0);
      return () => clearTimeout(id);
    }, [fullscreen, handleResize]);

    // ESC to exit fullscreen
    useEffect(() => {
      if (!fullscreen) return;
      function onKey(e: KeyboardEvent) {
        if (e.key === 'Escape') setFullscreen(false);
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [fullscreen]);

    // ── Pointer event helpers ────────────────────────────────────

    function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
      const rect = canvasRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
      e.preventDefault();
      canvasRef.current?.setPointerCapture(e.pointerId);
      isDrawing.current = true;
      const pos = getPos(e);
      currentPoints.current = [pos];
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        ctx.save();
        const t = toolRef.current;
        const w = t === 'eraser' ? widthRef.current * ERASER_WIDTH_MULTIPLIER : widthRef.current;
        if (t === 'eraser') {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = 'rgba(0,0,0,1)';
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = colorRef.current;
        }
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
      if (!isDrawing.current) return;
      const pos = getPos(e);
      const prev = currentPoints.current[currentPoints.current.length - 1];
      currentPoints.current.push(pos);
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      const t = toolRef.current;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (t === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.lineWidth = widthRef.current * ERASER_WIDTH_MULTIPLIER;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = colorRef.current;
        ctx.lineWidth = widthRef.current;
      }
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      ctx.restore();
    }

    function onPointerUp() {
      if (!isDrawing.current) return;
      isDrawing.current = false;
      if (currentPoints.current.length === 0) return;
      const t = toolRef.current;
      const newStroke: WhiteboardStroke = {
        points: [...currentPoints.current],
        color: t === 'eraser' ? '#000000' : colorRef.current,
        width: t === 'eraser' ? widthRef.current * ERASER_WIDTH_MULTIPLIER : widthRef.current,
        tool: t,
      };
      currentPoints.current = [];
      // Save undo snapshot before committing
      undoStack.current.push([...strokesRef.current]);
      redoStack.current = [];
      setCanUndo(true);
      setCanRedo(false);
      const next = [...strokesRef.current, newStroke];
      strokesRef.current = next;
      onStrokesChange(next);
    }

    function handleClear() {
      if (strokesRef.current.length === 0) return;
      undoStack.current.push([...strokesRef.current]);
      redoStack.current = [];
      setCanUndo(true);
      setCanRedo(false);
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx && canvasRef.current) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      strokesRef.current = [];
      onStrokesChange([]);
    }

    function handleUndo() {
      const prev = undoStack.current.pop();
      if (prev === undefined) return;
      redoStack.current.push([...strokesRef.current]);
      strokesRef.current = prev;
      onStrokesChange(prev);
      setCanUndo(undoStack.current.length > 0);
      setCanRedo(true);
    }

    function handleRedo() {
      const next = redoStack.current.pop();
      if (next === undefined) return;
      undoStack.current.push([...strokesRef.current]);
      strokesRef.current = next;
      onStrokesChange(next);
      setCanUndo(true);
      setCanRedo(redoStack.current.length > 0);
    }

    // ── Render ───────────────────────────────────────────────────

    const toolbar = (
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50 flex-wrap shrink-0">
        {/* Tool picker */}
        <div className="flex gap-1">
          <ToolBtn active={tool === 'pen'} onClick={() => setTool('pen')} title="Pen">
            <PenIcon />
          </ToolBtn>
          <ToolBtn active={tool === 'eraser'} onClick={() => setTool('eraser')} title="Eraser">
            <EraserIcon />
          </ToolBtn>
        </div>

        <div className="w-px h-5 bg-gray-300 shrink-0" />

        {/* Colour palette */}
        <div className="flex gap-1 items-center">
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => { setColor(c); setTool('pen'); }}
              className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
                tool === 'pen' && color === c
                  ? 'border-gray-600 scale-125 ring-1 ring-offset-1 ring-gray-400'
                  : 'border-white shadow-sm'
              }`}
              style={{ backgroundColor: c }}
              aria-label={`Colour ${c}`}
            />
          ))}
        </div>

        <div className="w-px h-5 bg-gray-300 shrink-0" />

        {/* Stroke width */}
        <div className="flex gap-1 items-center">
          {WIDTHS.map((w) => (
            <button
              key={w}
              onClick={() => setWidth(w)}
              title={`${w}px`}
              className={`w-7 h-7 rounded flex items-center justify-center border transition-colors ${
                width === w ? 'border-accent bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-400'
              }`}
            >
              <span
                className="rounded-full bg-gray-700"
                style={{ width: Math.min(w * 1.6, 14), height: Math.min(w * 1.6, 14) }}
              />
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-gray-300 shrink-0" />

        {/* Undo / Redo */}
        <div className="flex gap-1">
          <ToolBtn active={false} onClick={handleUndo} title="Undo" disabled={!canUndo}>
            <UndoIcon />
          </ToolBtn>
          <ToolBtn active={false} onClick={handleRedo} title="Redo" disabled={!canRedo}>
            <RedoIcon />
          </ToolBtn>
        </div>

        <div className="flex-1" />

        {/* Fullscreen toggle */}
        <button
          onClick={() => setFullscreen((f) => !f)}
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          className="w-7 h-7 rounded flex items-center justify-center border border-gray-200 bg-white hover:border-gray-400 transition-colors text-gray-500"
        >
          {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
        </button>

        <button
          onClick={handleClear}
          className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 bg-white hover:bg-red-50 px-2.5 py-1 rounded transition-colors"
        >
          Clear
        </button>
      </div>
    );

    const canvasArea = (
      <div
        ref={containerRef}
        className="relative select-none flex-1 min-h-0"
        style={fullscreen ? undefined : { height: CANVAS_HEIGHT }}
      >
        <canvas
          ref={canvasRef}
          height={CANVAS_HEIGHT}
          className="block w-full h-full"
          style={{ touchAction: 'none', cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />

        {annotations.length > 0 && (
          <svg
            className="absolute inset-0 pointer-events-none"
            width={canvasDims.w}
            height={canvasDims.h}
            xmlns="http://www.w3.org/2000/svg"
          >
            {annotations.map((ann, i) => (
              <AnnotationShape key={i} ann={ann} w={canvasDims.w} h={canvasDims.h} />
            ))}
          </svg>
        )}

        {solutionOverlay && (
          <div className="absolute inset-0 z-10 overflow-auto bg-white/95 backdrop-blur-sm rounded-b-lg">
            {solutionOverlay}
          </div>
        )}
      </div>
    );

    const legend = annotations.length > 0 && (
      <div className="px-3 py-1.5 bg-amber-50 border-t border-amber-200 flex items-center gap-1.5 shrink-0">
        <span className="text-xs text-amber-700 font-medium">Tutor annotations active</span>
      </div>
    );

    if (fullscreen) {
      return (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          {toolbar}
          {canvasArea}
          {legend}
        </div>
      );
    }

    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white flex flex-col">
        {toolbar}
        {canvasArea}
        {legend}
      </div>
    );
  }
);

// ── Small helper components ────────────────────────────────────

function ToolBtn({
  active,
  onClick,
  title,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`w-8 h-8 rounded flex items-center justify-center border transition-colors ${
        active
          ? 'bg-accent border-accent text-white'
          : disabled
            ? 'bg-white border-gray-100 text-gray-300 cursor-not-allowed'
            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'
      }`}
    >
      {children}
    </button>
  );
}

function PenIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
    </svg>
  );
}

function EraserIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M9.243 3.03a1 1 0 01.727 1.213L9.53 6h2.94l.56-2.243a1 1 0 111.94.486L14.53 6H17a1 1 0 110 2h-2.97l-1 4H15a1 1 0 110 2h-2.47l-.56 2.242a1 1 0 11-1.94-.485L10.47 14H7.53l-.56 2.242a1 1 0 11-1.94-.485L5.47 14H3a1 1 0 110-2h2.97l1-4H5a1 1 0 110-2h2.47l.56-2.243a1 1 0 011.213-.727zM9.03 8l-1 4h2.938l1-4H9.031z" clipRule="evenodd" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M7.793 2.232a.75.75 0 01-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 010 10.75H10.75a.75.75 0 010-1.5h2.875a3.875 3.875 0 000-7.75H3.622l4.146 3.957a.75.75 0 01-1.036 1.085l-5.5-5.25a.75.75 0 010-1.085l5.5-5.25a.75.75 0 011.061.025z" clipRule="evenodd" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M12.207 2.232a.75.75 0 00.025 1.06l4.146 3.958H6.375a5.375 5.375 0 000 10.75H9.25a.75.75 0 000-1.5H6.375a3.875 3.875 0 010-7.75h10.003l-4.146 3.957a.75.75 0 001.036 1.085l5.5-5.25a.75.75 0 000-1.085l-5.5-5.25a.75.75 0 00-1.061.025z" clipRule="evenodd" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M3.28 2.22a.75.75 0 00-1.06 1.06L5.44 6.5H2.75a.75.75 0 000 1.5H7a.75.75 0 00.75-.75V2.75a.75.75 0 00-1.5 0v2.69L2.28 2.22zM13 2.75a.75.75 0 011.5 0V5.44l3.22-3.22a.75.75 0 111.06 1.06L15.56 6.5h2.69a.75.75 0 010 1.5H13a.75.75 0 01-.75-.75V2.75zM2.75 13a.75.75 0 000 1.5H5.44l-3.22 3.22a.75.75 0 101.06 1.06L6.5 15.56v2.69a.75.75 0 001.5 0V13a.75.75 0 00-.75-.75H2.75zM13 17.25a.75.75 0 001.5 0V14.56l3.22 3.22a.75.75 0 101.06-1.06L15.56 13.5h2.69a.75.75 0 000-1.5H13a.75.75 0 00-.75.75v4.5z" clipRule="evenodd" />
    </svg>
  );
}

function ExitFullscreenIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M3.22 3.22a.75.75 0 011.06 0L7 5.94V3.25a.75.75 0 011.5 0V7.5A.75.75 0 017.75 8h-4.5a.75.75 0 010-1.5h2.69L3.22 4.28a.75.75 0 010-1.06zm13.56 0a.75.75 0 010 1.06L14.06 7h2.69a.75.75 0 010 1.5h-4.5A.75.75 0 0111.5 7.75v-4.5a.75.75 0 011.5 0v2.69l2.72-2.72a.75.75 0 011.06 0zM3.25 11.5a.75.75 0 000 1.5h2.69l-2.72 2.72a.75.75 0 101.06 1.06L7 14.06v2.69a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5zm9.25.75a.75.75 0 01.75-.75h4.5a.75.75 0 010 1.5h-2.69l2.72 2.72a.75.75 0 11-1.06 1.06L14 14.06v2.69a.75.75 0 01-1.5 0v-4.5z" clipRule="evenodd" />
    </svg>
  );
}
