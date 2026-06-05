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

        stem = str(prompt.get('stem', '')).strip()
        subject = str(content.get('subject', '')).strip()
        topic = str(content.get('topic', '') or '').strip()
        subtopic = str(content.get('subtopic', '') or '').strip()

        figure_text = ''
        if figures:
            pieces = []
            for fig in figures:
                if isinstance(fig, dict):
                    kind = str(fig.get('kind', 'diagram')).strip()
                    caption = str(fig.get('caption', '')).strip()
                    pieces.append(f'- {kind}: {caption}')
            figure_text = '\n'.join(pieces)

        return (
            'Create a clean educational diagram for an NSAA-style exam question. '
            'Rules: no question text, no answer text, no working, no labels that quote the question stem, no sentences. '
            'Only draw the geometric/physical/graphical elements described below. '
            'Use black lines on a white background, minimal clean style, exam-appropriate. '
            'Short axis labels and dimension markers are allowed, but no prose. '
            f'Subject: {subject}. Topic: {topic}. Subtopic: {subtopic}. '
            f'Figure notes:\n{figure_text or "- none"}'
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
