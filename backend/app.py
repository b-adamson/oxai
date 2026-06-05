from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from core.ask_tutor import TutorService, TutorSettings
from core.generate_hint import HintGenerationService, HintSettings
from core.generate_question import GenerationSettings, QuestionGenerationService
from core.generate_solution import SolutionGenerationService, SolutionSettings

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(name)s: %(message)s',
)
LOGGER = logging.getLogger('oxai.backend')

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
    role: str  # "user" or "tutor"
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
    LOGGER.info('Question service ready.')

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


@app.get('/papers')
def list_papers():
    return {'papers': load_manifest()}


@app.post('/generate-question')
def generate_question_endpoint(req: GenerateRequest):
    try:
        service: QuestionGenerationService = app.state.question_service
        question = service.generate_question(
            subject=req.subject,
            topic=req.topic,
            difficulty=req.difficulty,
            examples=req.examples,
            want_solution=req.want_solution,
            want_diagram=req.want_diagram,
            force_diagram=req.force_diagram,
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

    paper_path = (BASE_DIR / str(paper_meta['file']))
    if not paper_path.exists():
        raise HTTPException(status_code=404, detail='Paper file missing')

    try:
        paper = json.loads(paper_path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f'Paper file is invalid JSON: {exc}') from exc

    return {'paper': paper, 'meta': paper_meta}
