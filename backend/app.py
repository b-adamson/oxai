from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pathlib import Path
from typing import Optional
import json
import sys

app = FastAPI(title="oxAI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later if you want
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
PROCESSED_DIR = BASE_DIR / "data" / "processed"
MANIFEST_PATH = PROCESSED_DIR / "manifest.json"
GENERATED_DIR = BASE_DIR / "generated"
ADAPTER_DIR = BASE_DIR / "checkpoints" / "qwen-nsaa-lora"
BASE_MODEL = "Qwen/Qwen3-0.6B"

app.mount("/images", StaticFiles(directory=str(PROCESSED_DIR)), name="images")

# Lazy-loaded model state
_model = None
_tokenizer = None

sys.path.insert(0, str(BASE_DIR))


def get_model():
    global _model, _tokenizer
    if _model is None:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from peft import PeftModel

        _tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
        if _tokenizer.pad_token is None:
            _tokenizer.pad_token = _tokenizer.eos_token

        _model = AutoModelForCausalLM.from_pretrained(
            BASE_MODEL,
            trust_remote_code=True,
            device_map="auto",
            torch_dtype="auto",
        )
        if ADAPTER_DIR.exists():
            _model = PeftModel.from_pretrained(_model, str(ADAPTER_DIR))

    return _model, _tokenizer


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

    # Re-label whatever the model produced to A, B, C, D, E
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


@app.get("/papers")
def list_papers():
    return {"papers": load_manifest()}


@app.post("/generate-question")
def generate_question_endpoint(req: GenerateRequest):
    import torch
    from core.generate_question import (
        load_questions,
        choose_examples,
        build_prompt,
        extract_json_object,
    )

    try:
        model, tokenizer = get_model()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Model unavailable: {e}")

    questions = load_questions(PROCESSED_DIR)
    chosen = choose_examples(questions, req.subject, req.topic, req.difficulty, req.examples)
    prompt = build_prompt(req.subject, req.topic, req.difficulty, chosen)

    messages = [
        {"role": "system", "content": "You generate clean exam-style JSON questions."},
        {"role": "user", "content": prompt},
    ]

    if hasattr(tokenizer, "apply_chat_template"):
        text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    else:
        text = prompt

    inputs = tokenizer([text], return_tensors="pt").to(model.device)
    input_len = inputs["input_ids"].shape[1]

    with torch.no_grad():
        output = model.generate(
            **inputs,
            max_new_tokens=1500,
            do_sample=True,
            temperature=0.7,
            top_p=0.9,
            eos_token_id=tokenizer.eos_token_id,
        )

    decoded = tokenizer.decode(output[0][input_len:], skip_special_tokens=True).strip()

    try:
        question = extract_json_object(decoded)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"Model output was not valid JSON: {e}")

    question = normalise_options(question)

    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    (GENERATED_DIR / "generated_question.json").write_text(
        json.dumps(question, indent=2, ensure_ascii=False)
    )

    return question


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