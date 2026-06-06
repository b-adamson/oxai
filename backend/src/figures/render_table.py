"""Deterministic SVG table renderer for exam question figures."""
from __future__ import annotations

import xml.sax.saxutils as sax
from typing import Any, Dict, List

_CHAR_W = 8
_PAD_X = 12
_ROW_H = 28
_HEADER_H = 32
_CAPTION_H = 22
_FONT_BODY = 12
_FONT_HDR = 13
_MIN_COL_W = 48


def _e(text: str) -> str:
    return sax.escape(str(text))


def _col_width(header: str, cells: List[str]) -> int:
    max_chars = max((len(c) for c in [header] + cells), default=4)
    return max(int(max_chars * _CHAR_W + 2 * _PAD_X), _MIN_COL_W)


def render_table_svg(fig: Dict[str, Any]) -> str:
    """Render a table figure spec to an SVG string."""
    headers: List[str] = list(fig.get('table_headers') or [])
    rows: List[List[str]] = [list(r) for r in (fig.get('table_rows') or [])]
    row_labels: List[str] = list(fig.get('table_row_labels') or [])
    caption: str = str(fig.get('caption') or '').strip()

    n_data_cols = len(headers)
    has_labels = bool(row_labels)

    col_cells: List[List[str]] = [
        [str(row[c]) if c < len(row) else '' for row in rows]
        for c in range(n_data_cols)
    ]
    data_col_widths = [
        _col_width(headers[c] if c < len(headers) else '', col_cells[c])
        for c in range(n_data_cols)
    ]
    label_col_w = (
        _col_width('', [str(l) for l in row_labels]) if has_labels else 0
    )

    all_col_widths = ([label_col_w] if has_labels else []) + data_col_widths
    total_w = sum(all_col_widths) + 2
    table_h = _HEADER_H + len(rows) * _ROW_H
    total_h = table_h + (_CAPTION_H if caption else 6)

    parts: List[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_w}" height="{total_h}" '
        f'viewBox="0 0 {total_w} {total_h}" font-family="Arial,Helvetica,sans-serif">',
        '<rect width="100%" height="100%" fill="white"/>',
    ]

    def cell(x: float, y: float, w: float, h: float,
             text: str, bold: bool = False, bg: str = 'white') -> None:
        parts.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" '
            f'fill="{bg}" stroke="#9ca3af" stroke-width="0.5"/>'
        )
        fs = _FONT_HDR if bold else _FONT_BODY
        fw = 'bold' if bold else 'normal'
        ty = y + h / 2 + fs * 0.35
        parts.append(
            f'<text x="{x + w / 2:.1f}" y="{ty:.1f}" text-anchor="middle" '
            f'font-size="{fs}" font-weight="{fw}" fill="#111827">{_e(text)}</text>'
        )

    # Header row
    x = 1.0
    if has_labels:
        cell(x, 1.0, label_col_w, _HEADER_H, '', bold=True, bg='#e5e7eb')
        x += label_col_w
    for c, h in enumerate(headers):
        w = data_col_widths[c]
        cell(x, 1.0, w, _HEADER_H, h, bold=True, bg='#e5e7eb')
        x += w

    # Data rows
    for r, row in enumerate(rows):
        y = 1.0 + _HEADER_H + r * _ROW_H
        bg_alt = '#f9fafb' if r % 2 == 0 else 'white'
        x = 1.0
        if has_labels:
            lbl = str(row_labels[r]) if r < len(row_labels) else ''
            cell(x, y, label_col_w, _ROW_H, lbl, bold=True, bg='#f3f4f6')
            x += label_col_w
        for c in range(n_data_cols):
            val = str(row[c]) if c < len(row) else ''
            w = data_col_widths[c]
            cell(x, y, w, _ROW_H, val, bg=bg_alt)
            x += w

    if caption:
        cap_y = 1 + table_h + _CAPTION_H * 0.72
        parts.append(
            f'<text x="{total_w / 2:.1f}" y="{cap_y:.1f}" text-anchor="middle" '
            f'font-size="11" font-style="italic" fill="#6b7280">{_e(caption)}</text>'
        )

    parts.append('</svg>')
    return '\n'.join(parts)
