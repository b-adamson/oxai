from __future__ import annotations

import hashlib
import json
import logging
import os
import sqlite3
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from openai import OpenAI

from core.generate_diagram import DiagramGenerationService, DiagramSettings

LOGGER = logging.getLogger('oxai.generate_question')
OPTION_LABELS = ['A', 'B', 'C', 'D', 'E']


def _safe_json_dumps(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding='utf-8'))


def load_questions(processed_dir: Path) -> List[Dict[str, Any]]:
    questions: List[Dict[str, Any]] = []
    for path in sorted(processed_dir.rglob('*.json')):
        try:
            data = _load_json(path)
        except Exception:
            continue

        if isinstance(data, dict) and isinstance(data.get('questions'), list):
            for q in data['questions']:
                if isinstance(q, dict):
                    questions.append(q)
        elif isinstance(data, dict) and 'question_id' in data:
            questions.append(data)
    return questions


def compact_example(q: Dict[str, Any]) -> Dict[str, Any]:
    source = q.get('source', {}) if isinstance(q.get('source', {}), dict) else {}
    content = q.get('content', {}) if isinstance(q.get('content', {}), dict) else {}
    prompt = q.get('prompt', {}) if isinstance(q.get('prompt', {}), dict) else {}
    validation = q.get('validation', {}) if isinstance(q.get('validation', {}), dict) else {}

    return {
        'question_id': q.get('question_id'),
        'source': {
            'exam': source.get('exam'),
            'year': source.get('year'),
            'paper': source.get('paper'),
            'section': source.get('section'),
            'question_number': source.get('question_number'),
        },
        'content': {
            'subject': content.get('subject'),
            'topic': content.get('topic'),
            'subtopic': content.get('subtopic'),
            'archetype': content.get('archetype'),
            'difficulty': content.get('difficulty'),
            'requires_diagram': content.get('requires_diagram'),
        },
        'prompt': {
            'stem': prompt.get('stem'),
            'options': prompt.get('options', []),
        },
        'validation': {
            'answer_label': validation.get('answer_label'),
            'answer_text': validation.get('answer_text'),
            'status': validation.get('status'),
        },
    }


def choose_examples(
    questions: Sequence[Dict[str, Any]],
    subject: str,
    topic: Optional[str],
    difficulty: int,
    k: int,
    archetype: Optional[str] = None,
    want_diagram: bool = False,
) -> List[Dict[str, Any]]:
    scored: List[Tuple[int, Dict[str, Any]]] = []
    for q in questions:
        c = q.get('content', {}) if isinstance(q.get('content', {}), dict) else {}
        score = 0

        if str(c.get('subject', '')).lower() == subject.lower():
            score += 3
        if topic and str(c.get('topic', '')).lower() == topic.lower():
            score += 3
        if archetype and str(c.get('archetype', '')).lower() == archetype.lower():
            score += 2
        has_diagram = bool(c.get('requires_diagram'))
        if want_diagram and has_diagram:
            score += 2
        elif not want_diagram and not has_diagram:
            score += 1

        if c.get('difficulty') is not None:
            try:
                score += max(0, 3 - abs(int(c.get('difficulty')) - difficulty))
            except Exception:
                pass

        scored.append((score, q))

    scored.sort(key=lambda x: x[0], reverse=True)
    chosen = [q for s, q in scored[:k] if s > 0]
    return chosen or list(questions[:k])


def question_signature(question: Dict[str, Any]) -> str:
    prompt = question.get('prompt', {}) if isinstance(question.get('prompt', {}), dict) else {}
    content = question.get('content', {}) if isinstance(question.get('content', {}), dict) else {}
    payload = {
        'subject': content.get('subject'),
        'topic': content.get('topic'),
        'difficulty': content.get('difficulty'),
        'stem': prompt.get('stem'),
        'options': prompt.get('options', []),
    }
    return hashlib.sha256(_safe_json_dumps(payload).encode('utf-8')).hexdigest()


@dataclass
class GenerationSettings:
    processed_dir: Path
    generated_dir: Path
    diagram_dir: Path
    openai_model_draft: str = os.getenv('OPENAI_MODEL_DRAFT', 'gpt-5.2')
    openai_model_verify: str = os.getenv('OPENAI_MODEL_VERIFY', 'gpt-5.2')
    openai_model_image: str = os.getenv('OPENAI_IMAGE_MODEL', 'gpt-image-2')
    temperature: float = 0.7
    max_output_tokens: int = 1600
    verify_max_output_tokens: int = 1200
    examples: int = 3
    recent_signature_limit: int = 1000
    cache_examples: bool = True
    enable_image_generation: bool = True
    extra_instructions: Optional[str] = None
    _cached_questions: Optional[List[Dict[str, Any]]] = field(default=None, init=False, repr=False)


class RecentQuestionStore:
    def __init__(self, path: Path, maxlen: int = 1000):
        self.path = path
        self.maxlen = maxlen
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=30)
        conn.execute('PRAGMA journal_mode=WAL;')
        conn.execute('PRAGMA synchronous=NORMAL;')
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                'CREATE TABLE IF NOT EXISTS signatures ('
                'signature TEXT PRIMARY KEY,'
                'created_at TEXT DEFAULT CURRENT_TIMESTAMP'
                ')'
            )
            conn.execute(
                'CREATE TABLE IF NOT EXISTS meta ('
                'key TEXT PRIMARY KEY,'
                'value TEXT NOT NULL'
                ')'
            )
            conn.execute(
                'INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)',
                ('maxlen', str(self.maxlen)),
            )
            conn.commit()

    def contains(self, signature: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute('SELECT 1 FROM signatures WHERE signature = ? LIMIT 1', (signature,))
            return cur.fetchone() is not None

    def add(self, signature: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute('INSERT OR IGNORE INTO signatures(signature) VALUES (?)', (signature,))
            conn.commit()
            inserted = cur.rowcount == 1
            if inserted:
                self._trim(conn)
            return inserted

    def _trim(self, conn: sqlite3.Connection) -> None:
        cur = conn.execute('SELECT COUNT(*) FROM signatures')
        count = int(cur.fetchone()[0] or 0)
        if count <= self.maxlen:
            return
        overflow = count - self.maxlen
        conn.execute(
            'DELETE FROM signatures WHERE signature IN ('
            'SELECT signature FROM signatures ORDER BY created_at ASC LIMIT ?'
            ')',
            (overflow,),
        )
        conn.commit()


class QuestionGenerationService:
    def __init__(self, settings: GenerationSettings, logger: Optional[logging.Logger] = None) -> None:
        self.settings = settings
        self.logger = logger or LOGGER
        self.client = OpenAI()
        self.recent_questions = RecentQuestionStore(
            self.settings.generated_dir / 'recent_question_signatures.sqlite',
            maxlen=self.settings.recent_signature_limit,
        )
        self.diagram_service = DiagramGenerationService(
            DiagramSettings(output_dir=self.settings.diagram_dir, model=self.settings.openai_model_image),
            logger=self.logger,
        )
        self.settings.generated_dir.mkdir(parents=True, exist_ok=True)
        self.settings.diagram_dir.mkdir(parents=True, exist_ok=True)

    def _get_questions(self) -> List[Dict[str, Any]]:
        if self.settings.cache_examples and self.settings._cached_questions is not None:
            return self.settings._cached_questions
        questions = load_questions(self.settings.processed_dir)
        if self.settings.cache_examples:
            self.settings._cached_questions = questions
        return questions

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

    def _call_structured(self, *, model: str, instructions: str, payload: Dict[str, Any], schema: Dict[str, Any], max_output_tokens: int) -> Dict[str, Any]:
        response = self.client.responses.create(
            model=model,
            input=[
                {
                    'role': 'developer',
                    'content': instructions,
                },
                {
                    'role': 'user',
                    'content': json.dumps(payload, ensure_ascii=False, indent=2),
                },
            ],
            text={
                'format': {
                    'type': 'json_schema',
                    'name': schema['name'],
                    'schema': schema['schema'],
                    'strict': True,
                }
            },
            temperature=self.settings.temperature,
            max_output_tokens=max_output_tokens,
        )
        raw = self._response_text(response)
        return json.loads(raw)

    def _base_question_schema(self) -> Dict[str, Any]:
        return {
            'name': 'question_draft',
            'schema': {
                'type': 'object',
                'additionalProperties': False,
                'required': [
                    'question_id',
                    'source',
                    'content',
                    'prompt',
                    'generation',
                    'validation',
                    'metadata',
                    'data_quality_notes',
                ],
                'properties': {
                    'question_id': {'type': 'string'},
                    'source': {
                        'type': 'object',
                        'additionalProperties': False,
                        'required': ['exam', 'year', 'paper', 'section', 'question_number', 'source_pdf'],
                        'properties': {
                            'exam': {'type': ['string', 'null']},
                            'year': {'type': ['integer', 'null']},
                            'paper': {'type': ['string', 'null']},
                            'section': {'type': ['string', 'null']},
                            'question_number': {'type': ['integer', 'null']},
                            'source_pdf': {'type': ['string', 'null']},
                        },
                    },
                    'content': {
                        'type': 'object',
                        'additionalProperties': False,
                        'required': ['subject', 'topic', 'subtopic', 'archetype', 'difficulty', 'requires_diagram', 'requires_calculation'],
                        'properties': {
                            'subject': {'type': 'string'},
                            'topic': {'type': ['string', 'null']},
                            'subtopic': {'type': ['string', 'null']},
                            'archetype': {'type': ['string', 'null']},
                            'difficulty': {'type': 'integer'},
                            'requires_diagram': {'type': 'boolean'},
                            'requires_calculation': {'type': 'boolean'},
                        },
                    },
                    'prompt': {
                        'type': 'object',
                        'additionalProperties': False,
                        'required': ['stem', 'options', 'figures'],
                        'properties': {
                            'stem': {'type': 'string'},
                            'options': {
                                'type': 'array',
                                'minItems': 5,
                                'maxItems': 5,
                                'items': {
                                    'type': 'object',
                                    'additionalProperties': False,
                                    'required': ['label', 'text'],
                                    'properties': {
                                        'label': {'type': 'string', 'enum': OPTION_LABELS},
                                        'text': {'type': 'string'},
                                    },
                                },
                            },
                            'figures': {
                                'type': 'array',
                                'items': {
                                    'type': 'object',
                                    'additionalProperties': False,
                                    'required': ['kind', 'caption', 'prompt'],
                                    'properties': {
                                        'kind': {'type': 'string'},
                                        'caption': {'type': 'string'},
                                        'prompt': {'type': ['string', 'null']},
                                    },
                                },
                            },
                        },
                    },
                    'generation': {
                        'type': 'object',
                        'additionalProperties': False,
                        'required': ['template_id', 'template_version', 'parameters', 'solution_steps', 'distractor_strategy'],
                        'properties': {
                            'template_id': {'type': ['string', 'null']},
                            'template_version': {'type': ['string', 'null']},
                            'parameters': {
                                'type': 'object',
                                'additionalProperties': False,
                                'required': [],
                                'properties': {},
                            },
                            'solution_steps': {'type': 'array', 'items': {'type': 'string'}},
                            'distractor_strategy': {'type': 'array', 'items': {'type': 'string'}},
                        },
                    },
                    'validation': {
                        'type': 'object',
                        'additionalProperties': False,
                        'required': ['answer_label', 'answer_text', 'status'],
                        'properties': {
                            'answer_label': {'type': ['string', 'null'], 'enum': OPTION_LABELS + [None]},
                            'answer_text': {'type': ['string', 'null']},
                            'status': {'type': 'string', 'enum': ['unverified', 'verified', 'needs_revision']},
                        },
                    },
                    'metadata': {
                        'type': 'object',
                        'additionalProperties': False,
                        'required': ['estimated_time_seconds', 'tags', 'diagram_required', 'diagram_url'],
                        'properties': {
                            'estimated_time_seconds': {'type': ['number', 'null']},
                            'tags': {'type': 'array', 'items': {'type': 'string'}},
                            'diagram_required': {'type': 'boolean'},
                            'diagram_url': {'type': ['string', 'null']},
                        },
                    },
                    'data_quality_notes': {'type': 'array', 'items': {'type': 'string'}},
                },
            },
        }

    def _review_schema(self) -> Dict[str, Any]:
        return {
            'name': 'question_review',
            'schema': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['answer_label', 'answer_text', 'status', 'solution_steps', 'notes'],
                'properties': {
                    'answer_label': {'type': ['string', 'null'], 'enum': OPTION_LABELS + [None]},
                    'answer_text': {'type': ['string', 'null']},
                    'status': {'type': 'string', 'enum': ['verified', 'needs_revision']},
                    'solution_steps': {'type': 'array', 'items': {'type': 'string'}},
                    'notes': {'type': 'array', 'items': {'type': 'string'}},
                },
            },
        }

    def _draft_instructions(self, want_solution: bool, want_diagram: bool, force_diagram: bool = False, similar_to_context: Optional[str] = None) -> str:
        extra = self.settings.extra_instructions or ''
        base = (
            'You are generating a fresh NSAA-style multiple-choice question. '
            'Use the provided examples only for style and structure, not as source material to paraphrase. '
            'Return only data that matches the JSON schema. '
            'Keep the question realistic, concise, and solvable. '
            'Always provide exactly five options labeled A-E. '
            'IMPORTANT: After writing the question and options, solve it step by step to confirm which answer is correct. '
            'Set validation.answer_label to the letter of the correct option, '
            'validation.answer_text to the text of that option, '
            'and validation.status to "verified" once you have confirmed the answer. '
            'Record your solution steps in generation.solution_steps. '
            'Only set validation.status to "needs_revision" if the question is structurally broken '
            '(no correct answer exists among the options, or two options are equally correct). '
            f'Need diagram: {str(want_diagram).lower()}. '
        )
        if force_diagram:
            base += (
                'MANDATORY: This question MUST require a diagram to solve. '
                'Do NOT produce a text-only question. '
                'Set content.requires_diagram=true. '
                'Include at least one figure spec in prompt.figures with a detailed description of what to draw. '
                'The question stem must explicitly reference the figure (e.g. "In the diagram below…"). '
            )
        if similar_to_context:
            base += '\n\n' + similar_to_context
        return base + (extra if extra else '')

    def _review_instructions(self) -> str:
        return (
            'You are independently verifying a drafted NSAA-style multiple-choice question. '
            'Solve the question from scratch. '
            'Return the correct answer label and its option text, plus concise solution steps. '
            'Set status to "verified" if exactly one option is unambiguously correct — this should be the common case. '
            'Set status to "needs_revision" ONLY if: '
            '(1) none of the five options is mathematically/logically correct, or '
            '(2) two or more options are equally correct, or '
            '(3) the question stem is so garbled it cannot be parsed. '
            'Minor imprecision, awkward wording, or a question you personally find too easy/hard are NOT grounds for needs_revision. '
            'Return only data that matches the JSON schema.'
        )

    def _normalize_question(self, question: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(question, dict):
            raise ValueError('Generated output was not a JSON object.')

        question.setdefault('question_id', str(uuid.uuid4()))

        for key in ('source', 'content', 'prompt', 'generation', 'validation', 'metadata'):
            if not isinstance(question.get(key), dict):
                question[key] = {}

        if not isinstance(question.get('data_quality_notes'), list):
            question['data_quality_notes'] = []

        prompt = question['prompt']
        options = prompt.get('options', [])
        if not isinstance(options, list):
            options = []

        fixed_options: List[Dict[str, str]] = []
        for i, label in enumerate(OPTION_LABELS):
            text = ''
            if i < len(options):
                opt = options[i]
                if isinstance(opt, dict):
                    text = str(opt.get('text', ''))
                else:
                    text = str(opt)
            fixed_options.append({'label': label, 'text': text})
        prompt['options'] = fixed_options

        if not isinstance(prompt.get('figures'), list):
            prompt['figures'] = []
        else:
            cleaned_figures: List[Dict[str, Any]] = []
            for fig in prompt['figures']:
                if isinstance(fig, dict):
                    cleaned_figures.append(
                        {
                            'kind': str(fig.get('kind', 'diagram_spec')),
                            'caption': str(fig.get('caption', '')),
                            'prompt': fig.get('prompt', None) if fig.get('prompt', None) is None else str(fig.get('prompt')),
                        }
                    )
            prompt['figures'] = cleaned_figures

        validation = question['validation']
        if validation.get('status') not in {'verified', 'needs_revision', 'unverified'}:
            validation['status'] = 'unverified'
        if validation.get('answer_label') not in OPTION_LABELS + [None]:
            validation['answer_label'] = None
        if validation.get('answer_text') is not None and not isinstance(validation.get('answer_text'), str):
            validation['answer_text'] = None

        metadata = question['metadata']
        if not isinstance(metadata.get('tags'), list):
            metadata['tags'] = []
        if not isinstance(metadata.get('diagram_required'), bool):
            metadata['diagram_required'] = bool(question.get('content', {}).get('requires_diagram', False))
        if not isinstance(metadata.get('diagram_url'), (str, type(None))):
            metadata['diagram_url'] = None

        return question

    def _add_hint_fields(self, draft: Dict[str, Any], subject: str, topic: Optional[str], difficulty: int) -> None:
        source = draft.setdefault('source', {})
        content = draft.setdefault('content', {})
        metadata = draft.setdefault('metadata', {})

        source.setdefault('exam', 'NSAA')
        source.setdefault('year', None)
        source.setdefault('paper', None)
        source.setdefault('section', None)
        source.setdefault('question_number', None)
        source.setdefault('source_pdf', None)

        content.setdefault('subject', subject)
        content.setdefault('topic', topic)
        content.setdefault('subtopic', None)
        content.setdefault('archetype', None)
        content.setdefault('difficulty', difficulty)
        content.setdefault('requires_diagram', False)
        content.setdefault('requires_calculation', True)

        metadata.setdefault('estimated_time_seconds', None)
        metadata.setdefault('tags', [subject])
        metadata.setdefault('diagram_required', bool(content.get('requires_diagram', False)))
        metadata.setdefault('diagram_url', None)

        draft.setdefault('generation', {})
        draft['generation'].setdefault('template_id', None)
        draft['generation'].setdefault('template_version', None)
        draft['generation'].setdefault('parameters', {})
        draft['generation'].setdefault('solution_steps', [])
        draft['generation'].setdefault('distractor_strategy', [])

        draft.setdefault('validation', {})
        draft['validation'].setdefault('answer_label', None)
        draft['validation'].setdefault('answer_text', None)
        draft['validation'].setdefault('status', 'unverified')

        draft.setdefault('data_quality_notes', [])
        draft.setdefault('prompt', {})
        draft['prompt'].setdefault('figures', [])

    def _maybe_generate_diagram(self, draft: Dict[str, Any], want_diagram: bool, force_diagram: bool = False) -> None:
        if not self.settings.enable_image_generation:
            return
        if not self.diagram_service.should_generate(draft, want_diagram=want_diagram or force_diagram):
            return

        diagram_path = self.diagram_service.generate(draft, want_diagram=want_diagram or force_diagram)
        if diagram_path is None:
            draft.setdefault('data_quality_notes', []).append('Diagram generation failed or was skipped.')
            draft.setdefault('metadata', {})['diagram_url'] = None
            return

        draft.setdefault('metadata', {})['diagram_url'] = f'/diagrams/{diagram_path.name}'

    def _generate_draft(self, subject: str, topic: Optional[str], difficulty: int, examples: int, want_solution: bool, want_diagram: bool, force_diagram: bool, archetype: Optional[str] = None, similar_to_context: Optional[str] = None) -> Dict[str, Any]:
        all_questions = self._get_questions()
        chosen = choose_examples(
            all_questions,
            subject,
            topic,
            difficulty,
            examples,
            archetype=archetype,
            want_diagram=want_diagram or force_diagram,
        )
        request_nonce = uuid.uuid4().hex

        payload = {
            "request_nonce": request_nonce,
            "task": "draft_question",
            "subject": subject,
            "topic": topic,
            "difficulty": difficulty,
            "want_solution": want_solution,
            "want_diagram": want_diagram,
            "force_diagram": force_diagram,
            "style_examples": [compact_example(q) for q in chosen],
            "output_rules": {
                "exactly_five_options": True,
                "labels": OPTION_LABELS,
                "stem_contains_no_answer_choices": True,
                "diagram_if_needed": True,
                "solve_and_verify_answer": True,
                "must_require_diagram": force_diagram,
            },
        }

        draft = self._call_structured(
            model=self.settings.openai_model_draft,
            instructions=self._draft_instructions(want_solution=want_solution, want_diagram=want_diagram, force_diagram=force_diagram, similar_to_context=similar_to_context),
            payload=payload,
            schema=self._base_question_schema(),
            max_output_tokens=self.settings.max_output_tokens,
        )

        self._add_hint_fields(draft, subject, topic, difficulty)
        draft = self._normalize_question(draft)

        if force_diagram:
            if not draft['content'].get('requires_diagram', False):
                raise ValueError('Draft did not set requires_diagram=true despite force_diagram.')
            if not draft['prompt'].get('figures'):
                raise ValueError('Draft did not include any figure specs despite force_diagram.')

        return draft

    def _review_question(self, draft: Dict[str, Any]) -> Dict[str, Any]:
        review_payload = {
            'task': 'review_question',
            'draft_question': draft,
        }
        review = self._call_structured(
            model=self.settings.openai_model_verify,
            instructions=self._review_instructions(),
            payload=review_payload,
            schema=self._review_schema(),
            max_output_tokens=self.settings.verify_max_output_tokens,
        )
        return review

    def generate_question(
        self,
        subject: str,
        topic: Optional[str],
        difficulty: int,
        examples: int,
        want_solution: bool = True,
        want_diagram: bool = False,
        force_diagram: bool = False,
        archetype: Optional[str] = None,
        similar_to_context: Optional[str] = None,
    ) -> Dict[str, Any]:
        max_rounds = 3
        last_error: Optional[Exception] = None

        for round_idx in range(1, max_rounds + 1):
            try:
                draft = self._generate_draft(
                    subject=subject,
                    topic=topic,
                    difficulty=difficulty,
                    examples=examples,
                    want_solution=want_solution,
                    want_diagram=want_diagram,
                    force_diagram=force_diagram,
                    archetype=archetype,
                    similar_to_context=similar_to_context,
                )

                draft = self._normalize_question(draft)

                # Happy path: draft already self-verified — skip the review call entirely
                draft_status = draft['validation'].get('status')
                draft_label = draft['validation'].get('answer_label')
                already_verified = (
                    draft_status == 'verified' and draft_label in OPTION_LABELS
                )

                if already_verified:
                    self.logger.info('Draft self-verified (round %d); skipping review call', round_idx)
                    review: Dict[str, Any] = {'notes': []}
                elif want_solution:
                    self.logger.info('Draft not self-verified (status=%s); running review (round %d)', draft_status, round_idx)
                    review = self._review_question(draft)
                    draft['validation']['answer_label'] = review.get('answer_label')
                    draft['validation']['answer_text'] = review.get('answer_text')
                    draft['validation']['status'] = review.get('status', 'unverified')
                    draft['generation']['solution_steps'] = review.get('solution_steps', [])
                    draft = self._normalize_question(draft)
                else:
                    review = {'notes': []}

                for note in review.get('notes', []):
                    if note not in draft['data_quality_notes']:
                        draft['data_quality_notes'].append(note)

                sig = question_signature(draft)
                if self.recent_questions.contains(sig):
                    self.logger.info('Rejected duplicate draft signature=%s', sig[:12])
                    if round_idx < max_rounds:
                        continue
                    raise ValueError('Duplicate question draft')

                final_status = draft['validation'].get('status')
                final_label = draft['validation'].get('answer_label')
                if final_status == 'needs_revision' and round_idx < max_rounds:
                    self.logger.info('Revision requested; retrying round %d/%d', round_idx, max_rounds)
                    continue

                if not self.recent_questions.add(sig):
                    self.logger.info('Signature already stored by another concurrent request: %s', sig[:12])
                    if final_status == 'verified' and final_label in OPTION_LABELS and round_idx < max_rounds:
                        continue

                self._maybe_generate_diagram(draft, want_diagram=want_diagram, force_diagram=force_diagram)
                draft = self._normalize_question(draft)
                return draft
            except Exception as exc:
                last_error = exc
                self.logger.warning('Generation round %d/%d failed: %s', round_idx, max_rounds, exc)

        raise RuntimeError(f'Failed to generate question: {last_error}')
