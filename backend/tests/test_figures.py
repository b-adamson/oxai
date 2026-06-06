"""Tests for deterministic figure rendering and routing."""
from __future__ import annotations

import sys
from pathlib import Path

# Allow imports from backend/core without install
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from src.figures.render_table import render_table_svg
from src.figures.render_graph import render_graph_svg
from src.figures.figure_router import process_figures, _validate_spec


# ── render_table_svg ──────────────────────────────────────────────

TABLE_SPEC = {
    'figure_type': 'table',
    'caption': 'Frequency distribution',
    'table_headers': ['Value', 'Frequency'],
    'table_rows': [['1', '3'], ['2', '7'], ['3', '5'], ['4', '2']],
    'table_row_labels': None,
    'diagram_prompt': None,
    'graph_type': None, 'graph_title': None,
    'graph_x_label': None, 'graph_y_label': None, 'graph_x_labels': None,
    'graph_series': None,
    'graph_x_min': None, 'graph_x_max': None, 'graph_y_min': None, 'graph_y_max': None,
}


def test_table_svg_is_valid_xml():
    svg = render_table_svg(TABLE_SPEC)
    assert svg.startswith('<svg')
    assert '</svg>' in svg


def test_table_svg_contains_headers():
    svg = render_table_svg(TABLE_SPEC)
    assert 'Value' in svg
    assert 'Frequency' in svg


def test_table_svg_contains_rows():
    svg = render_table_svg(TABLE_SPEC)
    assert '7' in svg  # max frequency


def test_table_svg_deterministic():
    svg1 = render_table_svg(TABLE_SPEC)
    svg2 = render_table_svg(TABLE_SPEC)
    assert svg1 == svg2


def test_table_svg_with_row_labels():
    spec = {**TABLE_SPEC, 'table_row_labels': ['Mon', 'Tue', 'Wed', 'Thu']}
    svg = render_table_svg(spec)
    assert 'Mon' in svg
    assert 'Thu' in svg


def test_table_svg_empty_rows():
    spec = {**TABLE_SPEC, 'table_rows': []}
    svg = render_table_svg(spec)
    assert '<svg' in svg


def test_table_escapes_special_chars():
    spec = {**TABLE_SPEC, 'table_headers': ['A & B', '<score>']}
    svg = render_table_svg(spec)
    assert '&amp;' in svg
    assert '&lt;' in svg


# ── render_graph_svg ──────────────────────────────────────────────

LINE_SPEC = {
    'figure_type': 'simple_graph',
    'caption': 'Speed vs time',
    'graph_type': 'line',
    'graph_title': 'Speed-time graph',
    'graph_x_label': 'Time (s)',
    'graph_y_label': 'Speed (m/s)',
    'graph_x_labels': None,
    'graph_series': [
        {'name': 'Car A', 'x_values': [0, 1, 2, 3, 4], 'y_values': [0, 5, 10, 10, 8]},
    ],
    'graph_x_min': None, 'graph_x_max': None,
    'graph_y_min': 0.0, 'graph_y_max': None,
    'diagram_prompt': None,
    'table_headers': None, 'table_rows': None, 'table_row_labels': None,
}

BAR_SPEC = {
    **LINE_SPEC,
    'graph_type': 'bar',
    'graph_x_labels': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    'graph_series': [
        {'name': 'Sales', 'x_values': [1, 2, 3, 4, 5], 'y_values': [3, 7, 5, 9, 4]},
    ],
}

SCATTER_SPEC = {
    **LINE_SPEC,
    'graph_type': 'scatter',
    'graph_series': [
        {'name': 'Data', 'x_values': [1, 2, 3, 4], 'y_values': [2, 4, 3, 5]},
    ],
}


def test_line_graph_svg_valid():
    svg = render_graph_svg(LINE_SPEC)
    assert svg.startswith('<svg')
    assert '</svg>' in svg


def test_line_graph_contains_labels():
    svg = render_graph_svg(LINE_SPEC)
    assert 'Time (s)' in svg
    assert 'Speed (m/s)' in svg


def test_line_graph_contains_path():
    svg = render_graph_svg(LINE_SPEC)
    assert '<path' in svg


def test_bar_graph_svg_valid():
    svg = render_graph_svg(BAR_SPEC)
    assert '<rect' in svg
    assert 'Mon' in svg


def test_scatter_graph_svg_valid():
    svg = render_graph_svg(SCATTER_SPEC)
    assert '<circle' in svg


def test_graph_svg_deterministic():
    svg1 = render_graph_svg(LINE_SPEC)
    svg2 = render_graph_svg(LINE_SPEC)
    assert svg1 == svg2


def test_multi_series_legend():
    spec = {
        **LINE_SPEC,
        'graph_series': [
            {'name': 'Car A', 'x_values': [0, 1, 2], 'y_values': [0, 5, 10]},
            {'name': 'Car B', 'x_values': [0, 1, 2], 'y_values': [0, 3, 6]},
        ],
    }
    svg = render_graph_svg(spec)
    assert 'Car A' in svg
    assert 'Car B' in svg


def test_graph_with_explicit_range():
    spec = {**LINE_SPEC, 'graph_x_min': 0.0, 'graph_x_max': 10.0,
            'graph_y_min': -5.0, 'graph_y_max': 20.0}
    svg = render_graph_svg(spec)
    assert '<svg' in svg


# ── figure_router._validate_spec ─────────────────────────────────

def test_validate_table_valid():
    assert _validate_spec(TABLE_SPEC) is None


def test_validate_table_missing_headers():
    spec = {**TABLE_SPEC, 'table_headers': None}
    assert _validate_spec(spec) is not None


def test_validate_graph_valid():
    assert _validate_spec(LINE_SPEC) is None


def test_validate_graph_missing_series():
    spec = {**LINE_SPEC, 'graph_series': None}
    assert _validate_spec(spec) is not None


def test_validate_complex_diagram_always_valid():
    spec = {'figure_type': 'complex_diagram', 'caption': 'Circuit', 'diagram_prompt': 'A simple circuit'}
    assert _validate_spec(spec) is None


# ── process_figures (no image service) ───────────────────────────

def _make_draft(*figs):
    return {
        'question_id': 'test-q-1',
        'prompt': {'stem': 'Test', 'figures': list(figs)},
        'metadata': {},
    }


class _NoopDiagramService:
    class settings:
        enable_image_generation = False

    def should_generate(self, *a, **kw):
        return False

    def generate(self, *a, **kw):
        return None


def test_process_figures_table_sets_url_none():
    draft = _make_draft(dict(TABLE_SPEC))
    process_figures(draft, Path('/tmp'), _NoopDiagramService(), want_diagram=False)
    fig = draft['prompt']['figures'][0]
    assert fig['url'] is None


def test_process_figures_invalid_table_adds_note():
    bad = {**TABLE_SPEC, 'table_headers': None}
    draft = _make_draft(dict(bad))
    process_figures(draft, Path('/tmp'), _NoopDiagramService(), want_diagram=False)
    assert any('invalid spec' in n for n in draft.get('data_quality_notes', []))


def test_process_figures_no_diagram_url_for_deterministic():
    draft = _make_draft(dict(TABLE_SPEC))
    process_figures(draft, Path('/tmp'), _NoopDiagramService(), want_diagram=False)
    assert 'diagram_url' not in draft['metadata']


def test_process_figures_complex_skipped_when_image_gen_disabled():
    fig = {
        'figure_type': 'complex_diagram',
        'caption': 'A triangle',
        'diagram_prompt': 'Right-angled triangle with sides 3,4,5',
    }
    draft = _make_draft(fig)
    process_figures(draft, Path('/tmp'), _NoopDiagramService(), want_diagram=True)
    assert draft['prompt']['figures'][0].get('url') is None


def test_process_figures_preserves_figure_order():
    draft = _make_draft(dict(TABLE_SPEC), dict(LINE_SPEC))
    process_figures(draft, Path('/tmp'), _NoopDiagramService(), want_diagram=False)
    figs = draft['prompt']['figures']
    assert figs[0]['figure_type'] == 'table'
    assert figs[1]['figure_type'] == 'simple_graph'


# ── Previously-garbled output: raw text table would produce invalid SVG ──

def test_old_prose_table_now_structured():
    """A question that previously required OpenAI to OCR a text table
    in the diagram prompt now has structured table_rows that render deterministically."""
    spec = {
        'figure_type': 'table',
        'caption': 'Number of goals scored per match',
        'table_headers': ['Goals', '0', '1', '2', '3', '4'],
        'table_rows': [['Frequency', '4', '7', '9', '3', '1']],
        'table_row_labels': None,
        'diagram_prompt': None,
        'graph_type': None, 'graph_title': None,
        'graph_x_label': None, 'graph_y_label': None, 'graph_x_labels': None,
        'graph_series': None,
        'graph_x_min': None, 'graph_x_max': None,
        'graph_y_min': None, 'graph_y_max': None,
    }
    svg = render_table_svg(spec)
    assert 'Goals' in svg
    assert 'Frequency' in svg
    assert svg.count('<rect') >= 6  # header + 5 data cells
