"""Routes question figures to the appropriate renderer.

- table        → deterministic SVG (render_table); no server-side file needed,
                 frontend renders inline from structured spec
- simple_graph → deterministic SVG (render_graph); same — frontend renders inline
- complex_diagram → OpenAI image generation (DiagramGenerationService)

The first complex_diagram figure (if any) is generated as a PNG and its URL is
written to metadata.diagram_url for backward compatibility.
"""
from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.figures.render_table import render_table_svg
from src.figures.render_graph import render_graph_svg

LOGGER = logging.getLogger('oxai.figure_router')

_DETERMINISTIC = frozenset({'table', 'simple_graph'})
_REQUIRED_TABLE = ('table_headers', 'table_rows')
_REQUIRED_GRAPH = ('graph_type', 'graph_series')


def _validate_spec(fig: Dict[str, Any]) -> Optional[str]:
    ft = str(fig.get('figure_type') or 'complex_diagram')
    if ft == 'table':
        missing = [k for k in _REQUIRED_TABLE if not fig.get(k)]
        if missing:
            return f'table spec missing: {missing}'
    elif ft == 'simple_graph':
        missing = [k for k in _REQUIRED_GRAPH if not fig.get(k)]
        if missing:
            return f'simple_graph spec missing: {missing}'
    return None


def process_figures(
    draft: Dict[str, Any],
    diagram_dir: Path,
    diagram_service: Any,
    want_diagram: bool,
    force_diagram: bool = False,
    logger: Optional[logging.Logger] = None,
) -> None:
    """Process all figures in draft['prompt']['figures'] in-place.

    Deterministic figures are validated and left for the frontend to render.
    Complex diagrams are sent to the OpenAI image API; the resulting URL is
    stored in fig['url'] and metadata.diagram_url.

    Falls back to image generation when there are no figures but want_diagram
    or force_diagram is True (legacy / force path).
    """
    log = logger or LOGGER
    prompt = draft.get('prompt', {})
    figures: List[Dict[str, Any]] = list(prompt.get('figures') or [])
    metadata = draft.setdefault('metadata', {})
    ran_image_gen = False

    for i, fig in enumerate(figures):
        if not isinstance(fig, dict):
            continue
        ft = str(fig.get('figure_type') or 'complex_diagram')

        if ft in _DETERMINISTIC:
            err = _validate_spec(fig)
            if err:
                log.warning('Figure %d spec invalid (%s); marking as failed', i, err)
                draft.setdefault('data_quality_notes', []).append(
                    f'Figure {i} ({ft}) had invalid spec: {err}'
                )
            fig['url'] = None

        else:
            # complex_diagram — only generate once per question
            if ran_image_gen:
                fig['url'] = None
                continue
            if not diagram_service or not diagram_service.settings.enable_image_generation:
                fig['url'] = None
                continue
            log.info('[openai] images.generate (complex_diagram fig %d for %s)', i, draft.get('question_id'))
            path = diagram_service.generate(draft, want_diagram=True)
            if path:
                url = f'/diagrams/{path.name}'
                fig['url'] = url
                metadata['diagram_url'] = url
                ran_image_gen = True
                log.info('[openai] images.generate done → %s', path.name)
            else:
                fig['url'] = None
                draft.setdefault('data_quality_notes', []).append(
                    f'Complex diagram generation failed for figure {i}.'
                )

    # Write updated figures back
    prompt['figures'] = figures

    # Legacy fallback: no structured figures but diagram was requested
    if not figures and (want_diagram or force_diagram):
        if diagram_service and diagram_service.settings.enable_image_generation:
            if diagram_service.should_generate(draft, want_diagram=True):
                log.info('[openai] images.generate (no-figure fallback for %s)', draft.get('question_id'))
                path = diagram_service.generate(draft, want_diagram=True)
                if path:
                    metadata['diagram_url'] = f'/diagrams/{path.name}'
