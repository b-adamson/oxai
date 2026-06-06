'use client';
import type { FigureSpec, GraphSeries } from '@/lib/types';
import { MathText } from './MathText';

// ── Palette / layout constants ────────────────────────────────────────────────
const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed'];
const W = 520, H = 360, MT = 40, MR = 30, MB = 60, ML = 65;
const PW = W - ML - MR, PH = H - MT - MB;

// ── Helpers ───────────────────────────────────────────────────────────────────
function niceRange(vals: number[]): [number, number] {
  if (!vals.length) return [0, 1];
  const mn = Math.min(...vals), mx = Math.max(...vals);
  return mn === mx ? [mn - 1, mn + 1] : [mn, mx];
}

function niceTicks(lo: number, hi: number, n = 6): number[] {
  const span = hi - lo;
  if (span === 0) return [lo];
  const raw = span / Math.max(n - 1, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.max(mag, Math.round(raw / mag) * mag);
  const start = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= hi + step * 0.01; t += step) {
    if (t >= lo - step * 0.01 && t <= hi + step * 0.01) ticks.push(+t.toFixed(10));
  }
  return ticks.length ? ticks : [lo, hi];
}

function fmt(v: number): string {
  return v === Math.floor(v) ? String(Math.floor(v)) : v.toPrecision(3).replace(/\.?0+$/, '');
}

function px(xv: number, x0: number, x1: number): number {
  return ML + ((xv - x0) / (x1 - x0)) * PW;
}
function py(yv: number, y0: number, y1: number): number {
  return MT + (1 - (yv - y0) / (y1 - y0)) * PH;
}

// ── Table renderer ─────────────────────────────────────────────────────────────
function TableFigure({ spec }: { spec: FigureSpec }) {
  const headers = spec.table_headers ?? [];
  const rows = spec.table_rows ?? [];
  const rowLabels = spec.table_row_labels ?? [];
  const hasLabels = rowLabels.length > 0;

  return (
    <div className="overflow-x-auto my-4">
      <table className="border-collapse text-sm mx-auto">
        <thead>
          <tr>
            {hasLabels && <th className="border border-gray-400 bg-gray-200 px-3 py-1.5" />}
            {headers.map((h, i) => (
              <th key={i} className="border border-gray-400 bg-gray-200 px-3 py-1.5 font-semibold text-gray-800">
                <MathText text={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={r % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              {hasLabels && (
                <td className="border border-gray-300 bg-gray-100 px-3 py-1.5 font-medium text-gray-700">
                  <MathText text={rowLabels[r] ?? ''} />
                </td>
              )}
              {row.map((cell, c) => (
                <td key={c} className="border border-gray-300 px-3 py-1.5 text-center text-gray-800">
                  <MathText text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {spec.caption && (
        <p className="text-center text-xs text-gray-500 italic mt-1">{spec.caption}</p>
      )}
    </div>
  );
}

// ── Graph renderer ─────────────────────────────────────────────────────────────
function GraphFigure({ spec }: { spec: FigureSpec }) {
  const series = spec.graph_series ?? [];
  const graphType = spec.graph_type ?? 'line';
  const xTickLabels = spec.graph_x_labels ?? [];

  const allX = series.flatMap((s) => s.x_values);
  const allY = series.flatMap((s) => s.y_values);
  const [autoX0, autoX1] = niceRange(allX);
  const [autoY0, autoY1] = niceRange(allY);
  const x0 = spec.graph_x_min ?? autoX0;
  const x1 = spec.graph_x_max ?? autoX1;
  const y0 = spec.graph_y_min ?? autoY0;
  const y1 = spec.graph_y_max ?? autoY1;

  const xTicks = niceTicks(x0, x1);
  const yTicks = niceTicks(y0, y1);
  const nGroups = Math.max(...series.map((s) => s.x_values.length), 1);

  return (
    <div className="my-4 overflow-x-auto">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="mx-auto block"
        style={{ fontFamily: 'Arial,Helvetica,sans-serif', maxWidth: '100%' }}>
        <rect width={W} height={H} fill="white" />

        {/* Title */}
        {(spec.graph_title || spec.caption) && (
          <text x={W / 2} y={22} textAnchor="middle" fontSize={14} fontWeight="bold" fill="#111827">
            {spec.graph_title || spec.caption}
          </text>
        )}

        {/* Plot background */}
        <rect x={ML} y={MT} width={PW} height={PH} fill="#f9fafb" stroke="#d1d5db" />

        {/* Y-axis ticks + grid */}
        {yTicks.filter(t => t >= y0 - 1e-9 && t <= y1 + 1e-9).map((t, i) => {
          const yp = py(t, y0, y1);
          return (
            <g key={i}>
              <line x1={ML} y1={yp} x2={ML + PW} y2={yp} stroke="#e5e7eb" />
              <line x1={ML - 5} y1={yp} x2={ML} y2={yp} stroke="#6b7280" />
              <text x={ML - 8} y={yp + 4} textAnchor="end" fontSize={11} fill="#374151">{fmt(t)}</text>
            </g>
          );
        })}

        {/* X-axis ticks */}
        {graphType === 'bar' && xTickLabels.length > 0
          ? xTickLabels.slice(0, nGroups).map((lbl, i) => {
              const xp = ML + (i + 0.5) * (PW / nGroups);
              return (
                <text key={i} x={xp} y={MT + PH + 18} textAnchor="middle" fontSize={11} fill="#374151">
                  {lbl}
                </text>
              );
            })
          : xTicks.filter(t => t >= x0 - 1e-9 && t <= x1 + 1e-9).map((t, i) => {
              const xp = px(t, x0, x1);
              return (
                <g key={i}>
                  <line x1={xp} y1={MT + PH} x2={xp} y2={MT + PH + 5} stroke="#6b7280" />
                  <text x={xp} y={MT + PH + 18} textAnchor="middle" fontSize={11} fill="#374151">{fmt(t)}</text>
                </g>
              );
            })
        }

        {/* Axes */}
        <line x1={ML} y1={MT} x2={ML} y2={MT + PH} stroke="#374151" strokeWidth={1.5} />
        <line x1={ML} y1={MT + PH} x2={ML + PW} y2={MT + PH} stroke="#374151" strokeWidth={1.5} />

        {/* Series data */}
        {series.map((s, si) => {
          const color = PALETTE[si % PALETTE.length];
          const xs = s.x_values;
          const ys = s.y_values;

          if (graphType === 'line') {
            const pts = xs.map((xv, i) => `${px(xv, x0, x1).toFixed(1)},${py(ys[i] ?? 0, y0, y1).toFixed(1)}`);
            return (
              <g key={si}>
                {pts.length >= 2 && (
                  <path d={`M ${pts.join(' L ')}`} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
                )}
                {xs.map((xv, i) => (
                  <circle key={i} cx={px(xv, x0, x1)} cy={py(ys[i] ?? 0, y0, y1)} r={4} fill={color} />
                ))}
              </g>
            );
          }

          if (graphType === 'bar') {
            const nSeries = series.length;
            const groupW = PW / nGroups;
            const barW = (groupW * 0.8) / nSeries;
            const gap = groupW * 0.1;
            const zeroY = py(Math.max(y0, 0), y0, y1);
            return (
              <g key={si}>
                {xs.map((xv, i) => {
                  const bx = ML + i * groupW + gap + si * barW;
                  const top = py(ys[i] ?? 0, y0, y1);
                  const bh = Math.abs(zeroY - top);
                  return (
                    <rect key={i} x={bx} y={Math.min(top, zeroY)} width={barW} height={bh}
                      fill={color} opacity={0.85} />
                  );
                })}
              </g>
            );
          }

          if (graphType === 'scatter') {
            return (
              <g key={si}>
                {xs.map((xv, i) => (
                  <circle key={i} cx={px(xv, x0, x1)} cy={py(ys[i] ?? 0, y0, y1)}
                    r={5} fill={color} stroke="white" strokeWidth={1} opacity={0.85} />
                ))}
              </g>
            );
          }

          return null;
        })}

        {/* Axis labels */}
        {spec.graph_x_label && (
          <text x={ML + PW / 2} y={H - 8} textAnchor="middle" fontSize={13} fill="#374151">
            {spec.graph_x_label}
          </text>
        )}
        {spec.graph_y_label && (() => {
          const cx = 14, cy = MT + PH / 2;
          return (
            <text x={cx} y={cy} textAnchor="middle" fontSize={13} fill="#374151"
              transform={`rotate(-90 ${cx} ${cy})`}>
              {spec.graph_y_label}
            </text>
          );
        })()}

        {/* Legend (multiple series) */}
        {series.length > 1 && series.map((s, si) => {
          const color = PALETTE[si % PALETTE.length];
          const lx = ML + PW + 8, ly = MT + si * 20;
          return (
            <g key={si}>
              <rect x={lx} y={ly} width={12} height={12} fill={color} />
              <text x={lx + 16} y={ly + 10} fontSize={11} fill="#374151">{s.name}</text>
            </g>
          );
        })}
      </svg>
      {!spec.graph_title && spec.caption && (
        <p className="text-center text-xs text-gray-500 italic mt-1">{spec.caption}</p>
      )}
    </div>
  );
}

// ── Public component ───────────────────────────────────────────────────────────
export function FigureRenderer({ spec }: { spec: FigureSpec }) {
  if (spec.figure_type === 'table') {
    return <TableFigure spec={spec} />;
  }
  if (spec.figure_type === 'simple_graph') {
    return <GraphFigure spec={spec} />;
  }
  // complex_diagram — show the generated image URL
  if (spec.url) {
    return (
      <div className="my-4">
        <img src={spec.url} alt={spec.caption || 'Figure'}
          className="max-w-full max-h-72 mx-auto rounded border border-gray-200" />
        {spec.caption && (
          <p className="text-center text-xs text-gray-500 italic mt-1">{spec.caption}</p>
        )}
      </div>
    );
  }
  return null;
}
