from __future__ import annotations

import base64
import logging
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

from openai import OpenAI

LOGGER = logging.getLogger('oxai.generate_diagram')


@dataclass
class DiagramSettings:
    output_dir: Path
    model: str = os.getenv('OPENAI_IMAGE_MODEL', 'gpt-image-2')
    size: str = '1024x1024'
    enable_image_generation: bool = True


class DiagramGenerationService:
    def __init__(self, settings: DiagramSettings, logger: Optional[logging.Logger] = None) -> None:
        self.settings = settings
        self.logger = logger or LOGGER
        self.client = OpenAI()
        self.settings.output_dir.mkdir(parents=True, exist_ok=True)

    def should_generate(self, question: Dict[str, Any], want_diagram: bool) -> bool:
        content = question.get('content', {}) if isinstance(question.get('content', {}), dict) else {}
        prompt = question.get('prompt', {}) if isinstance(question.get('prompt', {}), dict) else {}

        if want_diagram:
            return True
        if bool(content.get('requires_diagram', False)):
            return True
        figures = prompt.get('figures', [])
        return isinstance(figures, list) and len(figures) > 0

    def build_prompt(self, question: Dict[str, Any]) -> str:
        content = question.get('content', {}) if isinstance(question.get('content', {}), dict) else {}
        prompt = question.get('prompt', {}) if isinstance(question.get('prompt', {}), dict) else {}
        figures = prompt.get('figures', []) if isinstance(prompt.get('figures', []), list) else []

        topic = str(content.get('topic', '') or '').strip()
        raw_stem = str(prompt.get('stem', '')).strip()
        stem_excerpt = raw_stem[:400] + ('...' if len(raw_stem) > 400 else '')

        figure_text = ''
        if figures:
            pieces = []
            for fig in figures:
                if isinstance(fig, dict):
                    kind = str(fig.get('kind', 'diagram')).strip()
                    caption = str(fig.get('caption', '')).strip()
                    fig_prompt = fig.get('prompt') or ''
                    line = f'- [{kind}] {caption}'
                    if fig_prompt:
                        line += f': {fig_prompt}'
                    pieces.append(line)
            figure_text = '\n'.join(pieces)

        return (
            'Draw a precise, exam-quality geometry/maths diagram. '
            'This is a STRICT GEOMETRY CONTRACT — every rule below is mandatory:\n\n'
            'MANDATORY RULES:\n'
            '1. LABEL every named point (A, B, C, D, O, P, Q, etc.) that appears in the question. Missing a label is an error.\n'
            '2. STRAIGHT segments must be drawn with perfectly straight lines — no curves, bends, or arcs unless the figure explicitly calls for a curve.\n'
            '3. TANGENTS must touch the circle at exactly one point. The tangent line must be visually flush with the circle at that point, not cutting through it.\n'
            '4. ANGLE MARKS must use exactly 3 points (vertex + two arms). Never draw a 4-point or multi-arc angle mark. A right-angle box uses exactly the corner vertex.\n'
            '5. INTERSECTIONS: lines must actually cross where the question says they meet. Do not let lines miss each other.\n'
            '6. DRAW ONLY what is described. Do not add extra lines, points, arcs, or annotations not specified in the figure notes.\n'
            '7. STYLE: black lines on pure white background, no shading, no colour, no prose text, no question text, no answer choices, no working.\n'
            '8. Short single-letter labels at named points are required. Axis tick labels and dimension values are allowed. No sentences.\n\n'
            f'Question topic: {topic}\n'
            f'Question stem (for context only — do NOT copy text into the diagram): {stem_excerpt}\n\n'
            f'Figure specification:\n{figure_text or "- Draw a clean minimal diagram appropriate for the topic above."}'
        )

    def _save_b64_png(self, b64_json: str, output_path: Path) -> Path:
        image_bytes = base64.b64decode(b64_json)
        output_path.write_bytes(image_bytes)
        return output_path

    def generate(self, question: Dict[str, Any], want_diagram: bool = False) -> Optional[Path]:
        if not self.should_generate(question, want_diagram=want_diagram):
            return None

        prompt = self.build_prompt(question)
        question_id = str(question.get('question_id') or uuid.uuid4())
        output_path = self.settings.output_dir / f'{question_id}.png'

        try:
            response = self.client.images.generate(
                model=self.settings.model,
                prompt=prompt,
                n=1,
                size=self.settings.size,
            )

            b64_json = None
            if getattr(response, 'data', None):
                first = response.data[0]
                b64_json = getattr(first, 'b64_json', None)

            if not b64_json:
                raise ValueError('Image response did not contain b64_json output.')

            return self._save_b64_png(b64_json, output_path)
        except Exception:
            self.logger.exception('Diagram generation failed for question_id=%s', question_id)
            return None
