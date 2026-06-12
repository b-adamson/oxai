'use client';
import React, { useEffect, useId, useRef, useState } from 'react';
import type { FigureSpec } from '@/lib/types';
import { MathText } from './MathText';

// ── Constants ─────────────────────────────────────────────────────────────
const ACCENT = '#2d8cf0';
const W = 480, H = 240;
const MT = 26, MR = 20, MB = 46, ML = 52;
const PW = W - ML - MR, PH = H - MT - MB;

// ── Math helpers ──────────────────────────────────────────────────────────
function niceRange(vals: number[], pad = 0.04): [number, number] {
  if (!vals.length) return [0, 1];
  const mn = Math.min(...vals), mx = Math.max(...vals);
  if (mn === mx) return [mn - 1, mn + 1];
  const span = mx - mn;
  return [mn - span * pad, mx + span * pad];
}

function niceTicks(lo: number, hi: number, maxN = 6): number[] {
  const span = hi - lo;
  if (span <= 0) return [lo];
  const raw = span / maxN;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(c => c * mag).find(s => span / s <= maxN + 1) ?? mag;
  const start = Math.ceil(lo / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let t = start; ticks.length <= maxN && t <= hi + step * 1e-9; t = +(t + step).toFixed(10))
    if (t >= lo - step * 1e-9) ticks.push(+t.toFixed(10));
  return ticks;
}

function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v);
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k';
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toPrecision(3).replace(/\.?0+$/, '');
}

function gx(v: number, x0: number, x1: number) { return ML + ((v - x0) / (x1 - x0)) * PW; }
function gy(v: number, y0: number, y1: number) { return MT + (1 - (v - y0) / (y1 - y0)) * PH; }

// Catmull-Rom → cubic bezier through all points
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  const n = pts.length;
  const ext = (a: [number, number], b: [number, number]): [number, number] =>
    [2 * a[0] - b[0], 2 * a[1] - b[1]];
  const all: [number, number][] = [ext(pts[0], pts[1]), ...pts, ext(pts[n - 1], pts[n - 2])];
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < n; i++) {
    const [p0, p1, p2, p3] = [all[i - 1], all[i], all[i + 1], all[i + 2]];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function lerpY(allX: number[], allY: number[], dataX: number): number {
  if (!allX.length) return 0;
  if (dataX <= allX[0]) return allY[0];
  if (dataX >= allX[allX.length - 1]) return allY[allY.length - 1];
  for (let i = 0; i < allX.length - 1; i++) {
    if (dataX >= allX[i] && dataX <= allX[i + 1]) {
      const t = (dataX - allX[i]) / (allX[i + 1] - allX[i]);
      return allY[i] + t * (allY[i + 1] - allY[i]);
    }
  }
  return 0;
}

// ── Interactive line graph ────────────────────────────────────────────────
function InteractiveLine({ spec }: { spec: FigureSpec }) {
  // All hooks first — no early returns before this block
  const uid = useId().replace(/:/g, '');
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ cx: number; cy: number; dx: number; dy: number } | null>(null);
  const [vx0, setVx0] = useState<number | null>(null);
  const [vx1, setVx1] = useState<number | null>(null);
  const vxRef = useRef({ x0: 0, x1: 1 });

  // Derive data — safe with fallbacks for empty series
  const s0 = spec.graph_series?.[0];
  const allX = s0?.x_values ?? [];
  const allY = s0?.y_values ?? [];
  const origX0 = spec.graph_x_min ?? (allX.length ? niceRange(allX, 0.02)[0] : 0);
  const origX1 = spec.graph_x_max ?? (allX.length ? niceRange(allX, 0.02)[1] : 1);
  const y0 = spec.graph_y_min ?? (allY.length ? niceRange(allY, 0.08)[0] : 0);
  const y1 = spec.graph_y_max ?? (allY.length ? niceRange(allY, 0.08)[1] : 1);
  const curX0 = vx0 ?? origX0;
  const curX1 = vx1 ?? origX1;
  vxRef.current = { x0: curX0, x1: curX1 };

  // Non-passive wheel listener for scroll-to-zoom
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !allX.length) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * (W / rect.width);
      if (cx < ML || cx > ML + PW) return;
      const { x0, x1 } = vxRef.current;
      const pivot = x0 + ((cx - ML) / PW) * (x1 - x0);
      const f = e.deltaY > 0 ? 1.28 : 0.78;
      const nx0 = Math.max(origX0, pivot - (pivot - x0) * f);
      const nx1 = Math.min(origX1, pivot + (x1 - pivot) * f);
      if (nx1 - nx0 < (origX1 - origX0) * 0.04) return;
      setVx0(nx0); setVx1(nx1);
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  // origX0/origX1 are stable for a given spec; allX.length guards no-data case
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origX0, origX1, allX.length]);

  // Guard after all hooks
  if (!allX.length) return null;

  const xTicks = niceTicks(curX0, curX1, 6);
  const yTicks = niceTicks(y0, y1, 5);
  const svgPts: [number, number][] = allX.map((xv, i) => [gx(xv, curX0, curX1), gy(allY[i], y0, y1)]);
  const linePth = smoothPath(svgPts);
  const areaPth = linePth
    ? `${linePth} L ${gx(allX[allX.length - 1], curX0, curX1).toFixed(1)} ${gy(y0, y0, y1).toFixed(1)} L ${gx(allX[0], curX0, curX1).toFixed(1)} ${gy(y0, y0, y1).toFixed(1)} Z`
    : '';

  function onMouseMove(e: React.MouseEvent) {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (W / rect.width);
    const cy = (e.clientY - rect.top) * (H / rect.height);
    if (cx < ML || cx > ML + PW || cy < MT || cy > MT + PH) { setHover(null); return; }
    const dx = curX0 + ((cx - ML) / PW) * (curX1 - curX0);
    const dy = lerpY(allX, allY, dx);
    setHover({ cx, cy: gy(dy, y0, y1), dx, dy });
  }

  const zoomed = vx0 !== null || vx1 !== null;
  const TW = 84, TH = 38;
  const tipX = hover ? (hover.cx + TW + 10 < ML + PW ? hover.cx + 8 : hover.cx - TW - 8) : 0;
  const tipY = hover ? Math.max(MT + 2, Math.min(MT + PH - TH - 2, hover.cy - TH / 2)) : 0;

  return (
    <figure className="my-2 select-none">
      {spec.graph_title && (
        <p className="text-center text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{spec.graph_title}</p>
      )}
      <svg
        ref={svgRef}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ maxWidth: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHover(null)}
        onDoubleClick={() => { setVx0(null); setVx1(null); }}
      >
        <defs>
          <linearGradient id={`ag${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.22" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0.01" />
          </linearGradient>
          <clipPath id={`cp${uid}`}>
            <rect x={ML} y={MT} width={PW} height={PH} />
          </clipPath>
          <filter id={`ds${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#00000016" />
          </filter>
        </defs>

        {/* Plot background */}
        <rect x={ML} y={MT} width={PW} height={PH} fill="var(--chart-bg)" rx={2} />

        {/* Y grid + labels */}
        {yTicks.map((t, i) => {
          if (t < y0 - 1e-9 || t > y1 + 1e-9) return null;
          const yp = gy(t, y0, y1);
          return (
            <g key={i}>
              <line x1={ML} y1={yp} x2={ML + PW} y2={yp} stroke="var(--chart-grid)" strokeDasharray="4 3" />
              <line x1={ML - 3} y1={yp} x2={ML} y2={yp} stroke="var(--chart-tick)" />
              <text x={ML - 5} y={yp + 3.5} textAnchor="end" fontSize={9} fill="var(--chart-tick)"
                fontFamily="system-ui,sans-serif">{fmt(t)}</text>
            </g>
          );
        })}

        {/* X ticks + labels */}
        {xTicks.map((t, i) => {
          if (t < curX0 - 1e-9 || t > curX1 + 1e-9) return null;
          const xp = gx(t, curX0, curX1);
          return (
            <g key={i}>
              <line x1={xp} y1={MT + PH} x2={xp} y2={MT + PH + 3} stroke="var(--chart-tick)" />
              <text x={xp} y={MT + PH + 13} textAnchor="middle" fontSize={9} fill="var(--chart-tick)"
                fontFamily="system-ui,sans-serif">{fmt(t)}</text>
            </g>
          );
        })}

        {/* Axes */}
        <line x1={ML} y1={MT} x2={ML} y2={MT + PH} stroke="var(--chart-axis)" strokeWidth={1.5} />
        <line x1={ML} y1={MT + PH} x2={ML + PW} y2={MT + PH} stroke="var(--chart-axis)" strokeWidth={1.5} />

        {/* Clipped: gradient fill + smooth curve + dots */}
        <g clipPath={`url(#cp${uid})`}>
          {areaPth && <path d={areaPth} fill={`url(#ag${uid})`} />}
          {linePth && (
            <path d={linePth} fill="none" stroke={ACCENT} strokeWidth={2.5}
              strokeLinecap="round" strokeLinejoin="round" />
          )}
          {allX.map((xv, i) => (
            <circle key={i} cx={gx(xv, curX0, curX1)} cy={gy(allY[i], y0, y1)}
              r={3} fill="var(--chart-bg)" stroke={ACCENT} strokeWidth={1.5} />
          ))}
        </g>

        {/* Axis labels */}
        {spec.graph_x_label && (
          <text x={ML + PW / 2} y={H - 3} textAnchor="middle" fontSize={9.5} fill="var(--chart-label)"
            fontFamily="system-ui,sans-serif">
            {spec.graph_x_label}
          </text>
        )}
        {spec.graph_y_label && (
          <text x={10} y={MT + PH / 2} textAnchor="middle" fontSize={9.5} fill="var(--chart-label)"
            fontFamily="system-ui,sans-serif"
            transform={`rotate(-90 10 ${MT + PH / 2})`}>
            {spec.graph_y_label}
          </text>
        )}

        {/* Zoom hint / reset */}
        {zoomed ? (
          <text x={ML + PW} y={MT - 4} textAnchor="end" fontSize={8.5} fill={ACCENT}
            style={{ cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); setVx0(null); setVx1(null); }}>
            reset zoom ×
          </text>
        ) : (
          <text x={ML + PW} y={MT - 4} textAnchor="end" fontSize={8} fill="var(--chart-hint)">
            scroll to zoom · dbl-click reset
          </text>
        )}

        {/* Hover crosshair + tooltip */}
        {hover && (
          <g>
            <line x1={hover.cx} y1={MT} x2={hover.cx} y2={MT + PH}
              stroke={ACCENT} strokeWidth={1} strokeDasharray="4 3" opacity={0.55} />
            <line x1={ML} y1={hover.cy} x2={ML + PW} y2={hover.cy}
              stroke={ACCENT} strokeWidth={1} strokeDasharray="4 3" opacity={0.25} />
            <circle cx={hover.cx} cy={hover.cy} r={5} fill={ACCENT} stroke="var(--chart-bg)" strokeWidth={2} />
            <rect x={tipX} y={tipY} width={TW} height={TH} rx={5}
              fill="var(--chart-bg)" stroke="var(--chart-grid)" strokeWidth={1} filter={`url(#ds${uid})`} />
            <text x={tipX + 7} y={tipY + 13} fontSize={9} fill="var(--chart-tick)" fontFamily="system-ui,sans-serif">
              x = {fmt(hover.dx)}
            </text>
            <text x={tipX + 7} y={tipY + 27} fontSize={9.5} fontWeight="700" fill="var(--chart-label)"
              fontFamily="system-ui,sans-serif">
              y = {fmt(hover.dy)}
            </text>
          </g>
        )}
      </svg>
      {spec.caption && (
        <figcaption className="text-center text-xs text-gray-400 italic mt-0.5">
          {spec.caption}
        </figcaption>
      )}
    </figure>
  );
}

// ── Static bar / scatter ──────────────────────────────────────────────────
const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed'];
const SW = 520, SH = 300, SMT = 36, SMR = 28, SMB = 56, SML = 62;
const SPW = SW - SML - SMR, SPH = SH - SMT - SMB;

function StaticGraph({ spec }: { spec: FigureSpec }) {
  const series = spec.graph_series ?? [];
  const allX = series.flatMap(s => s.x_values);
  const allY = series.flatMap(s => s.y_values);
  const [ax0, ax1] = niceRange(allX, 0.02);
  const [ay0, ay1] = niceRange(allY, 0.08);
  const x0 = spec.graph_x_min ?? ax0, x1 = spec.graph_x_max ?? ax1;
  const y0 = spec.graph_y_min ?? ay0, y1 = spec.graph_y_max ?? ay1;
  const xTicks = niceTicks(x0, x1, 6);
  const yTicks = niceTicks(y0, y1, 5);
  const nGroups = Math.max(...series.map(s => s.x_values.length), 1);
  const xLabels = spec.graph_x_labels ?? [];
  const gType = spec.graph_type ?? 'bar';
  function sfx(v: number) { return SML + ((v - x0) / (x1 - x0)) * SPW; }
  function sfy(v: number) { return SMT + (1 - (v - y0) / (y1 - y0)) * SPH; }

  return (
    <figure className="my-3 overflow-x-auto">
      <svg width={SW} height={SH} viewBox={`0 0 ${SW} ${SH}`}
        style={{ maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto', fontFamily: 'system-ui,sans-serif' }}>
        {spec.graph_title && (
          <text x={SML + SPW / 2} y={20} textAnchor="middle" fontSize={12} fontWeight="600" fill="#111827">
            {spec.graph_title}
          </text>
        )}
        <rect x={SML} y={SMT} width={SPW} height={SPH} fill="#fafbfc" />
        {yTicks.map((t, i) => {
          if (t < y0 - 1e-9 || t > y1 + 1e-9) return null;
          const yp = sfy(t);
          return <g key={i}>
            <line x1={SML} y1={yp} x2={SML + SPW} y2={yp} stroke="#e5e7eb" strokeDasharray="4 3" />
            <line x1={SML - 4} y1={yp} x2={SML} y2={yp} stroke="#9ca3af" />
            <text x={SML - 6} y={yp + 4} textAnchor="end" fontSize={10} fill="#6b7280">{fmt(t)}</text>
          </g>;
        })}
        {gType === 'bar' && xLabels.length > 0
          ? xLabels.slice(0, nGroups).map((lbl, i) => (
            <text key={i} x={SML + (i + 0.5) * (SPW / nGroups)} y={SMT + SPH + 16}
              textAnchor="middle" fontSize={10} fill="#6b7280">{lbl}</text>
          ))
          : xTicks.map((t, i) => {
            if (t < x0 - 1e-9 || t > x1 + 1e-9) return null;
            const xp = sfx(t);
            return <g key={i}>
              <line x1={xp} y1={SMT + SPH} x2={xp} y2={SMT + SPH + 4} stroke="#9ca3af" />
              <text x={xp} y={SMT + SPH + 16} textAnchor="middle" fontSize={10} fill="#6b7280">{fmt(t)}</text>
            </g>;
          })}
        <line x1={SML} y1={SMT} x2={SML} y2={SMT + SPH} stroke="#374151" strokeWidth={1.5} />
        <line x1={SML} y1={SMT + SPH} x2={SML + SPW} y2={SMT + SPH} stroke="#374151" strokeWidth={1.5} />
        {series.map((s, si) => {
          const color = PALETTE[si % PALETTE.length];
          const xs = s.x_values, ys = s.y_values;
          if (gType === 'scatter') return (
            <g key={si}>{xs.map((xv, i) => (
              <circle key={i} cx={sfx(xv)} cy={sfy(ys[i] ?? 0)}
                r={5} fill={color} stroke="white" strokeWidth={1} opacity={0.85} />
            ))}</g>
          );
          const nS = series.length, gW = SPW / nGroups, bW = (gW * 0.8) / nS, gap = gW * 0.1;
          const zy = sfy(Math.max(y0, 0));
          return <g key={si}>{xs.map((_xv, i) => {
            const bx = SML + i * gW + gap + si * bW;
            const top = sfy(ys[i] ?? 0);
            return <rect key={i} x={bx} y={Math.min(top, zy)} width={bW}
              height={Math.abs(zy - top)} fill={color} opacity={0.85} />;
          })}</g>;
        })}
        {spec.graph_x_label && (
          <text x={SML + SPW / 2} y={SH - 6} textAnchor="middle" fontSize={11} fill="#374151">
            {spec.graph_x_label}
          </text>
        )}
        {spec.graph_y_label && (
          <text x={12} y={SMT + SPH / 2} textAnchor="middle" fontSize={11} fill="#374151"
            transform={`rotate(-90 12 ${SMT + SPH / 2})`}>
            {spec.graph_y_label}
          </text>
        )}
        {series.length > 1 && series.map((s, si) => (
          <g key={si}>
            <rect x={SML + SPW + 6} y={SMT + si * 18} width={10} height={10}
              fill={PALETTE[si % PALETTE.length]} />
            <text x={SML + SPW + 20} y={SMT + si * 18 + 9} fontSize={10} fill="#374151">{s.name}</text>
          </g>
        ))}
      </svg>
      {spec.caption && (
        <figcaption className="text-center text-xs text-gray-400 italic mt-1">{spec.caption}</figcaption>
      )}
    </figure>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────
function TableFigure({ spec }: { spec: FigureSpec }) {
  const headers = spec.table_headers ?? [];
  const rows = spec.table_rows ?? [];
  const rowLabels = spec.table_row_labels ?? [];
  const hasLabels = rowLabels.length > 0;
  return (
    <div className="overflow-x-auto my-3">
      <table className="border-collapse text-sm mx-auto">
        <thead>
          <tr>
            {hasLabels && <th className="border border-gray-300 bg-gray-100 px-3 py-1.5" />}
            {headers.map((h, i) => (
              <th key={i} className="border border-gray-300 bg-gray-100 px-3 py-1.5 font-semibold text-gray-800">
                <MathText text={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={r % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              {hasLabels && (
                <td className="border border-gray-200 bg-gray-50 px-3 py-1.5 font-medium text-gray-700">
                  <MathText text={rowLabels[r] ?? ''} />
                </td>
              )}
              {row.map((cell, c) => (
                <td key={c} className="border border-gray-200 px-3 py-1.5 text-center text-gray-800">
                  <MathText text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {spec.caption && (
        <p className="text-center text-xs text-gray-400 italic mt-1">{spec.caption}</p>
      )}
    </div>
  );
}

// ── Fullscreen lightbox ───────────────────────────────────────────────────
function Lightbox({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div
        className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 hover:text-gray-900 dark:hover:text-white text-lg leading-none"
        >
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

function ExpandBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="View full size"
      className="absolute top-1 right-1 w-6 h-6 rounded bg-gray-100/80 dark:bg-gray-800/80 flex items-center justify-center text-gray-400 hover:text-accent text-xs opacity-0 group-hover:opacity-100 transition-opacity"
    >
      ⤢
    </button>
  );
}

// ── Public API ────────────────────────────────────────────────────────────
export function FigureRenderer({ spec }: { spec: FigureSpec }) {
  const [lightbox, setLightbox] = useState(false);

  if (spec.figure_type === 'table') return <TableFigure spec={spec} />;

  if (spec.figure_type === 'simple_graph') {
    const chart = (spec.graph_type ?? 'line') === 'line'
      ? <InteractiveLine spec={spec} />
      : <StaticGraph spec={spec} />;
    return (
      <>
        <div className="relative group">
          {chart}
          <ExpandBtn onClick={() => setLightbox(true)} />
        </div>
        {lightbox && (
          <Lightbox onClose={() => setLightbox(false)}>
            <div className="pt-4">{chart}</div>
          </Lightbox>
        )}
      </>
    );
  }

  if (spec.figure_type === 'complex_diagram') {
    if (spec.url) {
      return (
        <>
          <div className="my-3 relative group">
            <img
              src={spec.url}
              alt={spec.caption || 'Figure'}
              className="max-w-full max-h-[320px] object-contain mx-auto block rounded border border-gray-200 dark:border-gray-700"
            />
            <ExpandBtn onClick={() => setLightbox(true)} />
            {spec.caption && (
              <p className="text-center text-xs text-gray-400 italic mt-1">{spec.caption}</p>
            )}
          </div>
          {lightbox && (
            <Lightbox onClose={() => setLightbox(false)}>
              <img
                src={spec.url}
                alt={spec.caption || 'Figure'}
                className="max-w-full object-contain mx-auto block rounded"
              />
              {spec.caption && (
                <p className="text-center text-xs text-gray-400 italic mt-3">{spec.caption}</p>
              )}
            </Lightbox>
          )}
        </>
      );
    }
    return (
      <div className="my-3 rounded-xl border border-dashed border-accent/40 bg-accent/5 px-4 py-4">
        <p className="text-xs font-semibold text-accent mb-1 uppercase tracking-wide">Figure</p>
        <p className="text-xs text-gray-600 leading-relaxed">{spec.caption}</p>
      </div>
    );
  }

  return null;
}
