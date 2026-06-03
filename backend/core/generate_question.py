#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer


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
    return {
        "question_id": q.get("question_id"),
        "source": {
            "exam": q.get("source", {}).get("exam"),
            "year": q.get("source", {}).get("year"),
            "paper": q.get("source", {}).get("paper"),
            "section": q.get("source", {}).get("section"),
            "question_number": q.get("source", {}).get("question_number"),
        },
        "content": {
            "subject": q.get("content", {}).get("subject"),
            "topic": q.get("content", {}).get("topic"),
            "subtopic": q.get("content", {}).get("subtopic"),
            "archetype": q.get("content", {}).get("archetype"),
            "difficulty": q.get("content", {}).get("difficulty"),
        },
        "prompt": {
            "stem": q.get("prompt", {}).get("stem"),
            "options": q.get("prompt", {}).get("options", []),
        },
    }


def choose_examples(
    questions: List[Dict[str, Any]],
    subject: str,
    topic: Optional[str],
    difficulty: int,
    k: int,
) -> List[Dict[str, Any]]:
    scored = []
    for q in questions:
        c = q.get("content", {})
        score = 0
        if str(c.get("subject", "")).lower() == subject.lower():
            score += 3
        if topic and str(c.get("topic", "")).lower() == topic.lower():
            score += 3
        if c.get("difficulty") is not None:
            score += max(0, 3 - abs(int(c.get("difficulty")) - difficulty))
        scored.append((score, q))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [q for s, q in scored[:k] if s > 0] or questions[:k]


def build_prompt(subject: str, topic: Optional[str], difficulty: int, examples: List[Dict[str, Any]]) -> str:
    spec = {
        "subject": subject,
        "topic": topic,
        "difficulty": difficulty,
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
        "Use the following style examples and constraints.\n\n"
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model", type=str, required=True)
    parser.add_argument("--adapter-dir", type=Path, default=None)
    parser.add_argument("--processed-dir", type=Path, default=Path("data/processed"))
    parser.add_argument("--subject", type=str, required=True)
    parser.add_argument("--topic", type=str, default=None)
    parser.add_argument("--difficulty", type=int, required=True)
    parser.add_argument("--examples", type=int, default=3)
    parser.add_argument("--out", type=Path, default=Path("output/generated/generated_question.json"))
    parser.add_argument("--max-new-tokens", type=int, default=1500)
    args = parser.parse_args()

    tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        trust_remote_code=True,
        device_map="auto",
        torch_dtype="auto",
    )

    if args.adapter_dir is not None and args.adapter_dir.exists():
        model = PeftModel.from_pretrained(model, args.adapter_dir)

    questions = load_questions(args.processed_dir)
    chosen = choose_examples(questions, args.subject, args.topic, args.difficulty, args.examples)
    prompt = build_prompt(args.subject, args.topic, args.difficulty, chosen)

    messages = [
        {"role": "system", "content": "You generate clean exam-style JSON questions."},
        {"role": "user", "content": prompt},
    ]

    if hasattr(tokenizer, "apply_chat_template"):
        text = tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )
    else:
        text = prompt

    inputs = tokenizer([text], return_tensors="pt").to(model.device)
    input_len = inputs["input_ids"].shape[1]

    with torch.no_grad():
        output = model.generate(
            **inputs,
            max_new_tokens=args.max_new_tokens,
            do_sample=True,
            temperature=0.7,
            top_p=0.9,
            eos_token_id=tokenizer.eos_token_id,
        )

    generated_tokens = output[0][input_len:]
    decoded = tokenizer.decode(generated_tokens, skip_special_tokens=True).strip()
    question = extract_json_object(decoded)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(question, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Saved {args.out}")


if __name__ == "__main__":
    main()