'use client';
import { useRef, useState } from 'react';
import type { FigureSpec, PaperSlot, QuestionRecord } from '@/lib/types';

interface PaperExportProps {
  slots: PaperSlot[];
  modules: string[];
  questions: Record<string, QuestionRecord>;
  durationSeconds: number | null;
}

const QUESTIONS_PER_MODULE = 20;

// ── Image fetching ─────────────────────────────────────────────

async function fetchBase64(url: string): Promise<string> {
  try {
    const abs = url.startsWith('/') ? window.location.origin + url : url;
    const resp = await fetch(abs);
    if (!resp.ok) return '';
    const blob = await resp.blob();
    return await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

// ── Graph / table → inline HTML string ────────────────────────

// Maths helpers (ported from FigureRenderer)
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
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  const n = pts.length;
  const ext = (a: [number, number], b: [number, number]): [number, number] =>
    [2 * a[0] - b[0], 2 * a[1] - b[1]];
  const all: [number, number][] = [ext(pts[0], pts[1]), ...pts, ext(pts[n - 1], pts[n - 2])];
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < n; i++) {
    const [p0, p1, p2, p3] = [all[i - 1], all[i], all[i + 1], all[i + 2]];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6, cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6, cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

const PALETTE = ['#1a1a1a', '#555', '#888', '#aaa', '#333'];

function renderLineSvg(spec: FigureSpec): string {
  const W = 440, H = 200, MT = 22, MR = 16, MB = 40, ML = 48;
  const PW = W - ML - MR, PH = H - MT - MB;
  const s0 = spec.graph_series?.[0]; if (!s0?.x_values?.length) return '';
  const allX = s0.x_values, allY = s0.y_values;
  const [ax0, ax1] = niceRange(allX, 0.02);
  const [ay0, ay1] = niceRange(allY, 0.08);
  const x0 = spec.graph_x_min ?? ax0, x1 = spec.graph_x_max ?? ax1;
  const y0 = spec.graph_y_min ?? ay0, y1 = spec.graph_y_max ?? ay1;
  const gx = (v: number) => ML + ((v - x0) / (x1 - x0)) * PW;
  const gy = (v: number) => MT + (1 - (v - y0) / (y1 - y0)) * PH;
  const pts: [number, number][] = allX.map((xv, i) => [gx(xv), gy(allY[i])]);
  const linePth = smoothPath(pts);
  const xTicks = niceTicks(x0, x1, 6), yTicks = niceTicks(y0, y1, 5);
  const yGrid = yTicks.map(t => {
    if (t < y0 - 1e-9 || t > y1 + 1e-9) return '';
    const yp = gy(t);
    return `<line x1="${ML}" y1="${yp.toFixed(1)}" x2="${(ML+PW).toFixed(1)}" y2="${yp.toFixed(1)}" stroke="#ccc" stroke-dasharray="3 3"/>
    <text x="${ML-4}" y="${(yp+3.5).toFixed(1)}" text-anchor="end" font-size="8" fill="#555">${fmt(t)}</text>`;
  }).join('');
  const xGrid = xTicks.map(t => {
    if (t < x0 - 1e-9 || t > x1 + 1e-9) return '';
    const xp = gx(t);
    return `<line x1="${xp.toFixed(1)}" y1="${(MT+PH).toFixed(1)}" x2="${xp.toFixed(1)}" y2="${(MT+PH+3).toFixed(1)}" stroke="#888"/>
    <text x="${xp.toFixed(1)}" y="${(MT+PH+12).toFixed(1)}" text-anchor="middle" font-size="8" fill="#555">${fmt(t)}</text>`;
  }).join('');
  const dots = allX.map((xv, i) =>
    `<circle cx="${gx(xv).toFixed(1)}" cy="${gy(allY[i]).toFixed(1)}" r="3" fill="white" stroke="#1a1a1a" stroke-width="1.5"/>`
  ).join('');
  return `<figure style="margin:4mm 0;text-align:center;">
    ${spec.graph_title ? `<div style="font-size:9pt;font-weight:600;margin-bottom:2mm;">${spec.graph_title}</div>` : ''}
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="max-width:100%;height:auto;display:block;margin:0 auto;" font-family="Arial,sans-serif">
      <rect x="${ML}" y="${MT}" width="${PW}" height="${PH}" fill="#fafafa" stroke="#ccc"/>
      ${yGrid}${xGrid}
      <line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT+PH}" stroke="#333" stroke-width="1.5"/>
      <line x1="${ML}" y1="${MT+PH}" x2="${ML+PW}" y2="${MT+PH}" stroke="#333" stroke-width="1.5"/>
      ${linePth ? `<path d="${linePth}" fill="none" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
      ${dots}
      ${spec.graph_x_label ? `<text x="${ML+PW/2}" y="${H-3}" text-anchor="middle" font-size="9" fill="#333">${spec.graph_x_label}</text>` : ''}
      ${spec.graph_y_label ? `<text x="10" y="${MT+PH/2}" text-anchor="middle" font-size="9" fill="#333" transform="rotate(-90 10 ${MT+PH/2})">${spec.graph_y_label}</text>` : ''}
    </svg>
    ${spec.caption ? `<div style="font-size:8pt;color:#555;font-style:italic;margin-top:1mm;">${spec.caption}</div>` : ''}
  </figure>`;
}

function renderBarSvg(spec: FigureSpec): string {
  const W = 440, H = 220, MT = 28, MR = 24, MB = 50, ML = 54;
  const PW = W - ML - MR, PH = H - MT - MB;
  const series = spec.graph_series ?? []; if (!series.length) return '';
  const allX = series.flatMap(s => s.x_values), allY = series.flatMap(s => s.y_values);
  const [ax0, ax1] = niceRange(allX, 0.02), [ay0, ay1] = niceRange(allY, 0.08);
  const x0 = spec.graph_x_min ?? ax0, x1 = spec.graph_x_max ?? ax1;
  const y0 = spec.graph_y_min ?? ay0, y1 = spec.graph_y_max ?? ay1;
  const sfx = (v: number) => ML + ((v - x0) / (x1 - x0)) * PW;
  const sfy = (v: number) => MT + (1 - (v - y0) / (y1 - y0)) * PH;
  const xLabels = spec.graph_x_labels ?? [];
  const nGroups = Math.max(...series.map(s => s.x_values.length), 1);
  const gType = spec.graph_type ?? 'bar';
  const yTicks = niceTicks(y0, y1, 5);
  const xTicks = niceTicks(x0, x1, 6);
  const yGrid = yTicks.filter(t => t >= y0 - 1e-9 && t <= y1 + 1e-9).map(t => {
    const yp = sfy(t);
    return `<line x1="${ML}" y1="${yp.toFixed(1)}" x2="${(ML+PW).toFixed(1)}" y2="${yp.toFixed(1)}" stroke="#ccc" stroke-dasharray="3 3"/>
    <text x="${ML-5}" y="${(yp+4).toFixed(1)}" text-anchor="end" font-size="9" fill="#555">${fmt(t)}</text>`;
  }).join('');
  const xAxis = xLabels.length > 0
    ? xLabels.slice(0, nGroups).map((lbl, i) =>
        `<text x="${(ML+(i+0.5)*(PW/nGroups)).toFixed(1)}" y="${(MT+PH+16).toFixed(1)}" text-anchor="middle" font-size="9" fill="#555">${lbl}</text>`
      ).join('')
    : xTicks.filter(t => t >= x0 - 1e-9 && t <= x1 + 1e-9).map(t =>
        `<text x="${sfx(t).toFixed(1)}" y="${(MT+PH+16).toFixed(1)}" text-anchor="middle" font-size="9" fill="#555">${fmt(t)}</text>`
      ).join('');
  const bars = series.map((s, si) => {
    const fill = PALETTE[si % PALETTE.length];
    const zy = sfy(Math.max(y0, 0));
    if (gType === 'scatter') return s.x_values.map((xv, i) =>
      `<circle cx="${sfx(xv).toFixed(1)}" cy="${sfy(s.y_values[i]??0).toFixed(1)}" r="4" fill="${fill}" stroke="white" stroke-width="1"/>`
    ).join('');
    const nS = series.length, gW = PW / nGroups, bW = (gW * 0.8) / nS, gap = gW * 0.1;
    return s.x_values.map((_xv, i) => {
      const bx = ML + i * gW + gap + si * bW;
      const top = sfy(s.y_values[i] ?? 0);
      return `<rect x="${bx.toFixed(1)}" y="${Math.min(top,zy).toFixed(1)}" width="${bW.toFixed(1)}" height="${Math.abs(zy-top).toFixed(1)}" fill="${fill}" opacity="0.85"/>`;
    }).join('');
  }).join('');
  return `<figure style="margin:4mm 0;text-align:center;">
    ${spec.graph_title ? `<div style="font-size:9pt;font-weight:600;margin-bottom:2mm;">${spec.graph_title}</div>` : ''}
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="max-width:100%;height:auto;display:block;margin:0 auto;" font-family="Arial,sans-serif">
      ${spec.graph_title ? `<text x="${(ML+PW/2).toFixed(1)}" y="18" text-anchor="middle" font-size="11" font-weight="600" fill="#111">${spec.graph_title}</text>` : ''}
      <rect x="${ML}" y="${MT}" width="${PW}" height="${PH}" fill="#fafafa" stroke="#ccc"/>
      ${yGrid}${xAxis}
      <line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT+PH}" stroke="#333" stroke-width="1.5"/>
      <line x1="${ML}" y1="${MT+PH}" x2="${ML+PW}" y2="${MT+PH}" stroke="#333" stroke-width="1.5"/>
      ${bars}
      ${spec.graph_x_label ? `<text x="${(ML+PW/2).toFixed(1)}" y="${H-4}" text-anchor="middle" font-size="10" fill="#333">${spec.graph_x_label}</text>` : ''}
      ${spec.graph_y_label ? `<text x="12" y="${(MT+PH/2).toFixed(1)}" text-anchor="middle" font-size="10" fill="#333" transform="rotate(-90 12 ${MT+PH/2})">${spec.graph_y_label}</text>` : ''}
    </svg>
    ${spec.caption ? `<div style="font-size:8pt;color:#555;font-style:italic;margin-top:1mm;">${spec.caption}</div>` : ''}
  </figure>`;
}

function renderTableHtml(spec: FigureSpec): string {
  const headers = spec.table_headers ?? [];
  const rows = spec.table_rows ?? [];
  const rowLabels = spec.table_row_labels ?? [];
  const hasLabels = rowLabels.length > 0;
  const th = (s: string) => `<th style="border:1pt solid #999;background:#eee;padding:3pt 7pt;font-weight:600;font-size:10pt;">${s}</th>`;
  const td = (s: string, bg = '#fff') => `<td style="border:1pt solid #bbb;padding:2.5pt 7pt;text-align:center;font-size:10pt;background:${bg};">${s}</td>`;
  const tds = (s: string) => `<td style="border:1pt solid #bbb;background:#f5f5f5;padding:2.5pt 7pt;font-weight:600;font-size:10pt;">${s}</td>`;
  const headerRow = `<tr>${hasLabels ? th('') : ''}${headers.map(h => th(h)).join('')}</tr>`;
  const bodyRows = rows.map((row, r) =>
    `<tr>${hasLabels ? tds(rowLabels[r] ?? '') : ''}${row.map(c => td(c, r % 2 ? '#fafafa' : '#fff')).join('')}</tr>`
  ).join('');
  return `<figure style="margin:4mm 0;overflow-x:auto;text-align:center;">
    <table style="border-collapse:collapse;margin:0 auto;font-family:Arial,sans-serif;">
      <thead>${headerRow}</thead><tbody>${bodyRows}</tbody>
    </table>
    ${spec.caption ? `<div style="font-size:8pt;color:#555;font-style:italic;margin-top:2mm;">${spec.caption}</div>` : ''}
  </figure>`;
}

function renderFigureHtml(spec: FigureSpec, imageMap: Map<string, string>): string {
  if (spec.figure_type === 'table') return renderTableHtml(spec);
  if (spec.figure_type === 'simple_graph') {
    const t = spec.graph_type ?? 'line';
    return t === 'line' ? renderLineSvg(spec) : renderBarSvg(spec);
  }
  if (spec.figure_type === 'complex_diagram' && spec.url) {
    const src = imageMap.get(spec.url) || (window.location.origin + spec.url);
    return `<figure style="margin:4mm 0;text-align:center;"><img src="${src}" alt="${spec.caption ?? 'Figure'}" style="max-width:100%;max-height:180pt;object-fit:contain;display:block;margin:0 auto;border:0.5pt solid #ccc;" />${spec.caption ? `<div style="font-size:8pt;color:#555;font-style:italic;margin-top:1mm;">${spec.caption}</div>` : ''}</figure>`;
  }
  return '';
}

// ── Main component ─────────────────────────────────────────────

export function PaperExport({ slots, modules, questions, durationSeconds }: PaperExportProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('ESAT Practice Paper');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [instructions, setInstructions] = useState(
    'Answer ALL questions. Each question carries one mark. There is no penalty for incorrect answers. Do not write in the margins.'
  );
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setLogoDataUrl(ev.target?.result as string ?? null);
    reader.readAsDataURL(file);
  }

  async function handleExport() {
    setExporting(true);
    try {
      // Collect all image URLs that need fetching
      const urlsToFetch = new Set<string>();
      for (const slot of slots) {
        const q = slot.question_id ? questions[slot.question_id] : null;
        if (!q) continue;
        if (q.diagram_url) urlsToFetch.add(q.diagram_url);
        for (const fig of q.figures ?? []) {
          if ((fig as FigureSpec).url) urlsToFetch.add((fig as FigureSpec).url!);
        }
      }

      // Fetch all images in parallel → base64 map
      const imageMap = new Map<string, string>();
      await Promise.all([...urlsToFetch].map(async (url) => {
        const b64 = await fetchBase64(url);
        if (b64) imageMap.set(url, b64);
      }));

      const html = buildPaperHtml(imageMap);
      const w = window.open('', '_blank', 'width=950,height=750');
      if (!w) { alert('Pop-up blocked — please allow pop-ups for this site.'); return; }
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.addEventListener('load', () => setTimeout(() => w.print(), 900));
    } finally {
      setExporting(false);
    }
  }

  function esc(s: string) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function buildPaperHtml(imageMap: Map<string, string>): string {
    const durationLabel = durationSeconds
      ? `${Math.floor(durationSeconds / 60)} minutes`
      : 'No time limit';
    const formattedDate = date
      ? new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : '';

    type QEntry = { num: number; q: QuestionRecord };
    const sections: { module: string; entries: QEntry[] }[] = modules.map((mod, modIdx) => {
      const modSlots = slots.slice(modIdx * QUESTIONS_PER_MODULE, (modIdx + 1) * QUESTIONS_PER_MODULE);
      const entries: QEntry[] = [];
      modSlots.forEach((slot, i) => {
        const q = slot.question_id ? questions[slot.question_id] : null;
        if (q) entries.push({ num: modIdx * QUESTIONS_PER_MODULE + i + 1, q });
      });
      return { module: mod, entries };
    });

    const titlePageHtml = `
      <div class="page">
        <div class="title-inner">
          <div class="title-header">
            <div style="flex:1"></div>
            ${logoDataUrl ? `<img src="${logoDataUrl}" class="logo" alt="Logo" />` : ''}
          </div>
          <div class="title-body">
            <h1 class="paper-title">${esc(title)}</h1>
            ${description ? `<p class="paper-desc">${esc(description)}</p>` : ''}
            <table class="info-table">
              <tr><td class="il">Duration</td><td>${durationLabel}</td></tr>
              <tr><td class="il">Modules</td><td>${modules.map(esc).join(' · ')}</td></tr>
              <tr><td class="il">Questions</td><td>${modules.length * QUESTIONS_PER_MODULE} total (${QUESTIONS_PER_MODULE} per module)</td></tr>
              <tr><td class="il">Date</td><td>${esc(formattedDate)}</td></tr>
            </table>
            ${instructions ? `<div class="instructions-box"><strong>Instructions to candidates</strong><p>${esc(instructions)}</p></div>` : ''}
            <div class="candidate-box">
              <div class="cf">Name:<span class="dl"></span></div>
              <div class="cf" style="margin-top:5mm;">Candidate number:<span class="dl short"></span></div>
            </div>
          </div>
        </div>
      </div>`;

    let questionsHtml = '';
    for (const { module, entries } of sections) {
      if (entries.length === 0) continue;
      for (let i = 0; i < entries.length; i += 2) {
        const pair = entries.slice(i, i + 2);
        const isFirstInModule = i === 0;
        questionsHtml += `<div class="page">\n`;
        if (isFirstInModule) {
          questionsHtml += `<div class="section-header"><h2>${esc(module)}</h2></div>\n`;
        }
        for (const { num, q } of pair) {
          const diagramSrc = q.diagram_url
            ? (imageMap.get(q.diagram_url) || (window.location.origin + q.diagram_url))
            : null;
          const figuresHtml = [
            diagramSrc ? `<figure style="margin:3mm 0;text-align:center;"><img src="${diagramSrc}" style="max-width:100%;max-height:160pt;object-fit:contain;display:block;margin:0 auto;border:0.5pt solid #ccc;" /></figure>` : '',
            ...(q.figures ?? []).map(f => renderFigureHtml(f as FigureSpec, imageMap)),
          ].filter(Boolean).join('');

          questionsHtml += `
            <div class="question">
              <div class="question-header">
                <span class="q-num">${num}.</span>
                <div class="q-body">
                  <div class="q-stem">${esc(q.stem)}</div>
                  ${figuresHtml}
                  <div class="options">
                    ${q.options.map(opt => `
                      <div class="option">
                        <span class="checkbox">&#9744;</span>
                        <span class="opt-label">${esc(opt.label)}</span>
                        <span class="opt-text">${esc(opt.text)}</span>
                      </div>`).join('')}
                  </div>
                </div>
              </div>
            </div>\n`;
        }
        questionsHtml += `</div>\n`;
      }
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous"/>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js" crossorigin="anonymous"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js" crossorigin="anonymous"
  onload="renderMathInElement(document.body,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false});"></script>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
@page { size: A4 portrait; margin: 0; }
body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; color: #000; }

/* ── Print action bar (screen only) ── */
.print-bar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
  background: #1a1a1a; color: #fff;
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 20px; font-family: Arial, sans-serif; font-size: 13px;
  box-shadow: 0 2px 8px rgba(0,0,0,.3);
}
.print-bar button {
  background: #fff; color: #000; border: none; border-radius: 6px;
  padding: 7px 20px; font-size: 13px; font-weight: 700; cursor: pointer;
}
.print-bar button:hover { background: #eee; }
@media print { .print-bar { display: none !important; } }

/* ── A4 page containers ── */
.page {
  width: 210mm;
  min-height: 297mm;
  padding: 16mm 18mm;
  background: #fff;
  position: relative;
  overflow: hidden;
}
@media screen {
  body { background: #bbb; padding: 52px 16px 16px; }
  .page { margin: 8mm auto; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
}
@media print {
  body { background: #fff; padding: 0; }
  .page { page-break-after: always; break-after: page; margin: 0; width: 210mm; min-height: 297mm; }
  .page:last-child { page-break-after: avoid; break-after: avoid; }
}

/* ── Title page ── */
.title-inner { display: flex; flex-direction: column; min-height: calc(297mm - 32mm); }
.title-header { display: flex; justify-content: flex-end; min-height: 20mm; }
.logo { max-width: 72pt; max-height: 72pt; object-fit: contain; }
.title-body { flex: 1; padding-top: 20mm; }
.paper-title { font-family: Arial, Helvetica, sans-serif; font-size: 24pt; font-weight: 700; margin-bottom: 4mm; }
.paper-desc { font-size: 12pt; color: #444; margin-bottom: 8mm; }
.info-table { border: 1pt solid #000; border-collapse: collapse; width: 100%; margin-bottom: 6mm; }
.info-table td { padding: 2mm 4mm; font-size: 10pt; border-bottom: 0.5pt solid #ccc; }
.info-table td.il { font-weight: 700; font-family: Arial, sans-serif; width: 80pt; background: #f5f5f5; }
.instructions-box { border: 1pt solid #000; padding: 4mm; margin-bottom: 6mm; font-size: 10pt; }
.instructions-box strong { font-family: Arial, sans-serif; display: block; margin-bottom: 2mm; }
.candidate-box { margin-top: auto; border: 2pt solid #000; padding: 5mm; background: #fafafa; }
.cf { font-family: Arial, sans-serif; font-size: 12pt; display: flex; align-items: flex-end; gap: 6pt; }
.dl { flex: 1; border-bottom: 1pt solid #000; display: inline-block; min-width: 110pt; margin-bottom: 1pt; }
.dl.short { flex: 0.4; min-width: 60pt; }

/* ── Section header ── */
.section-header { margin-bottom: 5mm; padding-bottom: 2mm; border-bottom: 2pt solid #000; }
.section-header h2 { font-family: Arial, Helvetica, sans-serif; font-size: 14pt; font-weight: 700; }

/* ── Questions ── */
.question { margin-bottom: 8mm; padding-bottom: 6mm; border-bottom: 0.5pt solid #ccc; }
.question:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
.question-header { display: flex; gap: 4pt; align-items: flex-start; }
.q-num { font-weight: 700; font-family: Arial, sans-serif; min-width: 16pt; flex-shrink: 0; padding-top: 1pt; }
.q-body { flex: 1; min-width: 0; }
.q-stem { line-height: 1.6; margin-bottom: 3mm; }
.options { display: flex; flex-direction: column; gap: 2mm; margin-left: 2mm; }
.option { display: flex; align-items: baseline; gap: 5pt; }
.checkbox { font-size: 10pt; flex-shrink: 0; }
.opt-label { font-weight: 700; font-family: Arial, sans-serif; min-width: 13pt; flex-shrink: 0; font-size: 10.5pt; }
.opt-text { line-height: 1.45; }
</style>
</head>
<body>
<div class="print-bar">
  <span>📄 <strong>${esc(title)}</strong></span>
  <div style="display:flex;align-items:center;gap:14px;">
    <span style="opacity:.75;font-size:11px;">In the print dialog set destination to <strong>Save as PDF</strong></span>
    <button onclick="window.print()">⬇ Save as PDF</button>
  </div>
</div>
<div style="padding-top:52px;">
${titlePageHtml}
${questionsHtml}
</div>
</body>
</html>`;
  }

  return (
    <div className="mt-4 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-semibold text-gray-700 dark:text-gray-300"
      >
        <span className="flex items-center gap-2">
          <span>🖨️</span> Export Paper as PDF
        </span>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 p-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Paper title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
              Description <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Cambridge ESAT Mock — Autumn Term 2025"
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-gray-400"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Date on front page</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                Logo <span className="font-normal text-gray-400">(top-right, optional)</span>
              </label>
              <div className="flex items-center gap-2 h-[34px]">
                <button
                  onClick={() => logoInputRef.current?.click()}
                  className="text-xs border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  {logoDataUrl ? 'Change logo' : 'Upload logo'}
                </button>
                {logoDataUrl && (
                  <>
                    <button onClick={() => setLogoDataUrl(null)} className="text-xs text-red-400 hover:text-red-600">✕</button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logoDataUrl} alt="Logo preview" className="h-7 w-7 object-contain rounded border border-gray-200" />
                  </>
                )}
              </div>
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Instructions to candidates</label>
            <textarea
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              rows={3}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-accent resize-none"
            />
          </div>

          {durationSeconds && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Duration on title page: <strong>{Math.floor(durationSeconds / 60)} min</strong>
            </p>
          )}

          <button
            onClick={handleExport}
            disabled={exporting}
            className="w-full py-2.5 bg-gray-900 dark:bg-white hover:bg-gray-700 dark:hover:bg-gray-200 disabled:opacity-50 text-white dark:text-gray-900 text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {exporting ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Fetching images…
              </>
            ) : (
              '⬇ Generate PDF'
            )}
          </button>
          <p className="text-xs text-center text-gray-400">
            Opens a preview window — click <strong>Download PDF</strong> or use <strong>Ctrl+P → Save as PDF</strong>
          </p>
        </div>
      )}
    </div>
  );
}
