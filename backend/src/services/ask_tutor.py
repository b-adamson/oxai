from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from openai import OpenAI

LOGGER = logging.getLogger('oxai.ask_tutor')


@dataclass
class TutorSettings:
    model: str = os.getenv('OPENAI_MODEL_DRAFT', 'gpt-5.2')
    temperature: float = 0.7
    max_output_tokens: int = 600


class TutorService:
    def __init__(self, settings: TutorSettings, logger: Optional[logging.Logger] = None) -> None:
        self.settings = settings
        self.logger = logger or LOGGER
        self.client = OpenAI()

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

    def _schema(self) -> Dict[str, Any]:
        return {
            'name': 'tutor_response',
            'schema': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['response', 'response_type'],
                'properties': {
                    'response': {'type': 'string'},
                    'response_type': {
                        'type': 'string',
                        'enum': ['hint', 'explanation', 'walkthrough', 'redirect'],
                    },
                },
            },
        }

    def _instructions(self, solution_available: bool, hints_shown: int) -> str:
        base = (
            'You are an expert NSAA tutor helping a student work through a multiple-choice exam question. '
            'Strict rules you must always follow:\n'
            '1. NEVER reveal the correct answer letter or which option is correct.\n'
            '2. Stay strictly on topic — only discuss this question, its subject, topic, and directly related concepts.\n'
            '3. If the student asks you to just give the answer, politely decline and redirect to reasoning.\n'
            '4. Prefer Socratic guidance: ask the student what they think, point out what to focus on, explain relevant concepts.\n'
            '5. Use LaTeX for all mathematics — $...$ for inline, $$...$$ for display equations.\n'
            '6. Be concise. Do not pad responses.\n'
        )

        if hints_shown > 0:
            base += f'The student has already seen {hints_shown} pre-generated hint(s) — do not simply repeat them.\n'

        if solution_available:
            base += (
                'A verified worked solution exists. You may use it to guide the student through the reasoning and method. '
                'You may discuss the approach and steps more directly now, but still do not reveal the final answer letter '
                'unless the student explicitly says they have already seen the worked solution.\n'
            )
        else:
            base += (
                'No verified solution exists yet. Focus only on concept explanations, useful approaches, '
                'and guiding questions. Do not commit to or guess the answer.\n'
            )

        base += (
            '\nSet response_type based on what your response primarily does:\n'
            '- "hint": a gentle directional nudge\n'
            '- "explanation": explaining a concept or principle\n'
            '- "walkthrough": stepping through partial reasoning\n'
            '- "redirect": declining an off-topic or answer-seeking request\n'
        )

        return base

    def respond(
        self,
        *,
        stem: str,
        options: List[Dict[str, str]],
        subject: str,
        topic: Optional[str],
        subtopic: Optional[str],
        difficulty: Optional[int],
        chat_history: List[Dict[str, str]],
        solution_available: bool,
        worked_solution: Optional[str],
        hints_shown: int,
    ) -> Dict[str, Any]:
        context: Dict[str, Any] = {
            'question': {
                'stem': stem,
                'options': options,
                'subject': subject,
                'topic': topic,
                'subtopic': subtopic,
                'difficulty': difficulty,
            }
        }
        if solution_available and worked_solution:
            context['worked_solution'] = worked_solution

        # Build input: system instructions + question context + interleaved chat history
        input_messages: List[Dict[str, str]] = [
            {
                'role': 'developer',
                'content': self._instructions(
                    solution_available=solution_available,
                    hints_shown=hints_shown,
                ),
            },
            {
                'role': 'user',
                'content': f'Question context:\n{json.dumps(context, ensure_ascii=False, indent=2)}',
            },
        ]

        for msg in chat_history:
            api_role = 'assistant' if msg.get('role') == 'tutor' else 'user'
            input_messages.append({'role': api_role, 'content': msg.get('text', '')})

        schema = self._schema()
        self.logger.info('[openai] responses.create  model=%s  schema=tutor_response  history_len=%d', self.settings.model, len(chat_history))
        t0 = time.perf_counter()
        response = self.client.responses.create(
            model=self.settings.model,
            input=input_messages,
            text={
                'format': {
                    'type': 'json_schema',
                    'name': schema['name'],
                    'schema': schema['schema'],
                    'strict': True,
                }
            },
            max_output_tokens=self.settings.max_output_tokens,
        )
        self.logger.info('[openai] responses.create done  schema=tutor_response  elapsed=%.2fs', time.perf_counter() - t0)

        return json.loads(self._response_text(response))
