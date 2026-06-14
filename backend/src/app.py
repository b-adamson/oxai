from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from src.services.ask_tutor import TutorService, TutorSettings
from src.services.generate_hint import HintGenerationService, HintSettings
from src.services.generate_question import GenerationSettings, QuestionGenerationService, load_questions
from src.services.generate_solution import SolutionGenerationService, SolutionSettings
from src.services.generation_session import SessionManager
from src.utils.supabase_writer import (
    upsert_question as _supabase_upsert_question,
    query_questions as _supabase_query,
    get_all_question_metadata as _supabase_inventory,
    is_enabled as _db_enabled,
)

load_dotenv()

_LOG_LEVEL = logging.DEBUG if os.getenv('DEBUG', '0').lower() in ('1', 'true') else logging.INFO
logging.basicConfig(
    level=_LOG_LEVEL,
    format='%(asctime)s %(levelname)s %(name)s: %(message)s',
)
LOGGER = logging.getLogger('oxai.backend')

_SUBJECT_ALIASES: Dict[str, str] = {
    'mathematics': 'math',
    'advanced mathematics': 'math',
    'advanced math': 'math',
    'physics': 'physics',
    'chemistry': 'chemistry',
    'biology': 'biology',
    'math': 'math',
}


def _normalise_subject(s: str) -> str:
    return _SUBJECT_ALIASES.get(s.lower().strip(), s.lower().strip())


BASE_DIR = Path(__file__).resolve().parent.parent
PROCESSED_BASE_DIR = BASE_DIR / 'data' / 'processed'
PROCESSED_DIR = PROCESSED_BASE_DIR / 'nsaa'
EXAM_DIRS = [PROCESSED_BASE_DIR / d for d in ('nsaa', 'tmua') if (PROCESSED_BASE_DIR / d).exists()]
GENERATED_DIR = BASE_DIR / 'generated'
DIAGRAM_DIR = GENERATED_DIR / 'diagrams'

PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
GENERATED_DIR.mkdir(parents=True, exist_ok=True)
DIAGRAM_DIR.mkdir(parents=True, exist_ok=True)


class GenerateRequest(BaseModel):
    subject: str = Field(..., min_length=1)
    topic: Optional[str] = None
    difficulty: int = Field(2, ge=1, le=5)
    examples: int = Field(3, ge=0, le=10)
    want_diagram: bool = False
    force_diagram: bool = False
    archetype: Optional[str] = None


class BatchGenerateRequest(BaseModel):
    subject: str = Field(..., min_length=1)
    n: int = Field(5, ge=1, le=20)
    topic: Optional[str] = None
    difficulty: Optional[int] = Field(None, ge=1, le=5)
    want_diagram: bool = False


class HintOption(BaseModel):
    label: str
    text: str


class HintRequest(BaseModel):
    stem: str = Field(..., min_length=1)
    options: list[HintOption] = Field(default_factory=list)
    subject: str = Field(..., min_length=1)
    topic: Optional[str] = None
    level: int = Field(..., ge=1, le=3)


class TutorChatMessage(BaseModel):
    role: str
    text: str


class TutorOption(BaseModel):
    label: str
    text: str


class TutorRequest(BaseModel):
    stem: str = Field(..., min_length=1)
    options: list[TutorOption] = Field(default_factory=list)
    subject: str = Field(..., min_length=1)
    topic: Optional[str] = None
    subtopic: Optional[str] = None
    difficulty: Optional[int] = None
    chat_history: list[TutorChatMessage] = Field(default_factory=list)
    solution_available: bool = False
    worked_solution: Optional[str] = None
    hints_shown: int = Field(0, ge=0)
    whiteboard_enabled: bool = False
    whiteboard_snapshot: Optional[str] = None  # base64 PNG data URL
    whiteboard_stroke_count: int = 0
    previous_response_id: Optional[str] = None


class SolutionOption(BaseModel):
    label: str
    text: str


class SolutionRequest(BaseModel):
    question_id: Optional[str] = None
    stem: str = Field(..., min_length=1)
    options: list[SolutionOption] = Field(default_factory=list)
    subject: str = Field(..., min_length=1)
    topic: Optional[str] = None
    subtopic: Optional[str] = None
    verified_answer_label: str = Field(..., min_length=1)
    verified_answer_text: Optional[str] = None


class SimilarOption(BaseModel):
    label: str
    text: str


class GenerateSimilarRequest(BaseModel):
    original_question_id: str
    stem: str = Field(..., min_length=1)
    options: list[SimilarOption] = Field(default_factory=list)
    subject: str = Field(..., min_length=1)
    topic: Optional[str] = None
    subtopic: Optional[str] = None
    difficulty: int = Field(2, ge=1, le=5)
    want_diagram: bool = False


class BankQueryRequest(BaseModel):
    subject: Optional[str] = None
    topic: Optional[str] = None
    difficulty: Optional[int] = Field(None, ge=1, le=5)
    limit: int = Field(20, ge=1, le=100)
    exclude_ids: list[str] = Field(default_factory=list)
    excluded_years: list[int] = Field(default_factory=list)
    exam: Optional[str] = None       # e.g. 'TMUA' or 'NSAA'; None = non-TMUA only
    tmua_paper: Optional[str] = None  # '1' or '2'


def paper_id_from_file(file_path: str) -> str:
    return Path(file_path).stem


def load_manifest() -> list[dict]:
    papers: list[dict] = []
    for exam_dir in EXAM_DIRS:
        manifest_path = exam_dir / 'manifest.json'
        if not manifest_path.exists():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        except json.JSONDecodeError:
            LOGGER.warning('Skipping invalid manifest: %s', manifest_path)
            continue
        if not isinstance(manifest, list):
            continue
        for item in manifest:
            if not isinstance(item, dict) or 'file' not in item:
                continue
            papers.append({**item, 'id': paper_id_from_file(str(item['file']))})
    if not papers:
        raise HTTPException(status_code=404, detail='No manifests found')
    return papers


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = GenerationSettings(
        processed_dir=PROCESSED_DIR,
        generated_dir=GENERATED_DIR,
        diagram_dir=DIAGRAM_DIR,
    )

    LOGGER.info('Starting OpenAI-backed question service...')
    service = QuestionGenerationService(settings=settings, logger=LOGGER)
    app.state.question_service = service
    try:
        service._get_example_index()
        LOGGER.info('Question example index warmed.')
    except Exception:
        LOGGER.exception('Failed to warm question example index; continuing with lazy rebuild.')

    hint_service = HintGenerationService(settings=HintSettings(), logger=LOGGER)
    app.state.hint_service = hint_service
    LOGGER.info('Hint service ready.')

    solution_service = SolutionGenerationService(
        settings=SolutionSettings(diagram_dir=DIAGRAM_DIR), logger=LOGGER
    )
    app.state.solution_service = solution_service
    LOGGER.info('Solution service ready.')

    tutor_service = TutorService(settings=TutorSettings(), logger=LOGGER)
    app.state.tutor_service = tutor_service
    LOGGER.info('Tutor service ready.')

    app.state.session_manager = SessionManager()
    LOGGER.info('Session manager ready.')
    yield
    LOGGER.info('Shutting down question service...')


app = FastAPI(title='oxAI Backend', lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.mount('/images/tmua', StaticFiles(directory=str(PROCESSED_BASE_DIR / 'tmua')), name='images_tmua')
app.mount('/images', StaticFiles(directory=str(PROCESSED_DIR)), name='images')
app.mount('/diagrams', StaticFiles(directory=str(DIAGRAM_DIR)), name='diagrams')


def _bank_questions() -> list[dict]:
    questions: list[dict] = []
    for exam_dir in EXAM_DIRS:
        questions.extend(load_questions(exam_dir))
    return questions


@app.get('/papers')
def list_papers():
    return {'papers': load_manifest()}



@app.post('/generate-question')
def generate_question_endpoint(req: GenerateRequest, background_tasks: BackgroundTasks):
    try:
        service: QuestionGenerationService = app.state.question_service
        mgr: SessionManager = app.state.session_manager
        subject = _normalise_subject(req.subject)
        session, prior_summary = mgr.get_or_create(subject, mode='live')
        question = service.generate_with_session(
            session=session,
            prior_summary=prior_summary,
            subject=subject,
            topic=req.topic,
            difficulty=req.difficulty,
            want_diagram=req.want_diagram,
            force_diagram=req.force_diagram,
            archetype=req.archetype,
        )
        if _db_enabled():
            background_tasks.add_task(
                _supabase_upsert_question, question,
                PROCESSED_DIR, DIAGRAM_DIR, 'generated',
            )
        return question
    except HTTPException:
        raise
    except Exception as exc:
        LOGGER.exception('ERROR IN /generate-question')
        raise HTTPException(status_code=500, detail=str(exc)) from exc



@app.post('/generate-batch')
def generate_batch_endpoint(req: BatchGenerateRequest, background_tasks: BackgroundTasks):
    """Batch generation for database population.

    Generates n questions for the given subject in a single session so each
    question chains from the previous one (cheaper, more diverse).
    When DB_WRITE_ENABLED=1, each question is upserted to Supabase in the background.
    """
    try:
        service: QuestionGenerationService = app.state.question_service
        mgr: SessionManager = app.state.session_manager
        subject = _normalise_subject(req.subject)
        session, prior_summary = mgr.get_or_create(subject, mode='batch')
        questions = service.generate_batch(
            session=session,
            prior_summary=prior_summary,
            subject=subject,
            n=req.n,
            topic=req.topic,
            difficulty=req.difficulty,
            want_diagram=req.want_diagram,
        )
        if _db_enabled():
            for q in questions:
                background_tasks.add_task(
                    _supabase_upsert_question, q,
                    PROCESSED_DIR, DIAGRAM_DIR, 'generated',
                )
        return {
            'questions': questions,
            'generated': len(questions),
            'session_id': session.session_id,
            'session_calls': session.call_count,
        }
    except HTTPException:
        raise
    except Exception as exc:
        LOGGER.exception('ERROR IN /generate-batch')
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post('/hint')
def hint_endpoint(req: HintRequest):
    try:
        service: HintGenerationService = app.state.hint_service
        hint = service.generate_hint(
            stem=req.stem,
            options=[o.model_dump() for o in req.options],
            subject=req.subject,
            topic=req.topic,
            level=req.level,
        )
        return hint
    except HTTPException:
        raise
    except Exception as exc:
        LOGGER.exception('ERROR IN /hint')
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post('/solution')
def solution_endpoint(req: SolutionRequest):
    try:
        service: SolutionGenerationService = app.state.solution_service
        solution = service.generate(
            stem=req.stem,
            options=[o.model_dump() for o in req.options],
            subject=req.subject,
            topic=req.topic,
            subtopic=req.subtopic,
            verified_answer_label=req.verified_answer_label,
            verified_answer_text=req.verified_answer_text,
            question_id=req.question_id,
        )
        return solution
    except HTTPException:
        raise
    except Exception as exc:
        LOGGER.exception('ERROR IN /solution')
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post('/ask-tutor')
def ask_tutor_endpoint(req: TutorRequest):
    try:
        service: TutorService = app.state.tutor_service
        result = service.respond(
            stem=req.stem,
            options=[o.model_dump() for o in req.options],
            subject=req.subject,
            topic=req.topic,
            subtopic=req.subtopic,
            difficulty=req.difficulty,
            chat_history=[m.model_dump() for m in req.chat_history],
            solution_available=req.solution_available,
            worked_solution=req.worked_solution,
            hints_shown=req.hints_shown,
            whiteboard_enabled=req.whiteboard_enabled,
            whiteboard_snapshot=req.whiteboard_snapshot,
            previous_response_id=req.previous_response_id,
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        LOGGER.exception('ERROR IN /ask-tutor')
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _normalise_paper_questions(questions: list[dict], *, exam: str, year: 'int | None', paper: str) -> list[dict]:
    """Normalise questions to canonical {question_id, source, content, prompt:{stem, options}} format."""
    result = []
    for idx, q in enumerate(questions):
        prompt = q.get('prompt')
        # Already canonical: prompt is a dict with 'stem'
        if isinstance(prompt, dict) and 'stem' in prompt:
            result.append(q)
            continue

        stem: str = prompt if isinstance(prompt, str) else (q.get('question') or q.get('stem') or '')

        raw_opts = q.get('options', {})
        if isinstance(raw_opts, dict):
            options = [{'label': k, 'text': str(v)} for k, v in raw_opts.items()]
        else:
            options = list(raw_opts)

        qnum: int = q.get('number') or q.get('question_number') or idx + 1
        year_str = str(year) if year else 'xx'
        qid = q.get('question_id') or f"{exam}_{year_str}_p{paper}_{qnum:02d}"

        result.append({
            'question_id': qid,
            'source': {
                'exam': exam,
                'year': year,
                'paper': f'Paper {paper}',
                'section': 'A',
                'question_number': qnum,
            },
            'content': {
                'subject': 'math',
                'topic': q.get('topic'),
                'difficulty': q.get('difficulty'),
            },
            'prompt': {'stem': stem, 'options': options},
        })
    return result


@app.get('/papers/{paper_id}')
def get_paper(paper_id: str):
    papers = load_manifest()
    paper_meta = next((p for p in papers if p['id'] == paper_id), None)

    if not paper_meta:
        raise HTTPException(status_code=404, detail='Paper not found')

    paper_path = BASE_DIR / str(paper_meta['file'])
    if not paper_path.exists():
        raise HTTPException(status_code=404, detail='Paper file missing')

    try:
        paper = json.loads(paper_path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f'Paper file is invalid JSON: {exc}') from exc

    # Unwrap nested format: {meta: ..., paper: {source, questions: [...]}}
    if 'paper' in paper and 'questions' not in paper:
        paper = paper['paper']

    paper['questions'] = _normalise_paper_questions(
        paper.get('questions', []),
        exam=str(paper_meta.get('exam', 'UNKNOWN')),
        year=paper_meta.get('year'),
        paper=str(paper_meta.get('paper', '1')),
    )

    return {'paper': paper, 'meta': paper_meta}


@app.post('/generate-similar')
def generate_similar_endpoint(req: GenerateSimilarRequest):
    try:
        service: QuestionGenerationService = app.state.question_service
        options_text = '\n'.join(f'{o.label}. {o.text}' for o in req.options)
        similar_context = (
            'Generate a question that tests the same underlying concept as the reference question below, '
            'but use different numbers, wording, and scenario. Do not paraphrase the original. '
            f'Reference topic: {req.topic or "general"}. '\
            f'Original stem: {req.stem[:300]}...\n'
            f'Original options: {options_text[:200]}'
        )

        question = service.generate_question(
            subject=req.subject,
            topic=req.topic,
            difficulty=req.difficulty,
            examples=3,
            want_diagram=req.want_diagram,
            force_diagram=False,
            similar_to_context=similar_context,
        )
        return question
    except HTTPException:
        raise
    except Exception as exc:
        LOGGER.exception('ERROR IN /generate-similar')
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post('/bank-questions')
def bank_questions_endpoint(req: BankQueryRequest, background_tasks: BackgroundTasks):
    try:
        req_subject = _normalise_subject(req.subject) if req.subject else None

        if _db_enabled():
            # ── Supabase path ──────────────────────────────────────────────
            results = _supabase_query(
                subject=req_subject,
                topic=req.topic,
                difficulty=req.difficulty,
                exclude_ids=req.exclude_ids,
                limit=req.limit,
            )

            # Filter excluded years (past papers carry source.year)
            if req.excluded_years and results:
                def _year(q: dict) -> int:
                    try:
                        return int((q.get('source') or {}).get('year') or 0)
                    except Exception:
                        return 0
                results = [q for q in results if _year(q) not in req.excluded_years]

            # If the bank is dry for this combo, generate fresh AI questions
            if not results:
                LOGGER.info(
                    'bank-questions: DB empty for subject=%s topic=%s diff=%s — generating',
                    req_subject, req.topic, req.difficulty,
                )
                service: QuestionGenerationService = app.state.question_service
                mgr: SessionManager = app.state.session_manager
                session, prior_summary = mgr.get_or_create(req_subject or 'math', mode='live')
                n_to_gen = min(req.limit, 3)
                for _ in range(n_to_gen):
                    try:
                        q = service.generate_with_session(
                            session=session,
                            prior_summary=prior_summary,
                            subject=req_subject or 'math',
                            topic=req.topic,
                            difficulty=req.difficulty or 2,
                            want_diagram=False,
                            force_diagram=False,
                        )
                        results.append(q)
                        background_tasks.add_task(
                            _supabase_upsert_question, q,
                            PROCESSED_DIR, DIAGRAM_DIR, 'generated',
                        )
                    except Exception:
                        LOGGER.exception('bank-questions: fallback generation failed')
                        break

            return {'questions': results, 'total': len(results)}

        # ── Local file fallback (no Supabase configured) ───────────────────
        req_exam = req.exam.upper() if req.exam else None
        questions = _bank_questions()
        import random as _random
        _random.shuffle(questions)
        filtered: List[Dict[str, Any]] = []
        for q in questions:
            if q.get('question_id') in req.exclude_ids:
                continue
            src = q.get('source') or {}
            c = q.get('content') or {}

            # Exam filter: when requesting TMUA, require it; otherwise exclude TMUA
            q_exam = str(src.get('exam') or '').upper()
            if req_exam:
                if q_exam != req_exam:
                    continue
            else:
                if q_exam == 'TMUA':
                    continue

            # TMUA paper filter
            if req.tmua_paper:
                q_paper = str(src.get('paper') or '')
                # Match '1', 'Paper 1' against tmua_paper='1' (or '2')
                if req.tmua_paper not in q_paper:
                    continue

            if req_subject and _normalise_subject(str(c.get('subject', ''))) != req_subject:
                continue
            if req.topic and str(c.get('topic', '')).lower() != req.topic.lower():
                continue
            if req.difficulty is not None:
                try:
                    if abs(int(c.get('difficulty', 0)) - req.difficulty) > 1:
                        continue
                except Exception:
                    pass
            if req.excluded_years:
                try:
                    q_year = int(src.get('year') or 0)
                except Exception:
                    q_year = 0
                if q_year and q_year in req.excluded_years:
                    continue
            filtered.append(q)
            if len(filtered) >= req.limit:
                break
        return {'questions': filtered, 'total': len(filtered)}

    except HTTPException:
        raise
    except Exception as exc:
        LOGGER.exception('ERROR IN /bank-questions')
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _build_inventory(rows: list[dict]) -> dict:
    """Aggregate question metadata rows into the inventory structure."""
    subjects: Dict[str, Any] = {}
    for row in rows:
        # Rows from Supabase have flat fields; local questions have content{}
        if 'subject' in row and 'content' not in row:
            subj = str(row.get('subject') or 'unknown').lower()
            topic = str(row.get('topic') or '') or 'general'
            difficulty = row.get('difficulty')
            subtopic = None
            has_diagram = False
            archetype = None
        else:
            c = row.get('content', {})
            subj = str(c.get('subject', 'unknown')).lower()
            topic = str(c.get('topic', '')) or 'general'
            subtopic = c.get('subtopic')
            difficulty = c.get('difficulty')
            has_diagram = bool(c.get('requires_diagram', False))
            archetype = c.get('archetype')

        if subj not in subjects:
            subjects[subj] = {'subject': subj, 'total': 0, 'topics': {}, 'difficulty_distribution': {}}
        subj_data = subjects[subj]
        subj_data['total'] += 1
        diff_key = str(difficulty) if difficulty is not None else 'unknown'
        subj_data['difficulty_distribution'][diff_key] = subj_data['difficulty_distribution'].get(diff_key, 0) + 1

        if topic not in subj_data['topics']:
            subj_data['topics'][topic] = {
                'topic': topic, 'subtopics': {}, 'count': 0,
                'difficulty_counts': {}, 'has_diagrams': False, 'archetypes': [],
            }
        topic_data = subj_data['topics'][topic]
        topic_data['count'] += 1
        if has_diagram:
            topic_data['has_diagrams'] = True
        if difficulty is not None:
            dk = str(difficulty)
            topic_data['difficulty_counts'][dk] = topic_data['difficulty_counts'].get(dk, 0) + 1
        if archetype and archetype not in topic_data['archetypes']:
            topic_data['archetypes'].append(archetype)
        if subtopic:
            topic_data['subtopics'][subtopic] = topic_data['subtopics'].get(subtopic, 0) + 1

    for subj_data in subjects.values():
        subj_data['topics'] = list(subj_data['topics'].values())
    return subjects


@app.get('/inventory')
def inventory_endpoint():
    try:
        if _db_enabled():
            rows = _supabase_inventory()
            if rows:
                subjects = _build_inventory(rows)
                return {'subjects': subjects, 'total': len(rows), 'scanned_at': None}

        # Fallback to local files
        questions = _bank_questions()
        subjects = _build_inventory(questions)
        return {'subjects': subjects, 'total': len(questions), 'scanned_at': None}
    except HTTPException:
        raise
    except Exception as exc:
        LOGGER.exception('ERROR IN /inventory')
        raise HTTPException(status_code=500, detail=str(exc)) from exc
