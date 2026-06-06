from __future__ import annotations

import hashlib
import json
import logging
import os
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from openai import OpenAI

from src.services.answer_match import match_value_to_options
from src.services.code_sandbox import execute_verification_code
from src.services.example_index import QuestionExampleIndex, corpus_fingerprint
from src.services.generate_diagram import DiagramGenerationService, DiagramSettings
from src.services.generation_session import GenerationSession
from src.figures.figure_router import process_figures

LOGGER = logging.getLogger('oxai.generate_question')
OPTION_LABELS = ['A', 'B', 'C', 'D', 'E']


class VerificationError(ValueError):
    """A calculation question failed code-execution verification."""


def _is_uuid4(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        return str(uuid.UUID(value, version=4)) == value.lower()
    except (ValueError, AttributeError):
        return False


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
            score += 4
        elif not want_diagram and has_diagram:
            score -= 2
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
    openai_model_draft: str = os.getenv('OPENAI_MODEL_DRAFT', 'gpt-5.5')
    openai_model_image: str = os.getenv('OPENAI_IMAGE_MODEL', 'gpt-image-2')
    temperature: float = 0.7
    max_output_tokens: int = 3000
    repair_max_output_tokens: int = 1200
    examples: int = 3
    # Code-execution verification of calculation questions
    enable_code_verification: bool = os.getenv('ENABLE_CODE_VERIFICATION', '0').lower() not in ('0', 'false')
    code_exec_timeout_s: float = float(os.getenv('CODE_EXEC_TIMEOUT_S', '5'))
    code_exec_max_mem_mb: int = int(os.getenv('CODE_EXEC_MAX_MEM_MB', '512'))
    code_exec_max_code_len: int = int(os.getenv('CODE_EXEC_MAX_CODE_LEN', '4000'))
    code_exec_concurrency: int = int(os.getenv('CODE_EXEC_CONCURRENCY', '4'))
    match_rel_tol: float = float(os.getenv('MATCH_REL_TOL', '1e-3'))
    enable_llm_match_fallback: bool = os.getenv('ENABLE_LLM_MATCH_FALLBACK', '1').lower() not in ('0', 'false')
    recent_signature_limit: int = 1000
    cache_examples: bool = True
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
    """Generates fresh questions from the bank plus GPT."""

    _TOPIC_LIST: Dict[str, str] = {
        'math': (
            'algebra, functions and graphs, coordinate geometry, geometry, trigonometry, '
            'exponentials and logarithms, sequences and series, vectors, probability, statistics'
        ),
        'physics': (
            'mechanics, electricity, waves, thermal physics, radioactivity, electromagnetism, atomic physics'
        ),
        'chemistry': (
            'atomic structure, bonding, stoichiometry, energetics, kinetics, equilibrium, acids and bases, '
            'organic chemistry, electrochemistry'
        ),
        'biology': (
            'cell biology, biochemistry, genetics, physiology, ecology'
        ),
    }

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
        self._example_index: Optional[QuestionExampleIndex] = None
        self._index_fingerprint: Optional[str] = None
        # Bounds concurrent verification subprocesses (each can hold up to
        # code_exec_max_mem_mb of address space).
        self._exec_semaphore = threading.BoundedSemaphore(max(1, self.settings.code_exec_concurrency))

    # ------------------------------------------------------------------
    # Corpus helpers
    # ------------------------------------------------------------------

    def _get_questions(self) -> List[Dict[str, Any]]:
        if self.settings.cache_examples and self.settings._cached_questions is not None:
            return self.settings._cached_questions
        questions = load_questions(self.settings.processed_dir)
        if self.settings.cache_examples:
            self.settings._cached_questions = questions
        return questions

    def _get_example_index(self) -> QuestionExampleIndex:
        questions = self._get_questions()
        fp = corpus_fingerprint(questions)
        if self._example_index is None or self._index_fingerprint != fp:
            self.logger.info('Building QuestionExampleIndex (corpus fingerprint %s)', fp)
            self._example_index = QuestionExampleIndex(questions)
            self._index_fingerprint = fp
            self.logger.info('Index ready: %s', self._example_index.stats())
        return self._example_index

    # ------------------------------------------------------------------
    # OpenAI call wrapper
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
        model: str,
        instructions: str,
        payload: Dict[str, Any],
        schema: Dict[str, Any],
        max_output_tokens: int,
    ) -> Dict[str, Any]:
        """Call the OpenAI Responses API and return the parsed result.

        Each call is stateless — no previous_response_id.  The system prompt
        (instructions) is identical across calls for the same subject so
        OpenAI's automatic prompt caching applies to the prefix, keeping cost
        flat rather than growing with each question in a session.
        """
        self.logger.info(
            '[openai] responses.create  model=%s  schema=%s  max_tokens=%d',
            model, schema['name'], max_output_tokens,
        )
        t0 = time.perf_counter()
        response = self.client.responses.create(
            model=model,
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
        usage = getattr(response, 'usage', None)
        self.logger.info(
            '[openai] responses.create done  schema=%s  elapsed=%.2fs  tokens=in:%s/out:%s/max:%d',
            schema['name'],
            time.perf_counter() - t0,
            getattr(usage, 'input_tokens', '?'),
            getattr(usage, 'output_tokens', '?'),
            max_output_tokens,
        )
        return json.loads(self._response_text(response))

    # ------------------------------------------------------------------
    # Schemas
    # ------------------------------------------------------------------

    def _base_question_schema(self) -> Dict[str, Any]:
        schema = {
            'name': 'question_draft',
            'schema': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['content', 'prompt', 'validation'],
                'properties': {
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
                                    'required': [
                                        'figure_type', 'caption', 'diagram_prompt',
                                        'table_headers', 'table_rows', 'table_row_labels',
                                        'graph_type', 'graph_title',
                                        'graph_x_label', 'graph_y_label', 'graph_x_labels',
                                        'graph_series',
                                        'graph_x_min', 'graph_x_max',
                                        'graph_y_min', 'graph_y_max',
                                    ],
                                    'properties': {
                                        'figure_type': {'type': 'string', 'enum': ['table', 'simple_graph', 'complex_diagram']},
                                        'caption': {'type': 'string'},
                                        'diagram_prompt': {'type': ['string', 'null']},
                                        'table_headers': {'type': ['array', 'null'], 'items': {'type': 'string'}},
                                        'table_rows': {
                                            'type': ['array', 'null'],
                                            'items': {'type': 'array', 'items': {'type': 'string'}},
                                        },
                                        'table_row_labels': {'type': ['array', 'null'], 'items': {'type': 'string'}},
                                        'graph_type': {'type': ['string', 'null'], 'enum': ['line', 'bar', 'scatter', None]},
                                        'graph_title': {'type': ['string', 'null']},
                                        'graph_x_label': {'type': ['string', 'null']},
                                        'graph_y_label': {'type': ['string', 'null']},
                                        'graph_x_labels': {'type': ['array', 'null'], 'items': {'type': 'string'}},
                                        'graph_series': {
                                            'type': ['array', 'null'],
                                            'items': {
                                                'type': 'object',
                                                'additionalProperties': False,
                                                'required': ['name', 'x_values', 'y_values'],
                                                'properties': {
                                                    'name': {'type': 'string'},
                                                    'x_values': {'type': 'array', 'items': {'type': 'number'}},
                                                    'y_values': {'type': 'array', 'items': {'type': 'number'}},
                                                },
                                            },
                                        },
                                        'graph_x_min': {'type': ['number', 'null']},
                                        'graph_x_max': {'type': ['number', 'null']},
                                        'graph_y_min': {'type': ['number', 'null']},
                                        'graph_y_max': {'type': ['number', 'null']},
                                    },
                                },
                            },
                        },
                    },
                    'validation': {
                        'type': 'object',
                        'additionalProperties': False,
                        'required': ['answer_label', 'answer_text'],
                        'properties': {
                            'answer_label': {'type': ['string', 'null'], 'enum': OPTION_LABELS + [None]},
                            'answer_text': {'type': ['string', 'null']},
                        },
                    },
                },
            },
        }
        if self.settings.enable_code_verification:
            schema['schema']['required'] = ['content', 'prompt', 'generation', 'validation']
            schema['schema']['properties']['generation'] = {
                'type': 'object',
                'additionalProperties': False,
                'required': ['solution_code'],
                'properties': {
                    'solution_code': {'type': ['string', 'null']},
                },
            }
        return schema

    def _repair_schema(self) -> Dict[str, Any]:
        schema = self._base_question_schema()
        schema['name'] = 'question_repair'
        return schema

    # ------------------------------------------------------------------
    # Prompt builders
    # ------------------------------------------------------------------

    def _draft_instructions(
        self,
        *,
        subject: str,
        want_diagram: bool,
        force_diagram: bool = False,
        prior_coverage_summary: str = '',
        avoid_topics: Optional[List[str]] = None,
        similar_to_context: Optional[str] = None,
    ) -> str:
        topic_list = self._TOPIC_LIST.get(subject.lower().strip(), 'the relevant syllabus topics')
        extra = self.settings.extra_instructions or ''
        base = (
            'You are generating a brand new NSAA/ESAT-style multiple-choice question. '
            'Use the provided examples only for style, tone, and level — do not copy their wording or structure. '
            'Return only JSON that matches the schema. '
            'Make the question concise, on-topic, and realistically exam-like. '
            'Provide exactly five options labeled A-E. '
            'Solve the question internally before writing it so the correct option is genuinely right. '
            f'Rotate broadly across the subject syllabus: {topic_list}. '
            'Avoid defaulting to the same topic or question shape repeatedly. '
            'For Mathematics, do not use calculus, integration, or differentiation unless the topic explicitly calls for it. '
        )
        if self.settings.enable_code_verification:
            base += (
                'If content.requires_calculation is true, you MUST provide generation.solution_code: '
                'a self-contained Python 3 snippet that computes the answer purely from the data given in the stem. '
                'The code must NOT reference the answer options, the letters A-E, or your chosen answer in any way. '
                'Allowed imports ONLY: math, sympy, fractions, decimal, statistics, itertools, cmath, numbers. '
                'No file, network, OS access, eval/exec, or dunder attributes. '
                'End the code by assigning the computed answer to a variable named RESULT. '
                'For numeric answers assign a plain number without units, expressed in the same unit the options use. '
                'For exact symbolic answers (surds, fractions, pi) assign a sympy expression. '
                'The value of RESULT must equal the option you mark in validation.answer_label. '
                'If content.requires_calculation is false, set generation.solution_code to null. '
            )
        base += (
            'All mathematical expressions, variables, and numbers used in equations must be typeset in LaTeX. '
            'Use $...$ for inline math. '
            'For example: "$x^2 + y^2$" not "x^2 + y^2"; "$2H_2O$" for chemical formulas; '
            '"$\\\\mathrm{CuO + H_2 \\\\rightarrow Cu + H_2O}$" for chemical equations. '
            'Use $^\\\\circ$ for degrees; $\\\\times 10^{n}$ for scientific notation. '
            'Plain prose numbers (e.g. "five options") do NOT need LaTeX. '
        )
        if prior_coverage_summary:
            base += f'\n{prior_coverage_summary}. '
        if avoid_topics:
            base += f'Avoid these recently overused topics: {", ".join(avoid_topics)}. '
        if force_diagram:
            base += (
                'This question must require a figure. '
                'Set content.requires_diagram=true and include at least one entry in prompt.figures. '
                'The stem must refer to the figure. '
                'Choose figure_type: "table" for data tables; "simple_graph" for charts/plots with numeric series; '
                '"complex_diagram" for geometric figures, circuit diagrams, or freeform images. '
                'Populate only the fields relevant to the chosen type; set unrelated fields to null. '
            )
        elif not want_diagram:
            base += 'Do not include a required diagram. Set content.requires_diagram=false and prompt.figures=[]. '
        else:
            base += (
                'You may include a figure if it genuinely helps. '
                'Use "table" for data tables, "simple_graph" for charts/plots, "complex_diagram" for geometric images. '
            )
        if similar_to_context:
            base += '\n\n' + similar_to_context
        return base + extra

    def _repair_instructions(self) -> str:
        return (
            'You are repairing a drafted multiple-choice question. '
            'Preserve the same subject, topic, difficulty, and general idea. '
            'Fix only the listed issues. '
            'Return a fully valid JSON object matching the schema. '
            'Keep exactly five labeled options A-E. '
            'If the answer label is wrong or missing, correct it. '
            'Do not invent a different question unless the original is irreparable.'
        )

    # ------------------------------------------------------------------
    # Normalisation and validation
    # ------------------------------------------------------------------

    def _normalize_question(self, question: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(question, dict):
            raise ValueError('Generated output was not a JSON object.')

        existing_id = question.get('question_id')
        if not _is_uuid4(existing_id):
            question['question_id'] = str(uuid.uuid4())
            if isinstance(existing_id, str) and existing_id.strip():
                metadata = question.get('metadata')
                if isinstance(metadata, dict) and isinstance(metadata.get('tags'), list):
                    metadata['tags'].append(f'model_question_id:{existing_id}')

        for key in ('source', 'content', 'prompt', 'generation', 'validation', 'metadata'):
            if not isinstance(question.get(key), dict):
                question[key] = {}

        prompt = question['prompt']
        options = prompt.get('options', []) if isinstance(prompt.get('options', []), list) else []
        fixed_options: List[Dict[str, str]] = []
        for i, label in enumerate(OPTION_LABELS):
            text = ''
            if i < len(options):
                opt = options[i]
                text = str(opt.get('text', '')) if isinstance(opt, dict) else str(opt)
            fixed_options.append({'label': label, 'text': text})
        prompt['options'] = fixed_options

        figures = prompt.get('figures', [])
        cleaned_figures: List[Dict[str, Any]] = []
        if isinstance(figures, list):
            for fig in figures:
                if not isinstance(fig, dict):
                    continue
                ft = str(fig.get('figure_type') or 'complex_diagram')
                if ft not in ('table', 'simple_graph', 'complex_diagram'):
                    ft = 'complex_diagram'
                cleaned: Dict[str, Any] = {
                    'figure_type': ft,
                    'caption': str(fig.get('caption') or ''),
                    'diagram_prompt': str(fig['diagram_prompt']) if fig.get('diagram_prompt') is not None else None,
                    'table_headers': list(fig['table_headers']) if isinstance(fig.get('table_headers'), list) else None,
                    'table_rows': [list(r) for r in fig['table_rows']] if isinstance(fig.get('table_rows'), list) else None,
                    'table_row_labels': list(fig['table_row_labels']) if isinstance(fig.get('table_row_labels'), list) else None,
                    'graph_type': str(fig['graph_type']) if fig.get('graph_type') in ('line', 'bar', 'scatter') else None,
                    'graph_title': str(fig['graph_title']) if fig.get('graph_title') is not None else None,
                    'graph_x_label': str(fig['graph_x_label']) if fig.get('graph_x_label') is not None else None,
                    'graph_y_label': str(fig['graph_y_label']) if fig.get('graph_y_label') is not None else None,
                    'graph_x_labels': list(fig['graph_x_labels']) if isinstance(fig.get('graph_x_labels'), list) else None,
                    'graph_series': [
                        {
                            'name': str(s.get('name', '')),
                            'x_values': [float(v) for v in (s.get('x_values') or [])],
                            'y_values': [float(v) for v in (s.get('y_values') or [])],
                        }
                        for s in fig['graph_series'] if isinstance(s, dict)
                    ] if isinstance(fig.get('graph_series'), list) else None,
                    'graph_x_min': float(fig['graph_x_min']) if isinstance(fig.get('graph_x_min'), (int, float)) else None,
                    'graph_x_max': float(fig['graph_x_max']) if isinstance(fig.get('graph_x_max'), (int, float)) else None,
                    'graph_y_min': float(fig['graph_y_min']) if isinstance(fig.get('graph_y_min'), (int, float)) else None,
                    'graph_y_max': float(fig['graph_y_max']) if isinstance(fig.get('graph_y_max'), (int, float)) else None,
                    'url': fig.get('url', None),
                }
                cleaned_figures.append(cleaned)
        prompt['figures'] = cleaned_figures

        validation = question['validation']
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

        if self.settings.enable_code_verification:
            generation = question['generation']
            if not isinstance(generation.get('solution_code'), (str, type(None))):
                generation['solution_code'] = None
            generation.setdefault('solution_code', None)

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

        generation = draft.setdefault('generation', {})
        generation.setdefault('template_id', None)
        generation.setdefault('template_version', None)
        generation.setdefault('solution_steps', [])
        generation.setdefault('distractor_strategy', [])
        generation.setdefault('solution_code', None)

        validation = draft.setdefault('validation', {})
        validation.setdefault('answer_label', None)
        validation.setdefault('answer_text', None)
        validation.setdefault('status', 'unverified')

        draft.setdefault('data_quality_notes', [])
        draft.setdefault('prompt', {})
        draft['prompt'].setdefault('figures', [])

    def _validate_question(self, question: Dict[str, Any]) -> List[str]:
        issues: List[str] = []
        content = question.get('content', {}) if isinstance(question.get('content', {}), dict) else {}
        prompt = question.get('prompt', {}) if isinstance(question.get('prompt', {}), dict) else {}
        validation = question.get('validation', {}) if isinstance(question.get('validation', {}), dict) else {}

        for key in ('subject', 'topic', 'difficulty', 'requires_diagram', 'requires_calculation'):
            if key not in content:
                issues.append(f'missing content.{key}')
        stem = prompt.get('stem')
        if not isinstance(stem, str) or not stem.strip():
            issues.append('empty prompt.stem')

        options = prompt.get('options', [])
        if not isinstance(options, list) or len(options) != 5:
            issues.append('prompt.options must contain exactly five items')
            options = []

        labels, texts = [], []
        for idx, opt in enumerate(options):
            if not isinstance(opt, dict):
                issues.append(f'option {idx} is not an object')
                continue
            label = opt.get('label')
            text = opt.get('text')
            labels.append(label)
            texts.append(str(text) if text is not None else '')
            if label != OPTION_LABELS[idx]:
                issues.append(f'option {idx} label should be {OPTION_LABELS[idx]}')
            if not isinstance(text, str) or not text.strip():
                issues.append(f'option {label or idx} has empty text')

        if len(set(texts)) != len(texts):
            issues.append('duplicate option texts')

        ans_label = validation.get('answer_label')
        ans_text = validation.get('answer_text')
        if ans_label not in OPTION_LABELS:
            issues.append('validation.answer_label missing or invalid')
        else:
            idx = OPTION_LABELS.index(ans_label)
            if idx >= len(options):
                issues.append('validation.answer_label points outside options')
            else:
                expected = str(options[idx].get('text', ''))
                if not isinstance(ans_text, str) or ans_text.strip() != expected.strip():
                    issues.append('validation.answer_text does not match answer_label')

        if content.get('requires_diagram') and not isinstance(prompt.get('figures', []), list):
            issues.append('figures missing for diagram question')

        return issues

    # ------------------------------------------------------------------
    # Generation internals
    # ------------------------------------------------------------------

    def _repair_question(self, draft: Dict[str, Any], issues: List[str]) -> Dict[str, Any]:
        repair_payload = {'task': 'repair_question', 'issues': issues, 'draft_question': draft}
        return self._call_structured(
            model=self.settings.openai_model_draft,
            instructions=self._repair_instructions(),
            payload=repair_payload,
            schema=self._repair_schema(),
            max_output_tokens=self.settings.repair_max_output_tokens,
        )

    def _maybe_generate_diagram(self, draft: Dict[str, Any], want_diagram: bool, force_diagram: bool = False) -> None:
        t0 = time.perf_counter()
        process_figures(
            draft,
            diagram_dir=self.settings.diagram_dir,
            diagram_service=self.diagram_service,
            want_diagram=want_diagram,
            force_diagram=force_diagram,
            logger=self.logger,
        )
        self.logger.debug('process_figures elapsed=%.2fs', time.perf_counter() - t0)

    def _llm_match_fallback(self, computed: str, options: List[Dict[str, str]]) -> Optional[str]:
        """Last-resort option matching for values the tiered matcher can't parse."""
        schema = {
            'name': 'option_match',
            'schema': {
                'type': 'object',
                'additionalProperties': False,
                'required': ['label'],
                'properties': {'label': {'type': 'string', 'enum': OPTION_LABELS + ['NONE']}},
            },
        }
        result = self._call_structured(
            model=self.settings.openai_model_draft,
            instructions=(
                'You compare a computed answer value against five multiple-choice options. '
                'Reply with the letter of the single option that is mathematically equal to the value '
                '(allowing formatting, units, and reasonable rounding differences), or NONE. '
                'If two or more options are equal to the value, reply NONE. Do not guess.'
            ),
            payload={'computed_value': computed, 'options': options},
            schema=schema,
            max_output_tokens=200,
        )
        label = result.get('label')
        return label if label in OPTION_LABELS else None

    def _log_verification_failure(
        self,
        draft: Dict[str, Any],
        reason: str,
        computed_value: Optional[str] = None,
        match_tier: Optional[str] = None,
    ) -> None:
        """Append a rejected draft to verification_failures.jsonl for offline
        analysis (prompt tuning, matcher gaps, deciding whether an independent
        solver is needed). Best-effort: never blocks generation."""
        record = {
            'logged_at': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
            'reason': reason,
            'computed_value': computed_value,
            'match_tier': match_tier,
            'subject': draft.get('content', {}).get('subject'),
            'topic': draft.get('content', {}).get('topic'),
            'difficulty': draft.get('content', {}).get('difficulty'),
            'stem': draft.get('prompt', {}).get('stem'),
            'options': draft.get('prompt', {}).get('options'),
            'claimed_label': draft.get('validation', {}).get('answer_label'),
            'solution_code': draft.get('generation', {}).get('solution_code'),
        }
        try:
            path = self.settings.generated_dir / 'verification_failures.jsonl'
            with path.open('a', encoding='utf-8') as fh:
                fh.write(_safe_json_dumps(record) + '\n')
        except OSError as exc:
            self.logger.warning('Could not write verification failure log: %s', exc)

    def _verify_by_code(self, draft: Dict[str, Any]) -> None:
        """Execute the draft's solution_code and require its result to equal the
        claimed answer option. Raises VerificationError on any failure."""
        generation = draft.get('generation', {})
        validation = draft.get('validation', {})
        options = draft.get('prompt', {}).get('options', [])
        claimed = validation.get('answer_label')

        with self._exec_semaphore:
            result = execute_verification_code(
                generation.get('solution_code'),
                timeout_s=self.settings.code_exec_timeout_s,
                max_mem_mb=self.settings.code_exec_max_mem_mb,
                max_code_len=self.settings.code_exec_max_code_len,
            )
        if not result.ok:
            self._log_verification_failure(draft, f'execution: {result.error}')
            raise VerificationError(f'solution_code execution failed: {result.error}')

        fallback = self._llm_match_fallback if self.settings.enable_llm_match_fallback else None
        match = match_value_to_options(
            result.value,
            options,
            rel_tol=self.settings.match_rel_tol,
            llm_fallback=fallback,
        )

        if match.matched_label is None:
            self.logger.info(
                'Verification mismatch (%s): computed=%r claimed=%s options=%s',
                match.tier, result.value, claimed, [o.get('text') for o in options],
            )
            self._log_verification_failure(draft, f'no_match:{match.tier}', result.value, match.tier)
            raise VerificationError(f'computed value matched no single option ({match.tier})')
        if match.matched_label != claimed:
            self.logger.info(
                'Verification disagreement: computed=%r matches option %s but draft claims %s',
                result.value, match.matched_label, claimed,
            )
            self._log_verification_failure(draft, f'disagreement:matched_{match.matched_label}', result.value, match.tier)
            raise VerificationError(
                f'computed answer is option {match.matched_label}, but draft claims {claimed}'
            )

        validation['status'] = 'verified'
        validation['verified_by'] = 'code_execution'
        generation['verification'] = {
            'method': 'code_execution',
            'computed_value': result.value,
            'matched_label': match.matched_label,
            'match_tier': match.tier,
            'duration_s': round(result.duration_s, 3),
        }
        self.logger.info(
            'Code verification passed: %r == option %s (tier=%s, %.2fs)',
            result.value, match.matched_label, match.tier, result.duration_s,
        )

    def _finalize_question(self, draft: Dict[str, Any], want_diagram: bool, force_diagram: bool) -> Dict[str, Any]:
        draft = self._normalize_question(draft)
        issues = self._validate_question(draft)

        if issues:
            self.logger.info('Draft validation issues: %s', '; '.join(issues))
            repaired = self._repair_question(draft, issues)
            draft = self._normalize_question(repaired)
            issues = self._validate_question(draft)

        if issues:
            raise ValueError('Generated question still failed validation: ' + '; '.join(issues))

        validation = draft.setdefault('validation', {})
        if validation.get('answer_label') not in OPTION_LABELS:
            raise ValueError('Finalized question is missing a valid answer label.')
        idx = OPTION_LABELS.index(validation['answer_label'])
        validation['answer_text'] = draft['prompt']['options'][idx]['text']

        if bool(draft.get('content', {}).get('requires_calculation')) and self.settings.enable_code_verification:
            # Sets status='verified' + verified_by + evidence, or raises
            # VerificationError -> outer retry loop drafts afresh. No repair:
            # a wrong computed answer means the whole question is suspect.
            self._verify_by_code(draft)
        else:
            validation['status'] = 'verified'

        self._maybe_generate_diagram(draft, want_diagram=want_diagram, force_diagram=force_diagram)
        return self._normalize_question(draft)

    def _check_duplicate(self, draft: Dict[str, Any], max_rounds: int, round_idx: int) -> bool:
        """Return True if draft is a duplicate that should trigger a retry."""
        sig = question_signature(draft)
        if self.recent_questions.contains(sig):
            self.logger.info('Rejected duplicate draft signature=%s', sig[:12])
            return round_idx < max_rounds
        if not self.recent_questions.add(sig):
            self.logger.info('Signature race (another concurrent request): %s', sig[:12])
        return False

    # ------------------------------------------------------------------
    # Public: session-based generation (live & batch modes)
    # ------------------------------------------------------------------

    def generate_with_session(
        self,
        session: GenerationSession,
        prior_summary: str,
        subject: str,
        topic: Optional[str],
        difficulty: int,
        want_diagram: bool = False,
        force_diagram: bool = False,
        archetype: Optional[str] = None,
        similar_to_context: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generate one question using session coverage state for diversity.

        Each call is stateless toward the API (no previous_response_id).
        The session's CoverageTracker drives topic/difficulty variety, and the
        identical system-prompt prefix enables OpenAI's automatic prompt caching
        so the fixed portion is billed at a discount on repeated calls.
        """
        index = self._get_example_index()
        effective_topic = topic if topic is not None else index.sample_topic(subject)
        avoid_topics = session.coverage.recent_topics(subject, n=4)

        chosen = index.get_examples(
            subject, effective_topic, difficulty,
            self.settings.examples,
            archetype=archetype,
            want_diagram=want_diagram or force_diagram,
        )

        instructions = self._draft_instructions(
            subject=subject,
            want_diagram=want_diagram,
            force_diagram=force_diagram,
            prior_coverage_summary=prior_summary,
            avoid_topics=avoid_topics,
            similar_to_context=similar_to_context,
        )

        payload: Dict[str, Any] = {
            'request_nonce': uuid.uuid4().hex[:8],
            'task': 'draft_question',
            'subject': subject,
            'topic': effective_topic,
            'difficulty': difficulty,
            'want_diagram': want_diagram,
            'force_diagram': force_diagram,
            'avoid_topics': avoid_topics,
            'style_examples': [compact_example(q) for q in chosen],
            'output_rules': {
                'exactly_five_options': True,
                'labels': OPTION_LABELS,
                'stem_contains_no_answer_choices': True,
                'must_require_diagram': force_diagram,
            },
        }
        if similar_to_context:
            payload['similar_to_context'] = similar_to_context

        max_rounds = 2
        last_error: Optional[Exception] = None

        for round_idx in range(1, max_rounds + 1):
            try:
                draft_raw = self._call_structured(
                    model=self.settings.openai_model_draft,
                    instructions=instructions,
                    payload=payload,
                    schema=self._base_question_schema(),
                    max_output_tokens=self.settings.max_output_tokens,
                )
                self._add_hint_fields(draft_raw, subject, effective_topic, difficulty)
                draft = self._normalize_question(draft_raw)
                draft = self._finalize_question(draft, want_diagram=want_diagram, force_diagram=force_diagram)

                sig = question_signature(draft)
                if self.recent_questions.contains(sig):
                    self.logger.info('Duplicate draft signature=%s (round %d)', sig[:12], round_idx)
                    if round_idx < max_rounds:
                        continue
                    raise ValueError('Duplicate question draft')
                self.recent_questions.add(sig)

                actual_topic = (draft.get('content') or {}).get('topic', effective_topic)
                actual_archetype = (draft.get('content') or {}).get('archetype')
                session.record_call(None, subject, actual_topic, difficulty, actual_archetype)
                return draft

            except Exception as exc:
                last_error = exc
                self.logger.warning('Session generation round %d/%d failed: %s', round_idx, max_rounds, exc)

        raise RuntimeError(f'Failed to generate question: {last_error}')

    def generate_batch(
        self,
        session: GenerationSession,
        prior_summary: str,
        *,
        subject: str,
        n: int,
        topic: Optional[str] = None,
        difficulty: Optional[int] = None,
        want_diagram: bool = False,
    ) -> List[Dict[str, Any]]:
        """Generate n questions sequentially within a session.

        Each question chains from the previous one (the model sees what it just
        wrote), naturally avoiding repetition.  Difficulty auto-distributes
        across the NSAA/ESAT target mix when not specified.
        """
        results: List[Dict[str, Any]] = []
        last_error: Optional[Exception] = None
        current_summary = prior_summary

        for i in range(n):
            q_difficulty = difficulty if difficulty is not None else session.coverage.suggest_difficulty(subject)
            max_attempts = 2
            generated = False

            for attempt in range(max_attempts):
                try:
                    q = self.generate_with_session(
                        session=session,
                        prior_summary=current_summary,
                        subject=subject,
                        topic=topic,
                        difficulty=q_difficulty,
                        want_diagram=want_diagram,
                    )
                    results.append(q)
                    # After the first question the prior_summary is no longer needed
                    # (it was injected into the session's system prompt on call 1)
                    current_summary = ''
                    generated = True
                    self.logger.info(
                        'Batch %s q%d/%d generated: topic=%s difficulty=%d',
                        session.session_id, i + 1, n,
                        q.get('content', {}).get('topic'), q_difficulty,
                    )
                    break
                except Exception as exc:
                    last_error = exc
                    self.logger.warning(
                        'Batch %s q%d/%d attempt %d failed: %s',
                        session.session_id, i + 1, n, attempt + 1, exc,
                    )

            if not generated:
                self.logger.error('Batch %s q%d/%d: all attempts failed, skipping', session.session_id, i + 1, n)

        if not results:
            raise RuntimeError(f'Batch generation produced no questions. Last error: {last_error}')

        return results

    # ------------------------------------------------------------------
    # Public: stateless single-question generation (legacy / fallback)
    # ------------------------------------------------------------------

    def generate_question(
        self,
        subject: str,
        topic: Optional[str],
        difficulty: int,
        examples: int,
        want_diagram: bool = False,
        force_diagram: bool = False,
        archetype: Optional[str] = None,
        similar_to_context: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Stateless single-question generation (no session chaining).

        Kept for backward compatibility and for callers that do not hold a
        session (e.g. generate-similar).  For live and batch use prefer
        generate_with_session / generate_batch.
        """
        index = self._get_example_index()
        effective_topic = topic if topic is not None else index.sample_topic(subject)
        chosen = index.get_examples(
            subject, effective_topic, difficulty, examples,
            archetype=archetype, want_diagram=want_diagram or force_diagram,
        )
        payload = {
            'request_nonce': uuid.uuid4().hex,
            'task': 'draft_question',
            'subject': subject,
            'topic': effective_topic,
            'difficulty': difficulty,
            'want_diagram': want_diagram,
            'force_diagram': force_diagram,
            'style_examples': [compact_example(q) for q in chosen],
            'output_rules': {
                'exactly_five_options': True,
                'labels': OPTION_LABELS,
                'stem_contains_no_answer_choices': True,
                'must_require_diagram': force_diagram,
            },
        }
        if similar_to_context:
            payload['similar_to_context'] = similar_to_context

        instructions = self._draft_instructions(
            subject=subject,
            want_diagram=want_diagram,
            force_diagram=force_diagram,
            similar_to_context=similar_to_context,
        )

        last_error: Optional[Exception] = None
        # 3 rounds: the extra attempt only fires when a draft fails
        # verification — exactly when one more try is worth the cost.
        max_rounds = 3

        for round_idx in range(1, max_rounds + 1):
            try:
                draft_raw, _ = self._call_structured(
                    model=self.settings.openai_model_draft,
                    instructions=instructions,
                    payload=payload,
                    schema=self._base_question_schema(),
                    max_output_tokens=self.settings.max_output_tokens,
                )
                self._add_hint_fields(draft_raw, subject, effective_topic, difficulty)
                draft = self._normalize_question(draft_raw)
                draft = self._finalize_question(draft, want_diagram=want_diagram, force_diagram=force_diagram)

                sig = question_signature(draft)
                if self.recent_questions.contains(sig):
                    self.logger.info('Rejected duplicate draft signature=%s', sig[:12])
                    if round_idx < max_rounds:
                        continue
                    raise ValueError('Duplicate question draft')
                self.recent_questions.add(sig)
                return draft

            except Exception as exc:
                last_error = exc
                self.logger.warning('Generation round %d/%d failed: %s', round_idx, max_rounds, exc)

        raise RuntimeError(f'Failed to generate question: {last_error}')
