"""Deterministic SVG graph renderer for simple_graph figure specs."""
from __future__ import annotations

import xml.sax.saxutils as sax
from typing import Any, Dict, List, Optional, Tuple

_W, _H = 520, 360
_MT, _MR, _MB, _ML = 40, 30, 60, 65
_PW = _W - _ML - _MR
_PH = _H - _MT - _MB
_PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed']


def _e(text: str) -> str:
    return sax.escape(str(text))


def _data_range(series: List[Dict[str, Any]], axis: str) -> Tuple[float, float]:
    vals = [v for s in series for v in (s.get(f'{axis}_values') or [])]
    if not vals:
        return 0.0, 1.0
    mn, mx = min(vals), max(vals)
    if mn == mx:
        mn -= 1.0
        mx += 1.0
    return float(mn), float(mx)


def _nice_ticks(mn: float, mx: float, n: int = 6) -> List[float]:
    span = mx - mn
    if span == 0:
        return [mn]
    raw_step = span / max(n - 1, 1)
    magnitude = 10 ** (len(str(max(1, int(abs(raw_step))))) - 1)
    step = max(magnitude, round(raw_step / magnitude) * magnitude)
    start = (mn // step) * step
    ticks: List[float] = []
    t = start
    while t <= mx + step * 0.01:
        if mn - step * 0.01 <= t <= mx + step * 0.01:
            ticks.append(round(t, 10))
        t += step
    return ticks or [mn, mx]


def _fmt(v: float) -> str:
    return str(int(v)) if v == int(v) else f'{v:.3g}'


def render_graph_svg(fig: Dict[str, Any]) -> str:
    """Render a simple_graph figure spec to an SVG string."""
    graph_type = str(fig.get('graph_type') or 'line').lower()
    title = str(fig.get('graph_title') or fig.get('caption') or '').strip()
    x_label = str(fig.get('graph_x_label') or '').strip()
    y_label = str(fig.get('graph_y_label') or '').strip()
    x_tick_labels: List[str] = list(fig.get('graph_x_labels') or [])
    series_raw = fig.get('graph_series') or []

    series = [
        {
            'name': str(s.get('name', '')),
            'x_values': [float(v) for v in (s.get('x_values') or [])],
            'y_values': [float(v) for v in (s.get('y_values') or [])],
        }
        for s in series_raw if isinstance(s, dict)
    ]

    auto_x0, auto_x1 = _data_range(series, 'x')
    auto_y0, auto_y1 = _data_range(series, 'y')
    x0 = float(fig['graph_x_min']) if fig.get('graph_x_min') is not None else auto_x0
    x1 = float(fig['graph_x_max']) if fig.get('graph_x_max') is not None else auto_x1
    y0 = float(fig['graph_y_min']) if fig.get('graph_y_min') is not None else auto_y0
    y1 = float(fig['graph_y_max']) if fig.get('graph_y_max') is not None else auto_y1
    if x0 == x1:
        x1 = x0 + 1.0
    if y0 == y1:
        y1 = y0 + 1.0

    def px(xv: float) -> float:
        return _ML + (xv - x0) / (x1 - x0) * _PW

    def py(yv: float) -> float:
        return _MT + (1.0 - (yv - y0) / (y1 - y0)) * _PH

    parts: List[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{_W}" height="{_H}" '
        f'viewBox="0 0 {_W} {_H}" font-family="Arial,Helvetica,sans-serif">',
        '<rect width="100%" height="100%" fill="white"/>',
    ]

    if title:
        parts.append(
            f'<text x="{_W / 2:.1f}" y="22" text-anchor="middle" '
            f'font-size="14" font-weight="bold" fill="#111827">{_e(title)}</text>'
        )

    parts.append(
        f'<rect x="{_ML}" y="{_MT}" width="{_PW}" height="{_PH}" '
        f'fill="#f9fafb" stroke="#d1d5db" stroke-width="1"/>'
    )

    # Y-axis ticks + grid
    for t in _nice_ticks(y0, y1):
        if y0 - 1e-9 <= t <= y1 + 1e-9:
            yp = py(t)
            parts.append(
                f'<line x1="{_ML}" y1="{yp:.1f}" x2="{_ML + _PW}" y2="{yp:.1f}" '
                f'stroke="#e5e7eb" stroke-width="1"/>'
            )
            parts.append(
                f'<line x1="{_ML - 5}" y1="{yp:.1f}" x2="{_ML}" y2="{yp:.1f}" '
                f'stroke="#6b7280" stroke-width="1"/>'
            )
            parts.append(
                f'<text x="{_ML - 8}" y="{yp + 4:.1f}" text-anchor="end" '
                f'font-size="11" fill="#374151">{_e(_fmt(t))}</text>'
            )

    # X-axis ticks / labels
    n_groups = max((max(len(s['x_values']) for s in series) if series else 0), 1)
    if graph_type == 'bar' and x_tick_labels:
        group_w = _PW / n_groups
        for i, lbl in enumerate(x_tick_labels[:n_groups]):
            xp = _ML + (i + 0.5) * group_w
            parts.append(
                f'<text x="{xp:.1f}" y="{_MT + _PH + 18}" text-anchor="middle" '
                f'font-size="11" fill="#374151">{_e(str(lbl))}</text>'
            )
    else:
        for t in _nice_ticks(x0, x1):
            if x0 - 1e-9 <= t <= x1 + 1e-9:
                xp = px(t)
                parts.append(
                    f'<line x1="{xp:.1f}" y1="{_MT + _PH}" x2="{xp:.1f}" y2="{_MT + _PH + 5}" '
                    f'stroke="#6b7280" stroke-width="1"/>'
                )
                parts.append(
                    f'<text x="{xp:.1f}" y="{_MT + _PH + 18}" text-anchor="middle" '
                    f'font-size="11" fill="#374151">{_e(_fmt(t))}</text>'
                )

    # Axes
    parts.append(
        f'<line x1="{_ML}" y1="{_MT}" x2="{_ML}" y2="{_MT + _PH}" '
        f'stroke="#374151" stroke-width="1.5"/>'
    )
    parts.append(
        f'<line x1="{_ML}" y1="{_MT + _PH}" x2="{_ML + _PW}" y2="{_MT + _PH}" '
        f'stroke="#374151" stroke-width="1.5"/>'
    )

    # Data series
    for si, s in enumerate(series):
        color = _PALETTE[si % len(_PALETTE)]
        xs = s['x_values']
        ys = s['y_values']

        if graph_type == 'line':
            pts = [(px(xv), py(yv)) for xv, yv in zip(xs, ys)]
            if len(pts) >= 2:
                d = 'M ' + ' L '.join(f'{x:.1f},{y:.1f}' for x, y in pts)
                parts.append(
                    f'<path d="{d}" fill="none" stroke="{color}" '
                    f'stroke-width="2" stroke-linejoin="round"/>'
                )
            for xp, yp in pts:
                parts.append(f'<circle cx="{xp:.1f}" cy="{yp:.1f}" r="4" fill="{color}"/>')

        elif graph_type == 'bar':
            n_series = len(series)
            group_w = _PW / n_groups
            bar_w = group_w * 0.8 / n_series
            gap = group_w * 0.1
            zero_y = py(max(y0, 0.0))
            for i, (xv, yv) in enumerate(zip(xs, ys)):
                bx = _ML + i * group_w + gap + si * bar_w
                top = py(yv)
                h = abs(zero_y - top)
                bar_top = min(top, zero_y)
                parts.append(
                    f'<rect x="{bx:.1f}" y="{bar_top:.1f}" width="{bar_w:.1f}" height="{h:.1f}" '
                    f'fill="{color}" opacity="0.85"/>'
                )

        elif graph_type == 'scatter':
            for xv, yv in zip(xs, ys):
                parts.append(
                    f'<circle cx="{px(xv):.1f}" cy="{py(yv):.1f}" r="5" '
                    f'fill="{color}" stroke="white" stroke-width="1" opacity="0.85"/>'
                )

    # Axis labels
    if x_label:
        parts.append(
            f'<text x="{_ML + _PW / 2:.1f}" y="{_H - 8}" text-anchor="middle" '
            f'font-size="13" fill="#374151">{_e(x_label)}</text>'
        )
    if y_label:
        cx, cy = 14, _MT + _PH / 2
        parts.append(
            f'<text x="{cx}" y="{cy:.1f}" text-anchor="middle" font-size="13" fill="#374151" '
            f'transform="rotate(-90 {cx} {cy:.1f})">{_e(y_label)}</text>'
        )

    # Legend for multiple series
    if len(series) > 1:
        lx = _ML + _PW + 8
        for si, s in enumerate(series):
            color = _PALETTE[si % len(_PALETTE)]
            ly = _MT + si * 20
            parts.append(f'<rect x="{lx}" y="{ly}" width="12" height="12" fill="{color}"/>')
            parts.append(
                f'<text x="{lx + 16}" y="{ly + 10}" font-size="11" fill="#374151">{_e(s["name"])}</text>'
            )

    parts.append('</svg>')
    return '\n'.join(parts)
