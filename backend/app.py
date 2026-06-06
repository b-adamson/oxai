from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from core.ask_tutor import TutorService, TutorSettings
from core.generate_hint import HintGenerationService, HintSettings
from core.generate_question import GenerationSettings, QuestionGenerationService, load_questions
from core.generate_solution import SolutionGenerationService, SolutionSettings

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
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


BASE_DIR = Path(__file__).resolve().parent
PROCESSED_DIR = BASE_DIR / 'data' / 'processed'
MANIFEST_PATH = PROCESSED_DIR / 'manifest.json'
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
    want_solution: bool = True
    want_diagram: bool = False
    force_diagram: bool = False
    archetype: Optional[str] = None


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
    want_solution: bool = True
    want_diagram: bool = False


class BankQueryRequest(BaseModel):
    subject: Optional[str] = None
    topic: Optional[str] = None
    difficulty: Optional[int] = Field(None, ge=1, le=5)
    limit: int = Field(20, ge=1, le=100)
    exclude_ids: list[str] = Field(default_factory=list)
    excluded_years: list[int] = Field(default_factory=list)


def paper_id_from_file(file_path: str) -> str:
    return Path(file_path).stem


def load_manifest() -> list[dict]:
    if not MANIFEST_PATH.exists():
        raise HTTPException(status_code=404, detail='Manifest not found')

    try:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f'Manifest is invalid JSON: {exc}') from exc

    if not isinstance(manifest, list):
        raise HTTPException(status_code=500, detail='Manifest must be a list')

    papers: list[dict] = []
    for item in manifest:
        if not isinstance(item, dict) or 'file' not in item:
            continue
        papers.append({**item, 'id': paper_id_from_file(str(item['file']))})
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

app.mount('/images', StaticFiles(directory=str(PROCESSED_DIR)), name='images')
app.mount('/diagrams', StaticFiles(directory=str(DIAGRAM_DIR)), name='diagrams')


def _bank_questions() -> list[dict]:
    service: QuestionGenerationService = app.state.question_service
    return service._get_questions()


@app.get('/papers')
def list_papers():
    return {'papers': load_manifest()}


@app.post('/generate-question')
def generate_question_endpoint(req: GenerateRequest):
    try:
        service: QuestionGenerationService = app.state.question_service
        question = service.generate_question(
            subject=_normalise_subject(req.subject),
            topic=req.topic,
            difficulty=req.difficulty,
            examples=req.examples,
            want_solution=req.want_solution,
            want_diagram=req.want_diagram,
            force_diagram=req.force_diagram,
            archetype=req.archetype,
        )
        return question
    except HTTPException:
        raise
    except Exception as exc:
        LOGGER.exception('ERROR IN /generate-question')
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
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        LOGGER.exception('ERROR IN /ask-tutor')
        raise HTTPException(status_code=500, detail=str(exc)) from exc


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
            want_solution=req.want_solution,
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
def bank_questions_endpoint(req: BankQueryRequest):
    try:
        questions = _bank_questions()
        req_subject = _normalise_subject(req.subject) if req.subject else None
        filtered: List[Dict[str, Any]] = []
        for q in questions:
            if q.get('question_id') in req.exclude_ids:
                continue
            c = q.get('content', {})
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
                src = q.get('source', {})
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


@app.get('/inventory')
def inventory_endpoint():
    try:
        questions = _bank_questions()
        subjects: Dict[str, Any] = {}

        for q in questions:
            c = q.get('content', {})
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
                    'topic': topic,
                    'subtopics': {},
                    'count': 0,
                    'difficulty_counts': {},
                    'has_diagrams': False,
                    'archetypes': [],
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

        return {'subjects': subjects, 'total': len(questions), 'scanned_at': None}
    except HTTPException:
        raise
    except Exception as exc:
        LOGGER.exception('ERROR IN /inventory')
        raise HTTPException(status_code=500, detail=str(exc)) from exc
