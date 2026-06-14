from __future__ import annotations

import base64
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from openai import OpenAI

LOGGER = logging.getLogger('oxai.generate_solution')


@dataclass
class SolutionSettings:
    diagram_dir: Path
    model: str = field(default_factory=lambda: os.getenv('OPENAI_MODEL_DRAFT', 'gpt-5.2'))
    image_model: str = field(default_factory=lambda: os.getenv('OPENAI_IMAGE_MODEL', 'gpt-image-2'))
    temperature: float = 0.3
    max_output_tokens: int = 1200
    review_max_output_tokens: int = 500
    max_retries: int = 2


class SolutionGenerationService:
    def __init__(self, settings: SolutionSettings, logger: Optional[logging.Logger] = None) -> None:
        self.settings = settings
        self.logger = logger or LOGGER
        self.client = OpenAI()
        self.settings.diagram_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Shared helpers (same pattern as generate_question.py)
    # ------------------------------------------------------------------

    def _response_text(self, response: Any) -> str:
        text = getattr(response, 'output_text', None)
        if isinstance(text, str) and text.strip():
            return text
        output = getattr(response, 'output', None)
        if isinstance(output, list):
            chunks: List[str] = []
            for item in output:
                content = getattr(item, 'content', None)
                if isinstance(content, list):
                    for part in content:
                        part_text = getattr(part, 'text', None)
                        if isinstance(part_text, str):
                            chunks.append(part_text)
            if chunks:
                return ''.join(chunks)
        raise ValueError('OpenAI response did not contain any text output.')

    def _call_structured(
        self,
        *,
        instructions: str,
        payload: Dict[str, Any],
        schema: Dict[str, Any],
        max_output_tokens: int,
    ) -> Dict[str, Any]:
        self.logger.info('[openai] responses.create  model=%s  schema=%s  max_tokens=%d', self.settings.model, schema['name'], max_output_tokens)
        t0 = time.perf_counter()
        response = self.client.responses.create(
            model=self.settings.model,
            input=[
                {'role': 'developer', 'content': instructions},
                {'role': 'user', 'content': json.dumps(payload, ensure_ascii=False, indent=2)},
            ],
            text={
                'format': {
                    'type': 'json_schema',
                    'name': schema['name'],
                    'schema': schema['schema'],
                    'strict': True,
                }
            },
            max_output_tokens=max_output_tokens,
        )
        self.logger.info('[openai] responses.create done  schema=%s  elapsed=%.2fs', schema['name'], time.perf_counter() - t0)
        return json.loads(self._response_text(response))

    # ------------------------------------------------------------------
    # Schemas
    # ------------------------------------------------------------------

    def _solution_schema(self) -> Dict[str, Any]:
        return {
            'name': 'worked_solution_draft',
            'schema': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['worked_solution', 'requires_diagram', 'diagram_prompt'],
                'properties': {
                    'worked_solution': {'type': 'string'},
                    'requires_diagram': {'type': 'boolean'},
                    'diagram_prompt': {'type': ['string', 'null']},
                },
            },
        }

    def _review_schema(self) -> Dict[str, Any]:
        return {
            'name': 'solution_review',
            'schema': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['status', 'notes'],
                'properties': {
                    'status': {'type': 'string', 'enum': ['verified', 'needs_revision']},
                    'notes': {'type': 'array', 'items': {'type': 'string'}},
                },
            },
        }

    # ------------------------------------------------------------------
    # Prompts
    # ------------------------------------------------------------------

    def _generation_instructions(self) -> str:
        return (
            'You are an expert NSAA tutor writing a worked solution for a multiple-choice question. '
            'The correct answer has already been verified — your task is to show the student how to reach it. '
            'Write clear, concise educational prose. '
            'Use LaTeX for all mathematics: $...$ for inline, $$...$$ for display equations. '
            'Work through the problem step by step without padding or repetition. '
            'End by explicitly stating the answer label in bold, e.g. **The answer is C**. '
            'Only set requires_diagram=true when a diagram would genuinely clarify the solution '
            '(e.g. a free-body diagram, ray diagram, or annotated geometric construction). '
            'If requires_diagram is true, provide a diagram_prompt describing only the visual elements '
            'to draw — no prose, no equations, no question text in the prompt.'
        )

    def _review_instructions(self) -> str:
        return (
            'You are verifying a worked solution for an NSAA-style multiple-choice question. '
            'Check all five criteria: '
            '(1) the reasoning logically leads to the verified answer, '
            '(2) every mathematical step is correct, '
            '(3) the final stated answer label matches the verified answer, '
            '(4) all LaTeX is syntactically valid, '
            '(5) the explanation is educational and appropriately concise. '
            'Return status=verified only if all five pass. '
            'Otherwise return needs_revision and describe each issue in notes.'
        )

    # ------------------------------------------------------------------
    # Diagram generation
    # ------------------------------------------------------------------

    def _generate_diagram(self, diagram_prompt: str, question_id: str) -> Optional[str]:
        output_path = self.settings.diagram_dir / f'{question_id}_solution.png'
        try:
            self.logger.info('[openai] images.generate  model=%s  (solution diagram for question_id=%s)', self.settings.image_model, question_id)
            t0 = time.perf_counter()
            response = self.client.images.generate(
                model=self.settings.image_model,
                prompt=(
                    'Create a clean educational diagram for an NSAA-style exam solution. '
                    'Black lines on a white background, minimal exam style. '
                    'No question text, no answer text, no prose — visual elements only. '
                    'Short axis labels and dimension markers are allowed. '
                    f'Diagram: {diagram_prompt}'
                ),
                n=1,
                size='1024x1024',
            )
            self.logger.info('[openai] images.generate done  elapsed=%.2fs', time.perf_counter() - t0)
            b64_json = None
            if getattr(response, 'data', None):
                b64_json = getattr(response.data[0], 'b64_json', None)
            if not b64_json:
                raise ValueError('No b64_json in image response.')
            output_path.write_bytes(base64.b64decode(b64_json))
            return f'/diagrams/{output_path.name}'
        except Exception:
            self.logger.exception('Solution diagram generation failed for question_id=%s', question_id)
            return None

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def generate(
        self,
        *,
        stem: str,
        options: List[Dict[str, str]],
        subject: str,
        topic: Optional[str],
        subtopic: Optional[str],
        verified_answer_label: str,
        verified_answer_text: Optional[str],
        question_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        qid = question_id or uuid.uuid4().hex

        payload = {
            'subject': subject,
            'topic': topic,
            'subtopic': subtopic,
            'stem': stem,
            'options': options,
            'verified_answer_label': verified_answer_label,
            'verified_answer_text': verified_answer_text,
        }

        last_error: Optional[Exception] = None

        for attempt in range(1, self.settings.max_retries + 1):
            try:
                draft = self._call_structured(
                    instructions=self._generation_instructions(),
                    payload=payload,
                    schema=self._solution_schema(),
                    max_output_tokens=self.settings.max_output_tokens,
                )

                review = self._call_structured(
                    instructions=self._review_instructions(),
                    payload={**payload, 'worked_solution': draft.get('worked_solution', '')},
                    schema=self._review_schema(),
                    max_output_tokens=self.settings.review_max_output_tokens,
                )

                status = review.get('status', 'needs_revision')
                notes = review.get('notes', [])

                if status != 'verified' and attempt < self.settings.max_retries:
                    self.logger.info(
                        'Solution review requested revision (attempt %d/%d): %s',
                        attempt, self.settings.max_retries, notes,
                    )
                    continue

                diagram_url: Optional[str] = None
                if draft.get('requires_diagram') and draft.get('diagram_prompt'):
                    diagram_url = self._generate_diagram(draft['diagram_prompt'], qid)

                return {
                    'status': status,
                    'worked_solution': draft.get('worked_solution', ''),
                    'final_answer_label': verified_answer_label,
                    'requires_diagram': bool(draft.get('requires_diagram', False)),
                    'diagram_url': diagram_url,
                }

            except Exception as exc:
                last_error = exc
                self.logger.warning(
                    'Solution generation attempt %d/%d failed: %s',
                    attempt, self.settings.max_retries, exc,
                )

        raise RuntimeError(
            f'Failed to generate worked solution after {self.settings.max_retries} attempts: {last_error}'
        )
