from __future__ import annotations

import json
import logging
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from core.generate_question import GenerationSettings, QuestionGenerationService


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
LOGGER = logging.getLogger("oxai.backend")

BASE_DIR = Path(__file__).resolve().parent
PROCESSED_DIR = BASE_DIR / "data" / "processed"
MANIFEST_PATH = PROCESSED_DIR / "manifest.json"
GENERATED_DIR = BASE_DIR / "generated"
ADAPTER_DIR = BASE_DIR / "checkpoints" / "qwen-nsaa-lora"
BASE_MODEL = "Qwen/Qwen3-0.6B"

PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
GENERATED_DIR.mkdir(parents=True, exist_ok=True)


class GenerateRequest(BaseModel):
    subject: str
    topic: Optional[str] = None
    difficulty: int = 2
    examples: int = 3


def paper_id_from_file(file_path: str) -> str:
    return Path(file_path).stem


def load_manifest():
    if not MANIFEST_PATH.exists():
        raise HTTPException(status_code=404, detail="Manifest not found")

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    papers = []

    for item in manifest:
        papers.append(
            {
                **item,
                "id": paper_id_from_file(item["file"]),
            }
        )

    return papers


def normalise_options(question: dict) -> dict:
    """
    Ensure prompt.options always uses A/B/C/D/E labels and figures exists.
    """
    if not isinstance(question, dict):
        raise HTTPException(status_code=500, detail="Generated question was not a JSON object")

    prompt = question.get("prompt", {})
    if not isinstance(prompt, dict):
        prompt = {}
        question["prompt"] = prompt

    options = prompt.get("options", [])
    if not isinstance(options, list):
        options = []

    fixed = []
    labels = ["A", "B", "C", "D", "E"]

    for i, label in enumerate(labels):
        text = ""
        if i < len(options):
            opt = options[i]
            if isinstance(opt, dict):
                text = str(opt.get("text", ""))
            else:
                text = str(opt)
        fixed.append({"label": label, "text": text})

    prompt["options"] = fixed
    if not isinstance(prompt.get("figures"), list):
        prompt["figures"] = []

    validation = question.get("validation", {})
    if not isinstance(validation, dict):
        validation = {}
        question["validation"] = validation

    validation["answer_label"] = None
    validation["answer_text"] = None
    validation["status"] = "unverified"

    if not isinstance(question.get("data_quality_notes"), list):
        question["data_quality_notes"] = []

    return question


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = GenerationSettings(
        base_model=BASE_MODEL,
        adapter_dir=ADAPTER_DIR if ADAPTER_DIR.exists() else None,
        processed_dir=PROCESSED_DIR,
        generated_dir=GENERATED_DIR,
        max_new_tokens=1500,
        candidate_batch_size=4,
        max_attempts=6,
        examples=3,
    )

    LOGGER.info("Starting model service...")
    service = QuestionGenerationService(settings, logger=LOGGER)
    service._load_model()  # warm-load once at startup
    app.state.question_service = service
    LOGGER.info("Model service ready.")
    yield
    LOGGER.info("Shutting down model service...")


app = FastAPI(title="oxAI Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later if you want
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/images", StaticFiles(directory=str(PROCESSED_DIR)), name="images")


@app.get("/papers")
def list_papers():
    return {"papers": load_manifest()}


@app.post("/generate-question")
def generate_question_endpoint(req: GenerateRequest):
    try:
        service: QuestionGenerationService = app.state.question_service
        question = service.generate_question(
            subject=req.subject,
            topic=req.topic,
            difficulty=req.difficulty,
            examples=req.examples,
        )
        question = normalise_options(question)

        out_path = GENERATED_DIR / "generated_question.json"
        out_path.write_text(
            json.dumps(question, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        return question

    except Exception as e:
        LOGGER.exception("ERROR IN /generate-question")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/generated-question")
def get_generated_question():
    out_path = GENERATED_DIR / "generated_question.json"
    if not out_path.exists():
        raise HTTPException(status_code=404, detail="No generated question found")
    return json.loads(out_path.read_text(encoding="utf-8"))


@app.get("/papers/{paper_id}")
def get_paper(paper_id: str):
    papers = load_manifest()
    paper_meta = next((p for p in papers if p["id"] == paper_id), None)

    if not paper_meta:
        raise HTTPException(status_code=404, detail="Paper not found")

    paper_path = (BASE_DIR / paper_meta["file"]).resolve()
    if not paper_path.exists():
        raise HTTPException(status_code=404, detail="Paper file missing")

    paper = json.loads(paper_path.read_text(encoding="utf-8"))
    return {
        "paper": paper,
        "meta": paper_meta,
    }