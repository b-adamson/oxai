from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from openai import OpenAI

LOGGER = logging.getLogger('oxai.generate_hint')

LEVEL_INSTRUCTIONS = {
    1: (
        'You are a tutor giving a very gentle first hint for an NSAA-style exam question. '
        'Point the student toward the relevant concept or topic area only. '
        'Do NOT suggest a method, approach, or any calculation. '
        'Do NOT reveal or imply the answer. '
        'One or two sentences maximum.'
    ),
    2: (
        'You are a tutor giving a moderate second hint for an NSAA-style exam question. '
        'The student has already had a conceptual nudge. '
        'Now suggest which method or approach to use, without doing any of the work. '
        'Do NOT give any numerical values, working, or the answer. '
        'Two or three sentences maximum.'
    ),
    3: (
        'You are a tutor giving a final detailed hint for an NSAA-style exam question. '
        'The student has already been told the concept and the approach. '
        'Now describe the first concrete step they should take — set up the equation, '
        'identify the key quantity, or draw the first line of working — but stop there. '
        'Do NOT complete the solution or reveal the answer. '
        'Two to four sentences maximum.'
    ),
}


@dataclass
class HintSettings:
    model: str = os.getenv('OPENAI_MODEL_DRAFT', 'gpt-5.2')
    temperature: float = 0.5
    max_output_tokens: int = 300


class HintGenerationService:
    def __init__(self, settings: HintSettings, logger: Optional[logging.Logger] = None) -> None:
        self.settings = settings
        self.logger = logger or LOGGER
        self.client = OpenAI()

    def _hint_schema(self) -> Dict[str, Any]:
        return {
            'name': 'hint_response',
            'schema': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['level', 'hint'],
                'properties': {
                    'level': {'type': 'integer', 'enum': [1, 2, 3]},
                    'hint': {'type': 'string'},
                },
            },
        }

    def generate_hint(
        self,
        stem: str,
        options: List[Dict[str, str]],
        subject: str,
        topic: Optional[str],
        level: int,
    ) -> Dict[str, Any]:
        if level not in (1, 2, 3):
            raise ValueError(f'Hint level must be 1, 2, or 3. Got: {level}')

        payload = {
            'subject': subject,
            'topic': topic,
            'hint_level': level,
            'question': {
                'stem': stem,
                'options': options,
            },
        }

        response = self.client.responses.create(
            model=self.settings.model,
            input=[
                {
                    'role': 'developer',
                    'content': LEVEL_INSTRUCTIONS[level],
                },
                {
                    'role': 'user',
                    'content': json.dumps(payload, ensure_ascii=False, indent=2),
                },
            ],
            text={
                'format': {
                    'type': 'json_schema',
                    'name': self._hint_schema()['name'],
                    'schema': self._hint_schema()['schema'],
                    'strict': True,
                }
            },
            temperature=self.settings.temperature,
            max_output_tokens=self.settings.max_output_tokens,
        )

        raw = self._response_text(response)
        result = json.loads(raw)
        result['level'] = level
        return result

    def _response_text(self, response: Any) -> str:
        text = getattr(response, 'output_text', None)
        if isinstance(text, str) and text.strip():
            return text

        output = getattr(response, 'output', None)
        if isinstance(output, list):
            chunks: list[str] = []
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
