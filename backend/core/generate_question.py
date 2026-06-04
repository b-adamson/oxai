#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import uuid
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Deque, Dict, Iterable, List, Optional, Tuple

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer


LOGGER = logging.getLogger("oxai.generate_question")
OPTION_LABELS = ["A", "B", "C", "D", "E"]


def load_questions(processed_dir: Path) -> List[Dict[str, Any]]:
    questions: List[Dict[str, Any]] = []
    for path in sorted(processed_dir.rglob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue

        if isinstance(data, dict) and isinstance(data.get("questions"), list):
            for q in data["questions"]:
                if isinstance(q, dict):
                    questions.append(q)
        elif isinstance(data, dict) and "question_id" in data:
            questions.append(data)
    return questions


def compact_example(q: Dict[str, Any]) -> Dict[str, Any]:
    source = q.get("source", {}) if isinstance(q.get("source", {}), dict) else {}
    content = q.get("content", {}) if isinstance(q.get("content", {}), dict) else {}
    prompt = q.get("prompt", {}) if isinstance(q.get("prompt", {}), dict) else {}

    return {
        "question_id": q.get("question_id"),
        "source": {
            "exam": source.get("exam"),
            "year": source.get("year"),
            "paper": source.get("paper"),
            "section": source.get("section"),
            "question_number": source.get("question_number"),
        },
        "content": {
            "subject": content.get("subject"),
            "topic": content.get("topic"),
            "subtopic": content.get("subtopic"),
            "archetype": content.get("archetype"),
            "difficulty": content.get("difficulty"),
        },
        "prompt": {
            "stem": prompt.get("stem"),
            "options": prompt.get("options", []),
        },
    }


def choose_examples(
    questions: List[Dict[str, Any]],
    subject: str,
    topic: Optional[str],
    difficulty: int,
    k: int,
) -> List[Dict[str, Any]]:
    scored: List[Tuple[int, Dict[str, Any]]] = []
    for q in questions:
        c = q.get("content", {}) if isinstance(q.get("content", {}), dict) else {}
        score = 0

        if str(c.get("subject", "")).lower() == subject.lower():
            score += 3
        if topic and str(c.get("topic", "")).lower() == topic.lower():
            score += 3

        if c.get("difficulty") is not None:
            try:
                score += max(0, 3 - abs(int(c.get("difficulty")) - difficulty))
            except Exception:
                pass

        scored.append((score, q))

    scored.sort(key=lambda x: x[0], reverse=True)

    chosen = [q for s, q in scored[:k] if s > 0]
    return chosen or questions[:k]


def _safe_json_dumps(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def question_signature(question: Dict[str, Any]) -> str:
    prompt = question.get("prompt", {}) if isinstance(question.get("prompt", {}), dict) else {}
    content = question.get("content", {}) if isinstance(question.get("content", {}), dict) else {}

    payload = {
        "subject": content.get("subject"),
        "topic": content.get("topic"),
        "difficulty": content.get("difficulty"),
        "stem": prompt.get("stem"),
        "options": prompt.get("options", []),
    }
    digest = hashlib.sha256(_safe_json_dumps(payload).encode("utf-8")).hexdigest()
    return digest


def normalise_generated_question(question: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(question, dict):
        raise ValueError("Generated output was not a JSON object.")

    question.setdefault("question_id", str(uuid.uuid4()))

    if not isinstance(question.get("source"), dict):
        question["source"] = {}
    if not isinstance(question.get("content"), dict):
        question["content"] = {}
    if not isinstance(question.get("prompt"), dict):
        question["prompt"] = {}
    if not isinstance(question.get("generation"), dict):
        question["generation"] = {}
    if not isinstance(question.get("validation"), dict):
        question["validation"] = {}
    if not isinstance(question.get("metadata"), dict):
        question["metadata"] = {}

    prompt = question["prompt"]
    validation = question["validation"]

    options = prompt.get("options", [])
    if not isinstance(options, list):
        options = []

    fixed_options = []
    for i, label in enumerate(OPTION_LABELS):
        text = ""
        if i < len(options):
            opt = options[i]
            if isinstance(opt, dict):
                text = str(opt.get("text", ""))
            else:
                text = str(opt)
        fixed_options.append({"label": label, "text": text})

    prompt["options"] = fixed_options

    if "figures" not in prompt or not isinstance(prompt.get("figures"), list):
        prompt["figures"] = []

    validation["answer_label"] = None
    validation["answer_text"] = None
    validation["status"] = "unverified"

    if "data_quality_notes" not in question or not isinstance(question.get("data_quality_notes"), list):
        question["data_quality_notes"] = []

    return question


def build_prompt(
    subject: str,
    topic: Optional[str],
    difficulty: int,
    examples: List[Dict[str, Any]],
    request_nonce: str,
) -> str:
    spec = {
        "subject": subject,
        "topic": topic,
        "difficulty": difficulty,
        "request_nonce": request_nonce,
        "output_schema": [
            "question_id",
            "source",
            "content",
            "prompt",
            "generation",
            "validation",
            "metadata",
            "data_quality_notes",
        ],
    }

    example_text = json.dumps([compact_example(q) for q in examples], ensure_ascii=False, indent=2)

    return (
        "Generate exactly one NSAA-style multiple-choice question as valid JSON only.\n"
        "Produce a fresh question that is not a paraphrase of the examples.\n"
        "Do not include any prose outside the JSON object.\n\n"
        f"SPEC:\n{json.dumps(spec, ensure_ascii=False, indent=2)}\n\n"
        f"STYLE EXAMPLES:\n{example_text}\n\n"
        "Rules:\n"
        "- prompt.stem must be plain text with LaTeX where needed\n"
        "- prompt.stem must NOT contain the answer choices — they belong in prompt.options only\n"
        "- prompt.options MUST be a non-empty list of exactly 5 objects, each with keys 'label' and 'text'\n"
        "- The labels MUST be the single capital letters A, B, C, D, E in that order\n"
        "- Example options format: [{\"label\": \"A\", \"text\": \"$2x$\"}, {\"label\": \"B\", \"text\": \"$3x$\"}, ...]\n"
        "- prompt.figures must be an empty array unless a figure is required\n"
        "- validation.answer_label must be null for a brand-new generated question\n"
        "- validation.answer_text must be null\n"
        "- validation.status should be \"unverified\"\n"
        "- data_quality_notes should be an empty list\n"
        "- The question must feel new, not recycled\n"
        "Return JSON only."
    )


def extract_json_object(text: str) -> Dict[str, Any]:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
    text = re.sub(r"\s*```$", "", text)

    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object found.")

    depth = 0
    in_str = False
    escape = False
    end = None

    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break

    if end is None:
        raise ValueError("Could not find a complete JSON object.")

    return json.loads(text[start:end])


class RecentQuestionStore:
    """
    Persist a bounded set of recent question signatures so the same output
    is not accepted again for the same service.
    """

    def __init__(self, path: Path, maxlen: int = 1000):
        self.path = path
        self.maxlen = maxlen
        self._signatures: Deque[str] = deque(maxlen=maxlen)
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                for item in data[-self.maxlen :]:
                    if isinstance(item, str):
                        self._signatures.append(item)
        except Exception:
            return

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(list(self._signatures), indent=2), encoding="utf-8")
        tmp.replace(self.path)

    def contains(self, signature: str) -> bool:
        return signature in self._signatures

    def add(self, signature: str) -> None:
        if signature in self._signatures:
            return
        self._signatures.append(signature)
        self.save()


@dataclass
class GenerationSettings:
    base_model: str
    adapter_dir: Optional[Path]
    processed_dir: Path
    generated_dir: Path
    temperature: float = 0.85
    top_p: float = 0.9
    top_k: int = 50
    repetition_penalty: float = 1.08
    max_new_tokens: int = 1500
    candidate_batch_size: int = 4
    max_attempts: int = 6
    examples: int = 3


class QuestionGenerationService:
    def __init__(
        self,
        settings: GenerationSettings,
        logger: Optional[logging.Logger] = None,
    ) -> None:
        self.settings = settings
        self.logger = logger or LOGGER
        self.tokenizer = None
        self.model = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.recent_questions = RecentQuestionStore(
            self.settings.generated_dir / "recent_question_signatures.json"
        )

    def _configure_torch(self) -> None:
        if self.device.type == "cuda":
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
            try:
                torch.set_float32_matmul_precision("high")
            except Exception:
                pass

    def _log_device_info(self) -> None:
        if self.device.type != "cuda":
            self.logger.info("Using CPU for generation.")
            return

        idx = torch.cuda.current_device()
        props = torch.cuda.get_device_properties(idx)
        total_gib = props.total_memory / (1024 ** 3)
        free_bytes, total_bytes = torch.cuda.mem_get_info(idx)
        free_gib = free_bytes / (1024 ** 3)
        total_mem_gib = total_bytes / (1024 ** 3)

        self.logger.info(
            "CUDA ready: device=%s index=%s capability=%s total_vram=%.2fGiB free=%.2fGiB system_mem=%.2fGiB",
            props.name,
            idx,
            f"{props.major}.{props.minor}",
            total_gib,
            free_gib,
            total_mem_gib,
        )

    def _load_model(self) -> None:
        if self.model is not None and self.tokenizer is not None:
            return

        self._configure_torch()
        self._log_device_info()

        self.logger.info("Loading tokenizer: %s", self.settings.base_model)
        tokenizer = AutoTokenizer.from_pretrained(
            self.settings.base_model,
            trust_remote_code=True,
            use_fast=True,
        )
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        preferred_dtype = torch.float32
        attn_implementation = None
        if self.device.type == "cuda":
            preferred_dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
            attn_implementation = "flash_attention_2"

        model = None
        last_error: Optional[Exception] = None

        load_kwargs = dict(
            trust_remote_code=True,
            low_cpu_mem_usage=True,
            torch_dtype=preferred_dtype,
        )

        for attempt_attn in [attn_implementation, "sdpa", None]:
            try:
                kwargs = dict(load_kwargs)
                if attempt_attn is not None:
                    kwargs["attn_implementation"] = attempt_attn

                self.logger.info(
                    "Loading base model: %s (dtype=%s attn=%s)",
                    self.settings.base_model,
                    str(preferred_dtype).replace("torch.", ""),
                    attempt_attn or "default",
                )
                model = AutoModelForCausalLM.from_pretrained(
                    self.settings.base_model,
                    **kwargs,
                )

                if self.settings.adapter_dir is not None and self.settings.adapter_dir.exists():
                    self.logger.info("Loading adapter: %s", self.settings.adapter_dir)
                    model = PeftModel.from_pretrained(model, self.settings.adapter_dir)

                break
            except Exception as exc:
                last_error = exc
                self.logger.warning(
                    "Model load failed with attn=%s: %s",
                    attempt_attn or "default",
                    exc,
                )
                model = None
                continue

        if model is None:
            raise RuntimeError(f"Could not load model: {last_error}")

        model.eval()

        if self.device.type == "cuda":
            model = model.to(self.device)

        self.tokenizer = tokenizer
        self.model = model

        if self.device.type == "cuda":
            allocated = torch.cuda.memory_allocated() / (1024 ** 3)
            reserved = torch.cuda.memory_reserved() / (1024 ** 3)
            self.logger.info(
                "Model loaded on GPU: allocated=%.2fGiB reserved=%.2fGiB",
                allocated,
                reserved,
            )
        else:
            self.logger.info("Model loaded on CPU.")

    def _make_inputs(self, prompt: str):
        assert self.tokenizer is not None
        assert self.model is not None

        messages = [
            {"role": "system", "content": "You generate clean exam-style JSON questions."},
            {"role": "user", "content": prompt},
        ]

        if hasattr(self.tokenizer, "apply_chat_template") and getattr(self.tokenizer, "chat_template", None):
            text = self.tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
        else:
            text = prompt

        inputs = self.tokenizer([text], return_tensors="pt")
        inputs = {k: v.to(self.model.device) for k, v in inputs.items()}
        return inputs

    def _decode_candidates(self, output_ids, input_len: int) -> List[Dict[str, Any]]:
        assert self.tokenizer is not None

        candidates: List[Dict[str, Any]] = []
        for seq in output_ids:
            generated_tokens = seq[input_len:]
            decoded = self.tokenizer.decode(generated_tokens, skip_special_tokens=True).strip()
            try:
                candidate = extract_json_object(decoded)
                candidate = normalise_generated_question(candidate)
                candidates.append(candidate)
            except Exception:
                continue
        return candidates

    def generate_question(
        self,
        subject: str,
        topic: Optional[str],
        difficulty: int,
        examples: int,
    ) -> Dict[str, Any]:
        self._load_model()
        assert self.tokenizer is not None
        assert self.model is not None

        questions = load_questions(self.settings.processed_dir)
        chosen = choose_examples(questions, subject, topic, difficulty, examples)

        request_nonce = uuid.uuid4().hex
        base_prompt = build_prompt(subject, topic, difficulty, chosen, request_nonce=request_nonce)

        self.logger.info(
            "Generating question subject=%s topic=%s difficulty=%s examples=%s",
            subject,
            topic,
            difficulty,
            len(chosen),
        )

        inputs = self._make_inputs(base_prompt)
        input_len = inputs["input_ids"].shape[1]

        max_attempts = max(1, self.settings.max_attempts)
        batch_size = max(1, self.settings.candidate_batch_size)

        last_error: Optional[Exception] = None

        for attempt in range(1, max_attempts + 1):
            temperature = self.settings.temperature + (0.03 * (attempt - 1))
            generator = None
            if self.device.type == "cuda":
                generator = torch.Generator(device=self.device)
                generator.manual_seed(torch.seed())

            try:
                with torch.inference_mode():
                    output = self.model.generate(
                        **inputs,
                        max_new_tokens=self.settings.max_new_tokens,
                        do_sample=True,
                        temperature=temperature,
                        top_p=self.settings.top_p,
                        top_k=self.settings.top_k,
                        repetition_penalty=self.settings.repetition_penalty,
                        num_return_sequences=batch_size,
                        eos_token_id=self.tokenizer.eos_token_id,
                        pad_token_id=self.tokenizer.pad_token_id,
                        use_cache=True,
                        generator=generator,
                    )

                candidates = self._decode_candidates(output, input_len)
                if not candidates:
                    raise ValueError("No valid JSON candidates were produced.")

                for candidate in candidates:
                    sig = question_signature(candidate)
                    if self.recent_questions.contains(sig):
                        self.logger.info("Rejected duplicate candidate signature=%s", sig[:12])
                        continue

                    self.recent_questions.add(sig)
                    self.logger.info("Accepted new candidate signature=%s", sig[:12])
                    return candidate

                raise ValueError("All candidates were duplicates of recent outputs.")
            except Exception as exc:
                last_error = exc
                self.logger.warning("Generation attempt %d/%d failed: %s", attempt, max_attempts, exc)

        raise RuntimeError(f"Failed to generate a unique valid question: {last_error}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model", type=str, required=True)
    parser.add_argument("--adapter-dir", type=Path, default=None)
    parser.add_argument("--processed-dir", type=Path, default=Path("data/processed"))
    parser.add_argument("--generated-dir", type=Path, default=Path("output/generated"))
    parser.add_argument("--subject", type=str, required=True)
    parser.add_argument("--topic", type=str, default=None)
    parser.add_argument("--difficulty", type=int, required=True)
    parser.add_argument("--examples", type=int, default=3)
    parser.add_argument("--out", type=Path, default=Path("output/generated/generated_question.json"))
    parser.add_argument("--max-new-tokens", type=int, default=1500)
    parser.add_argument("--candidate-batch-size", type=int, default=4)
    parser.add_argument("--max-attempts", type=int, default=6)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    settings = GenerationSettings(
        base_model=args.base_model,
        adapter_dir=args.adapter_dir,
        processed_dir=args.processed_dir,
        generated_dir=args.generated_dir,
        max_new_tokens=args.max_new_tokens,
        candidate_batch_size=args.candidate_batch_size,
        max_attempts=args.max_attempts,
        examples=args.examples,
    )

    service = QuestionGenerationService(settings)
    question = service.generate_question(
        subject=args.subject,
        topic=args.topic,
        difficulty=args.difficulty,
        examples=args.examples,
    )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(question, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Saved {args.out}")


if __name__ == "__main__":
    main()