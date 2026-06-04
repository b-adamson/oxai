from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pathlib import Path
from typing import Optional
from contextlib import contextmanager
import json
import sys
import traceback

# Make sure local imports work
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from core import generate_question as gen  # noqa: E402

app = FastAPI(title="oxAI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later if you want
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PROCESSED_DIR = BASE_DIR / "data" / "processed"
MANIFEST_PATH = PROCESSED_DIR / "manifest.json"
GENERATED_DIR = BASE_DIR / "generated"
ADAPTER_DIR = BASE_DIR / "checkpoints" / "qwen-nsaa-lora"
BASE_MODEL = "Qwen/Qwen3-0.6B"

app.mount("/images", StaticFiles(directory=str(PROCESSED_DIR)), name="images")


class GenerateRequest(BaseModel):
    subject: str
    topic: Optional[str] = None
    difficulty: int = 2
    examples: int = 3


OPTION_LABELS = ["A", "B", "C", "D", "E"]


def normalise_options(question: dict) -> dict:
    """Ensure prompt.options always uses A/B/C/D/E labels."""
    options = question.get("prompt", {}).get("options", [])

    if not isinstance(options, list):
        options = []

    fixed = []
    for i, opt in enumerate(options):
        if i >= len(OPTION_LABELS):
            break
        if isinstance(opt, dict):
            fixed.append({"label": OPTION_LABELS[i], "text": opt.get("text", str(opt))})
        else:
            fixed.append({"label": OPTION_LABELS[i], "text": str(opt)})

    question.setdefault("prompt", {})["options"] = fixed
    return question


def paper_id_from_file(file_path: str) -> str:
    return Path(file_path).stem


def load_manifest():
    if not MANIFEST_PATH.exists():
        raise HTTPException(status_code=404, detail="Manifest not found")

    manifest = json.loads(MANIFEST_PATH.read_text())
    papers = []

    for item in manifest:
        papers.append(
            {
                **item,
                "id": paper_id_from_file(item["file"]),
            }
        )

    return papers


@contextmanager
def temp_argv(args):
    old = sys.argv[:]
    sys.argv = args
    try:
        yield
    finally:
        sys.argv = old


@app.get("/papers")
def list_papers():
    return {"papers": load_manifest()}


@app.post("/generate-question")
def generate_question_endpoint(req: GenerateRequest):
    try:
        out_path = GENERATED_DIR / "generated_question.json"

        argv = [
            "generate_question.py",
            "--base-model",
            BASE_MODEL,
            "--adapter-dir",
            str(ADAPTER_DIR),
            "--processed-dir",
            str(PROCESSED_DIR),
            "--subject",
            req.subject,
            "--difficulty",
            str(req.difficulty),
            "--examples",
            str(req.examples),
            "--out",
            str(out_path),
        ]

        if req.topic:
            argv.extend(["--topic", req.topic])

        with temp_argv(argv):
            gen.main()

        question = json.loads(out_path.read_text(encoding="utf-8"))
        question = normalise_options(question)

        GENERATED_DIR.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps(question, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        return question

    except Exception as e:
        print("ERROR IN /generate-question")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/papers/{paper_id}")
def get_paper(paper_id: str):
    papers = load_manifest()
    paper_meta = next((p for p in papers if p["id"] == paper_id), None)

    if not paper_meta:
        raise HTTPException(status_code=404, detail="Paper not found")

    paper_path = (BASE_DIR / paper_meta["file"]).resolve()
    if not paper_path.exists():
        raise HTTPException(status_code=404, detail="Paper file missing")

    paper = json.loads(paper_path.read_text())
    return {
        "paper": paper,
        "meta": paper_meta,
    }