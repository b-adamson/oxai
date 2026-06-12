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

// ── Public handle ──────────────────────────────────────────────

export interface WhiteboardHandle {
  getSnapshot: () => string | null;
}

// ── Props ──────────────────────────────────────────────────────

interface WhiteboardCanvasProps {
  strokes: WhiteboardStroke[];
  annotations: TutorAnnotation[];
  onStrokesChange: (strokes: WhiteboardStroke[]) => void;
  fullscreenSidebar?: React.ReactNode;
}

// ── Constants ──────────────────────────────────────────────────

const PALETTE_LIGHT = ['#1a1a1a', '#ef4444', '#3b82f6', '#16a34a', '#f59e0b', '#8b5cf6'] as const;
const PALETTE_DARK  = ['#e5e7eb', '#f87171', '#60a5fa', '#4ade80', '#fbbf24', '#a78bfa'] as const;
const WIDTHS = [2, 5, 10] as const;
const ERASER_WIDTH_MULTIPLIER = 4;
const CANVAS_HEIGHT = 340;
const BG_LIGHT = '#ffffff';
const BG_DARK  = '#111827';
const HANDLE_SIZE = 10; // px, resize handle squares

type Tool = 'pen' | 'eraser' | 'select';

// ── Unified draw-op list ───────────────────────────────────────

interface CanvasImage {
  id: string;
  img: HTMLImageElement;
  x: number; y: number; w: number; h: number;
}

type DrawOp =
  | { kind: 'stroke'; stroke: WhiteboardStroke }
  | { kind: 'image';  ci: CanvasImage }
  | { kind: 'clear';  x1: number; y1: number; x2: number; y2: number };

// ── Pending image (paste → resize → commit) ────────────────────

interface PendingImage {
  id: string;
  img: HTMLImageElement;
  x: number; y: number; w: number; h: number;
}

// Drag state for image resize overlay (stored in ref to avoid re-renders)
type DragMode = 'move' | 'tl' | 'tr' | 'bl' | 'br';
interface OverlayDragState {
  active: boolean;
  mode: DragMode;
  startMouseX: number;
  startMouseY: number;
  startX: number; startY: number;
  startW: number; startH: number;
}

// ── Selection ──────────────────────────────────────────────────

interface SelectionRect { x1: number; y1: number; x2: number; y2: number }

// ── Canvas drawing ─────────────────────────────────────────────

function drawStroke(ctx: CanvasRenderingContext2D, stroke: WhiteboardStroke, bg: string) {
  if (stroke.points.length < 1) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (stroke.tool === 'eraser') {
    ctx.strokeStyle = bg;
    ctx.fillStyle = bg;
  } else {
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
  }
  ctx.beginPath();
  if (stroke.points.length === 1) {
    ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function redrawFromOps(canvas: HTMLCanvasElement, ops: DrawOp[], bg: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.style.backgroundColor = bg;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const op of ops) {
    if (op.kind === 'stroke') {
      drawStroke(ctx, op.stroke, bg);
    } else if (op.kind === 'image') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(op.ci.img, op.ci.x, op.ci.y, op.ci.w, op.ci.h);
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = bg;
      ctx.fillRect(
        Math.min(op.x1, op.x2), Math.min(op.y1, op.y2),
        Math.abs(op.x2 - op.x1), Math.abs(op.y2 - op.y1),
      );
    }
  }
}

function opsToStrokes(ops: DrawOp[]): WhiteboardStroke[] {
  return ops
    .filter((op): op is { kind: 'stroke'; stroke: WhiteboardStroke } => op.kind === 'stroke')
    .map(op => op.stroke);
}

// ── Annotation SVG shapes ──────────────────────────────────────

function AnnotationShape({ ann, w, h }: { ann: TutorAnnotation; w: number; h: number }) {
  const x = ann.x * w, y = ann.y * h;
  const x2 = ann.x2 != null ? ann.x2 * w : x;
  const y2 = ann.y2 != null ? ann.y2 * h : y;
  const c = ann.color;
  switch (ann.type) {
    case 'circle':
      return <circle cx={x} cy={y} r={22} stroke={c} strokeWidth={2.5} fill="none" />;
    case 'highlight':
      return <rect x={Math.min(x,x2)} y={Math.min(y,y2)} width={Math.abs(x2-x)||40} height={Math.abs(y2-y)||18} fill={c} fillOpacity={0.25} rx={3} />;
    case 'arrow': {
      const dx=x2-x, dy=y2-y, len=Math.sqrt(dx*dx+dy*dy)||1, ux=dx/len, uy=dy/len, hl=12;
      return <g><line x1={x} y1={y} x2={x2} y2={y2} stroke={c} strokeWidth={2.5}/><polygon points={`${x2},${y2} ${x2-hl*(ux-0.4*uy)},${y2-hl*(uy+0.4*ux)} ${x2-hl*(ux+0.4*uy)},${y2-hl*(uy-0.4*ux)}`} fill={c}/></g>;
    }
    case 'question_mark':
      return <g><circle cx={x} cy={y} r={14} stroke={c} strokeWidth={2} fill="white" fillOpacity={0.85}/><text x={x} y={y+5} textAnchor="middle" fontSize={16} fontWeight="bold" fill={c}>?</text></g>;
    case 'cross': {
      const r=10;
      return <g><line x1={x-r} y1={y-r} x2={x+r} y2={y+r} stroke={c} strokeWidth={2.5}/><line x1={x+r} y1={y-r} x2={x-r} y2={y+r} stroke={c} strokeWidth={2.5}/></g>;
    }
    case 'checkmark':
      return <path d={`M${x-10},${y} L${x-2},${y+9} L${x+12},${y-10}`} stroke={c} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round"/>;
    default: return null;
  }
}

// ── Main component ─────────────────────────────────────────────

export const WhiteboardCanvas = forwardRef<WhiteboardHandle, WhiteboardCanvasProps>(
  function WhiteboardCanvas({ strokes, annotations, onStrokesChange, fullscreenSidebar }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Dark mode
    const [isDark, setIsDark] = useState(() =>
      typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
    );
    useEffect(() => {
      const el = document.documentElement;
      const obs = new MutationObserver(() => setIsDark(el.classList.contains('dark')));
      obs.observe(el, { attributes: true, attributeFilter: ['class'] });
      return () => obs.disconnect();
    }, []);

    const palette = isDark ? PALETTE_DARK : PALETTE_LIGHT;
    const canvasBgRef = useRef(isDark ? BG_DARK : BG_LIGHT);

    // Tool state
    const [tool, setTool] = useState<Tool>('pen');
    const [color, setColor] = useState<string>(PALETTE_LIGHT[0]);
    const [strokeWidth, setStrokeWidth] = useState<number>(WIDTHS[1]);
    const [canvasDims, setCanvasDims] = useState({ w: 600, h: CANVAS_HEIGHT });
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    // UI
    const [fullscreen, setFullscreen] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [sidebarWidth, setSidebarWidth] = useState(320);
    const sidebarResizeRef = useRef({ dragging: false, startX: 0, startW: 320 });

    // DrawOps — single ordered list; seeded from persisted strokes on mount
    const [drawOps, setDrawOps] = useState<DrawOp[]>(() =>
      strokes.map(s => ({ kind: 'stroke' as const, stroke: s }))
    );
    const drawOpsRef = useRef<DrawOp[]>(drawOps);
    useEffect(() => { drawOpsRef.current = drawOps; }, [drawOps]);

    // Pending image: pasted but not yet committed — shows resize overlay
    const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
    const pendingRef = useRef<PendingImage | null>(null);
    useEffect(() => { pendingRef.current = pendingImage; }, [pendingImage]);
    const overlayDragRef = useRef<OverlayDragState>({
      active: false, mode: 'move',
      startMouseX: 0, startMouseY: 0,
      startX: 0, startY: 0, startW: 0, startH: 0,
    });

    // Selection
    const [selection, setSelection] = useState<SelectionRect | null>(null);
    const selStartRef = useRef<{ x: number; y: number } | null>(null);
    useEffect(() => { if (tool !== 'select') setSelection(null); }, [tool]);

    // Keep onStrokesChange in a ref
    const onStrokesChangeRef = useRef(onStrokesChange);
    useEffect(() => { onStrokesChangeRef.current = onStrokesChange; }, [onStrokesChange]);

    // Drawing refs
    const isDrawing = useRef(false);
    const currentPoints = useRef<{ x: number; y: number }[]>([]);
    const toolRef = useRef<Tool>(tool);
    const colorRef = useRef<string>(color);
    const widthRef = useRef<number>(strokeWidth);
    useEffect(() => { toolRef.current = tool; }, [tool]);
    useEffect(() => { colorRef.current = color; }, [color]);
    useEffect(() => { widthRef.current = strokeWidth; }, [strokeWidth]);

    // Undo/redo stacks
    const undoStack = useRef<DrawOp[][]>([]);
    const redoStack = useRef<DrawOp[][]>([]);

    function pushUndo() {
      undoStack.current.push([...drawOpsRef.current]);
      redoStack.current = [];
      setCanUndo(true);
      setCanRedo(false);
    }

    function applyOps(ops: DrawOp[]) {
      drawOpsRef.current = ops;
      setDrawOps(ops);
      onStrokesChangeRef.current(opsToStrokes(ops));
      if (canvasRef.current) redrawFromOps(canvasRef.current, ops, canvasBgRef.current);
    }

    function handleUndo() {
      const prev = undoStack.current.pop();
      if (!prev) return;
      redoStack.current.push([...drawOpsRef.current]);
      setCanUndo(undoStack.current.length > 0);
      setCanRedo(true);
      applyOps(prev);
    }

    function handleRedo() {
      const next = redoStack.current.pop();
      if (!next) return;
      undoStack.current.push([...drawOpsRef.current]);
      setCanUndo(true);
      setCanRedo(redoStack.current.length > 0);
      applyOps(next);
    }

    const handleUndoRef = useRef(handleUndo);
    const handleRedoRef = useRef(handleRedo);
    handleUndoRef.current = handleUndo;
    handleRedoRef.current = handleRedo;

    // Commit the pending image into drawOps
    function commitPendingImage() {
      const p = pendingRef.current;
      if (!p) return;
      setPendingImage(null);
      pushUndo();
      const ci: CanvasImage = { id: p.id, img: p.img, x: p.x, y: p.y, w: p.w, h: p.h };
      const next = [...drawOpsRef.current, { kind: 'image' as const, ci }];
      applyOps(next);
    }

    function cancelPendingImage() {
      setPendingImage(null);
    }

    // Dark mode: swap palette + redraw
    useEffect(() => {
      const newBg = isDark ? BG_DARK : BG_LIGHT;
      canvasBgRef.current = newBg;
      const from = isDark ? PALETTE_LIGHT : PALETTE_DARK;
      const to   = isDark ? PALETTE_DARK  : PALETTE_LIGHT;
      const idx = (from as readonly string[]).indexOf(color);
      if (idx !== -1) setColor(to[idx]);
      if (canvasRef.current) redrawFromOps(canvasRef.current, drawOpsRef.current, newBg);
    }, [isDark]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
      if (canvasRef.current) redrawFromOps(canvasRef.current, drawOps, canvasBgRef.current);
    }, [drawOps]);

    useImperativeHandle(ref, () => ({
      getSnapshot: () => {
        if (!canvasRef.current) return null;
        // If there's a pending image, draw it temporarily for the snapshot
        const p = pendingRef.current;
        if (p) {
          const ctx = canvasRef.current.getContext('2d');
          ctx?.drawImage(p.img, p.x, p.y, p.w, p.h);
        }
        const snap = canvasRef.current.toDataURL('image/png');
        // Redraw to remove the temporary image
        if (p) redrawFromOps(canvasRef.current, drawOpsRef.current, canvasBgRef.current);
        return snap;
      },
    }));

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
      redrawFromOps(canvas, drawOpsRef.current, canvasBgRef.current);
    }, []);

    useEffect(() => {
      handleResize();
      const ro = new ResizeObserver(handleResize);
      if (containerRef.current) ro.observe(containerRef.current);
      return () => ro.disconnect();
    }, [handleResize]);

    useEffect(() => {
      const id = setTimeout(() => handleResize(), 0);
      return () => clearTimeout(id);
    }, [fullscreen, handleResize]);

    // Global keyboard shortcuts
    useEffect(() => {
      function onKey(e: KeyboardEvent) {
        // Pending image: Enter commits, Escape cancels
        if (pendingRef.current) {
          if (e.key === 'Enter') { e.preventDefault(); commitPendingImage(); return; }
          if (e.key === 'Escape') { e.preventDefault(); cancelPendingImage(); return; }
          return; // block other shortcuts while resizing
        }
        if (e.key === 'Escape') { setFullscreen(false); setSelection(null); return; }
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndoRef.current(); return; }
        if (ctrl && ((e.key === 'z' && e.shiftKey) || e.key === 'Z' || e.key === 'y')) {
          e.preventDefault(); handleRedoRef.current();
        }
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Delete selection
    const handleDeleteSelection = useCallback(() => {
      if (!selection) return;
      const { x1, y1, x2, y2 } = selection;
      if (Math.abs(x2 - x1) < 2 || Math.abs(y2 - y1) < 2) { setSelection(null); return; }
      pushUndo();
      applyOps([...drawOpsRef.current, { kind: 'clear' as const, x1, y1, x2, y2 }]);
      setSelection(null);
    }, [selection]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
      if (!selection) return;
      function onKey(e: KeyboardEvent) {
        if (e.key === 'Delete' || e.key === 'Backspace') handleDeleteSelection();
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [selection, handleDeleteSelection]);

    // Clipboard paste → show resize overlay instead of immediately committing
    useEffect(() => {
      function onPaste(e: ClipboardEvent) {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of Array.from(items)) {
          if (!item.type.startsWith('image/')) continue;
          const blob = item.getAsFile();
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(url);
            const canvas = canvasRef.current;
            if (!canvas) return;
            const scale = Math.min(1, (canvas.width * 0.8) / img.naturalWidth, (canvas.height * 0.8) / img.naturalHeight);
            const w = Math.max(40, img.naturalWidth * scale);
            const h = Math.max(40, img.naturalHeight * scale);
            setPendingImage({
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              img,
              x: (canvas.width - w) / 2,
              y: (canvas.height - h) / 2,
              w, h,
            });
          };
          img.onerror = () => URL.revokeObjectURL(url);
          img.src = url;
          break;
        }
      }
      window.addEventListener('paste', onPaste);
      return () => window.removeEventListener('paste', onPaste);
    }, []);

    // ── Pointer events (canvas drawing) ───────────────────────

    function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
      const rect = canvasRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
      if (pendingImage) return; // overlay is on top, shouldn't fire
      e.preventDefault();
      canvasRef.current?.setPointerCapture(e.pointerId);
      isDrawing.current = true;
      const pos = getPos(e);

      if (toolRef.current === 'select') {
        selStartRef.current = pos;
        setSelection({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y });
        return;
      }

      currentPoints.current = [pos];
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        ctx.save();
        const t = toolRef.current;
        const w = t === 'eraser' ? widthRef.current * ERASER_WIDTH_MULTIPLIER : widthRef.current;
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = t === 'eraser' ? canvasBgRef.current : colorRef.current;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
      if (!isDrawing.current) return;
      const pos = getPos(e);

      if (toolRef.current === 'select') {
        if (selStartRef.current) setSelection({ x1: selStartRef.current.x, y1: selStartRef.current.y, x2: pos.x, y2: pos.y });
        return;
      }

      const prev = currentPoints.current[currentPoints.current.length - 1];
      currentPoints.current.push(pos);
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = 'source-over';
      if (toolRef.current === 'eraser') {
        ctx.strokeStyle = canvasBgRef.current;
        ctx.lineWidth = widthRef.current * ERASER_WIDTH_MULTIPLIER;
      } else {
        ctx.strokeStyle = colorRef.current;
        ctx.lineWidth = widthRef.current;
      }
      ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(pos.x, pos.y); ctx.stroke();
      ctx.restore();
    }

    function onPointerUp() {
      if (!isDrawing.current) return;
      isDrawing.current = false;
      if (toolRef.current === 'select') return;
      if (currentPoints.current.length === 0) return;

      const t = toolRef.current;
      const newStroke: WhiteboardStroke = {
        points: [...currentPoints.current],
        color: t === 'eraser' ? canvasBgRef.current : colorRef.current,
        width: t === 'eraser' ? widthRef.current * ERASER_WIDTH_MULTIPLIER : widthRef.current,
        tool: t,
      };
      currentPoints.current = [];
      pushUndo();
      const next = [...drawOpsRef.current, { kind: 'stroke' as const, stroke: newStroke }];
      drawOpsRef.current = next;
      setDrawOps(next);
      onStrokesChangeRef.current(opsToStrokes(next));
    }

    function handleClear() {
      if (drawOpsRef.current.length === 0 && !pendingImage) return;
      cancelPendingImage();
      pushUndo();
      applyOps([]);
      setSelection(null);
    }

    // ── Image resize overlay pointer handlers ──────────────────

    function getOverlayPos(e: React.PointerEvent | PointerEvent) {
      const rect = containerRef.current!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function startOverlayDrag(e: React.PointerEvent<HTMLElement>, mode: DragMode) {
      e.preventDefault();
      e.stopPropagation();
      const p = pendingImage!;
      const pos = getOverlayPos(e);
      overlayDragRef.current = {
        active: true, mode,
        startMouseX: pos.x, startMouseY: pos.y,
        startX: p.x, startY: p.y, startW: p.w, startH: p.h,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }

    function onOverlayPointerMove(e: React.PointerEvent<HTMLDivElement>) {
      const drag = overlayDragRef.current;
      if (!drag.active || !pendingImage) return;
      const pos = getOverlayPos(e);
      const dx = pos.x - drag.startMouseX;
      const dy = pos.y - drag.startMouseY;
      const MIN = 20;

      let { x, y, w, h } = drag;

      if (drag.mode === 'move') {
        x = drag.startX + dx;
        y = drag.startY + dy;
      } else {
        // Corner resize: opposite corner stays fixed
        const right  = drag.startX + drag.startW;
        const bottom = drag.startY + drag.startH;

        if (drag.mode === 'br') {
          w = Math.max(MIN, drag.startW + dx);
          h = Math.max(MIN, drag.startH + dy);
        } else if (drag.mode === 'bl') {
          w = Math.max(MIN, drag.startW - dx);
          h = Math.max(MIN, drag.startH + dy);
          x = right - w;
        } else if (drag.mode === 'tr') {
          w = Math.max(MIN, drag.startW + dx);
          h = Math.max(MIN, drag.startH - dy);
          y = bottom - h;
        } else { // tl
          w = Math.max(MIN, drag.startW - dx);
          h = Math.max(MIN, drag.startH - dy);
          x = right - w;
          y = bottom - h;
        }
      }

      setPendingImage(prev => prev ? { ...prev, x, y, w, h } : prev);
    }

    function onOverlayPointerUp() {
      overlayDragRef.current.active = false;
    }

    // ── Render ─────────────────────────────────────────────────

    const hasSelection = selection !== null && Math.abs(selection.x2 - selection.x1) > 2 && Math.abs(selection.y2 - selection.y1) > 2;

    const toolbar = (
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex-wrap shrink-0">
        <div className="flex gap-1">
          <ToolBtn active={tool === 'pen'} onClick={() => setTool('pen')} title="Pen"><PenIcon /></ToolBtn>
          <ToolBtn active={tool === 'eraser'} onClick={() => setTool('eraser')} title="Eraser"><EraserIcon /></ToolBtn>
          <ToolBtn active={tool === 'select'} onClick={() => setTool('select')} title="Select region — drag then Delete to erase"><SelectIcon /></ToolBtn>
        </div>

        <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 shrink-0" />

        {tool === 'select' ? (
          hasSelection ? (
            <button
              onClick={handleDeleteSelection}
              className="text-xs text-red-500 hover:text-red-700 border border-red-300 dark:border-red-700 bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-950/30 px-2.5 py-1 rounded transition-colors font-medium"
            >
              Delete selection
            </button>
          ) : (
            <span className="text-xs text-gray-400 dark:text-gray-500 italic select-none">
              Drag to select · Delete to erase
            </span>
          )
        ) : (
          <>
            <div className="flex gap-1 items-center">
              {palette.map((c, idx) => (
                <button
                  key={idx}
                  onClick={() => { setColor(c); setTool('pen'); }}
                  className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
                    tool === 'pen' && color === c
                      ? 'border-gray-600 dark:border-gray-300 scale-125 ring-1 ring-offset-1 ring-gray-400 dark:ring-gray-500'
                      : 'border-white dark:border-gray-700 shadow-sm'
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Colour ${c}`}
                />
              ))}
            </div>
            <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 shrink-0" />
            <div className="flex gap-1 items-center">
              {WIDTHS.map((w) => (
                <button
                  key={w}
                  onClick={() => setStrokeWidth(w)}
                  title={`${w}px`}
                  className={`w-7 h-7 rounded flex items-center justify-center border transition-colors ${
                    strokeWidth === w
                      ? 'border-accent bg-blue-50 dark:bg-blue-950/30'
                      : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-400'
                  }`}
                >
                  <span className="rounded-full bg-gray-700 dark:bg-gray-200" style={{ width: Math.min(w * 1.6, 14), height: Math.min(w * 1.6, 14) }} />
                </button>
              ))}
            </div>
            <div className="w-px h-5 bg-gray-300 dark:bg-gray-600 shrink-0" />
          </>
        )}

        <div className="flex gap-1">
          <ToolBtn active={false} onClick={handleUndo} title="Undo (Ctrl+Z)" disabled={!canUndo}><UndoIcon /></ToolBtn>
          <ToolBtn active={false} onClick={handleRedo} title="Redo (Ctrl+Shift+Z)" disabled={!canRedo}><RedoIcon /></ToolBtn>
        </div>

        <div className="flex-1" />

        <button
          onClick={() => setFullscreen((f) => !f)}
          title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          className="w-7 h-7 rounded flex items-center justify-center border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-400 transition-colors text-gray-500 dark:text-gray-300"
        >
          {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
        </button>

        <button
          onClick={handleClear}
          className="text-xs text-red-500 hover:text-red-700 border border-red-200 dark:border-red-800 hover:border-red-400 bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-950/30 px-2.5 py-1 rounded transition-colors"
        >
          Clear
        </button>
      </div>
    );

    const hs = HANDLE_SIZE;
    const hh = hs / 2;
    const handles: { mode: DragMode; style: React.CSSProperties; cursor: string }[] = [
      { mode: 'tl', cursor: 'nwse-resize', style: { top: -hh, left: -hh } },
      { mode: 'tr', cursor: 'nesw-resize', style: { top: -hh, right: -hh } },
      { mode: 'bl', cursor: 'nesw-resize', style: { bottom: -hh, left: -hh } },
      { mode: 'br', cursor: 'nwse-resize', style: { bottom: -hh, right: -hh } },
    ];

    const canvasArea = (
      <div ref={containerRef} className="relative select-none flex-1 min-h-0" style={fullscreen ? undefined : { height: CANVAS_HEIGHT }}>
        <canvas
          ref={canvasRef}
          height={CANVAS_HEIGHT}
          className="block w-full h-full"
          style={{ touchAction: 'none', cursor: pendingImage ? 'default' : (tool === 'eraser' ? 'cell' : 'crosshair'), backgroundColor: canvasBgRef.current }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />

        {/* Image resize overlay — shown while a pasted image is being sized */}
        {pendingImage && (
          <div
            className="absolute inset-0"
            style={{ cursor: 'default' }}
            onPointerMove={onOverlayPointerMove}
            onPointerUp={onOverlayPointerUp}
            onPointerDown={(e) => {
              // Click outside the image box → commit
              e.stopPropagation();
              commitPendingImage();
            }}
          >
            {/* Semi-transparent image preview with border */}
            <div
              style={{
                position: 'absolute',
                left: pendingImage.x,
                top: pendingImage.y,
                width: pendingImage.w,
                height: pendingImage.h,
                cursor: 'move',
                outline: '2px dashed #3b82f6',
                outlineOffset: 1,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.25)',
              }}
              onPointerDown={(e) => startOverlayDrag(e, 'move')}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pendingImage.img.src}
                alt=""
                draggable={false}
                style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none', userSelect: 'none' }}
              />

              {/* Corner resize handles */}
              {handles.map(({ mode, cursor, style }) => (
                <div
                  key={mode}
                  style={{
                    position: 'absolute',
                    width: hs, height: hs,
                    background: '#fff',
                    border: '2px solid #3b82f6',
                    borderRadius: 2,
                    cursor,
                    ...style,
                  }}
                  onPointerDown={(e) => startOverlayDrag(e, mode)}
                />
              ))}

              {/* Commit / cancel hint */}
              <div
                style={{
                  position: 'absolute',
                  bottom: -32,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
                className="bg-gray-900/80 text-white text-xs px-2.5 py-1 rounded shadow"
              >
                Drag to resize · <kbd className="opacity-75">Enter</kbd> or click outside to place · <kbd className="opacity-75">Esc</kbd> to cancel
              </div>
            </div>
          </div>
        )}

        {annotations.length > 0 && (
          <svg className="absolute inset-0 pointer-events-none" width={canvasDims.w} height={canvasDims.h} xmlns="http://www.w3.org/2000/svg">
            {annotations.map((ann, i) => <AnnotationShape key={i} ann={ann} w={canvasDims.w} h={canvasDims.h} />)}
          </svg>
        )}

        {selection && (
          <svg className="absolute inset-0 pointer-events-none" width={canvasDims.w} height={canvasDims.h} xmlns="http://www.w3.org/2000/svg">
            <rect
              x={Math.min(selection.x1, selection.x2)} y={Math.min(selection.y1, selection.y2)}
              width={Math.abs(selection.x2 - selection.x1)} height={Math.abs(selection.y2 - selection.y1)}
              fill="rgba(59,130,246,0.07)" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="6 3"
            />
          </svg>
        )}
      </div>
    );

    const legend = annotations.length > 0 && (
      <div className="px-3 py-1.5 bg-amber-50 dark:bg-amber-950/20 border-t border-amber-200 dark:border-amber-800 flex items-center gap-1.5 shrink-0">
        <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">Tutor annotations active</span>
      </div>
    );

    const sidebarZoom = Math.max(0.8, Math.min(1.4, sidebarWidth / 320));

    if (fullscreen) {
      return (
        <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-950">
          {toolbar}
          <div className="flex flex-1 min-h-0">
            {canvasArea}
            {fullscreenSidebar && (
              <>
                <div
                  className="shrink-0 border-l border-gray-200 dark:border-gray-700 hover:border-accent transition-colors cursor-col-resize w-1.5"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    sidebarResizeRef.current = { dragging: true, startX: e.clientX, startW: sidebarWidth };
                  }}
                  onPointerMove={(e) => {
                    if (!sidebarResizeRef.current.dragging) return;
                    const dx = sidebarResizeRef.current.startX - e.clientX;
                    setSidebarWidth(Math.min(800, Math.max(200, sidebarResizeRef.current.startW + dx)));
                  }}
                  onPointerUp={() => { sidebarResizeRef.current.dragging = false; }}
                  onPointerLeave={() => { sidebarResizeRef.current.dragging = false; }}
                />
                <div className="flex flex-col bg-white dark:bg-gray-900 shrink-0" style={{ width: sidebarOpen ? sidebarWidth : 32 }}>
                  <button
                    onClick={() => setSidebarOpen((o) => !o)}
                    title={sidebarOpen ? 'Collapse panel' : 'Expand panel'}
                    className="self-start m-1 w-6 h-6 rounded flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm font-bold"
                  >
                    {sidebarOpen ? '›' : '‹'}
                  </button>
                  {sidebarOpen && (
                    <div className="flex-1 overflow-y-auto">
                      <div style={{ zoom: sidebarZoom, padding: '0.75rem' }}>
                        {fullscreenSidebar}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {legend}
        </div>
      );
    }

    return (
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900 flex flex-col">
        {toolbar}
        {canvasArea}
        {legend}
      </div>
    );
  }
);

// ── Toolbar helpers ────────────────────────────────────────────

function ToolBtn({ active, onClick, title, disabled, children }: {
  active: boolean; onClick: () => void; title: string; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} title={title} disabled={disabled}
      className={`w-8 h-8 rounded flex items-center justify-center border transition-colors ${
        active ? 'bg-accent border-accent text-white'
          : disabled ? 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 text-gray-300 dark:text-gray-600 cursor-not-allowed'
          : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-400'
      }`}
    >{children}</button>
  );
}

function PenIcon() {
  return <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>;
}

function EraserIcon() {
  return (
    <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none">
      <rect x="2" y="10" width="16" height="7" rx="1.5" fill="currentColor" opacity="0.5" />
      <rect x="8" y="10" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M8 10 L13 3 L18 3 L18 10" fill="currentColor" opacity="0.8" />
      <line x1="8" y1="10" x2="8" y2="17" stroke="white" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

function SelectIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="3" width="14" height="14" rx="1" strokeDasharray="3.5 2.5" />
      <path d="M3 3l3 3M17 3l-3 3M3 17l3-3M17 17l-3-3" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

function UndoIcon() {
  return <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M7.793 2.232a.75.75 0 01-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 010 10.75H10.75a.75.75 0 010-1.5h2.875a3.875 3.875 0 000-7.75H3.622l4.146 3.957a.75.75 0 01-1.036 1.085l-5.5-5.25a.75.75 0 010-1.085l5.5-5.25a.75.75 0 011.061.025z" clipRule="evenodd" /></svg>;
}

function RedoIcon() {
  return <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M12.207 2.232a.75.75 0 00.025 1.06l4.146 3.958H6.375a5.375 5.375 0 000 10.75H9.25a.75.75 0 000-1.5H6.375a3.875 3.875 0 010-7.75h10.003l-4.146 3.957a.75.75 0 001.036 1.085l5.5-5.25a.75.75 0 000-1.085l-5.5-5.25a.75.75 0 00-1.061.025z" clipRule="evenodd" /></svg>;
}

function FullscreenIcon() {
  return <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M3.28 2.22a.75.75 0 00-1.06 1.06L5.44 6.5H2.75a.75.75 0 000 1.5H7a.75.75 0 00.75-.75V2.75a.75.75 0 00-1.5 0v2.69L2.28 2.22zM13 2.75a.75.75 0 011.5 0V5.44l3.22-3.22a.75.75 0 111.06 1.06L15.56 6.5h2.69a.75.75 0 010 1.5H13a.75.75 0 01-.75-.75V2.75zM2.75 13a.75.75 0 000 1.5H5.44l-3.22 3.22a.75.75 0 101.06 1.06L6.5 15.56v2.69a.75.75 0 001.5 0V13a.75.75 0 00-.75-.75H2.75zM13 17.25a.75.75 0 001.5 0V14.56l3.22 3.22a.75.75 0 101.06-1.06L15.56 13.5h2.69a.75.75 0 000-1.5H13a.75.75 0 00-.75.75v4.5z" clipRule="evenodd" /></svg>;
}

function ExitFullscreenIcon() {
  return <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M3.22 3.22a.75.75 0 011.06 0L7 5.94V3.25a.75.75 0 011.5 0V7.5A.75.75 0 017.75 8h-4.5a.75.75 0 010-1.5h2.69L3.22 4.28a.75.75 0 010-1.06zm13.56 0a.75.75 0 010 1.06L14.06 7h2.69a.75.75 0 010 1.5h-4.5A.75.75 0 0111.5 7.75v-4.5a.75.75 0 011.5 0v2.69l2.72-2.72a.75.75 0 011.06 0zM3.25 11.5a.75.75 0 000 1.5h2.69l-2.72 2.72a.75.75 0 101.06 1.06L7 14.06v2.69a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5zm9.25.75a.75.75 0 01.75-.75h4.5a.75.75 0 010 1.5h-2.69l2.72 2.72a.75.75 0 11-1.06 1.06L14 14.06v2.69a.75.75 0 01-1.5 0v-4.5z" clipRule="evenodd" /></svg>;
}
