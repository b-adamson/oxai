#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List


def load_question_files(processed_dir: Path) -> Iterable[Dict[str, Any]]:
    for path in sorted(processed_dir.rglob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[skip] {path}: {e}")
            continue

        if isinstance(data, dict) and isinstance(data.get("questions"), list):
            for q in data["questions"]:
                if isinstance(q, dict):
                    yield q
        elif isinstance(data, dict) and "question_id" in data:
            yield data


def make_user_prompt(q: Dict[str, Any]) -> str:
    source = q.get("source", {})
    content = q.get("content", {})
    prompt = q.get("prompt", {})
    opts = prompt.get("options", [])

    subject = content.get("subject", "math")
    topic = content.get("topic") or "general"
    difficulty = content.get("difficulty", 2)
    archetype = content.get("archetype") or "general"

    option_count = len(opts)

    return (
        "Generate one NSAA-style multiple-choice question as valid JSON only.\n"
        f"Subject: {subject}\n"
        f"Topic: {topic}\n"
        f"Difficulty: {difficulty}\n"
        f"Archetype: {archetype}\n"
        f"Use {option_count} options.\n"
        "Return one object with keys:\n"
        "question_id, source, content, prompt, generation, validation, metadata, data_quality_notes.\n"
        "Do not wrap in markdown.\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--processed-dir", type=Path, default=Path("data/processed"))
    parser.add_argument("--out", type=Path, default=Path("data/training/sft_questions.jsonl"))
    args = parser.parse_args()

    args.out.parent.mkdir(parents=True, exist_ok=True)

    count = 0
    with args.out.open("w", encoding="utf-8") as f:
        for q in load_question_files(args.processed_dir):
            record = {
                "messages": [
                    {"role": "user", "content": make_user_prompt(q)},
                    {"role": "assistant", "content": json.dumps(q, ensure_ascii=False)},
                ]
            }
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
            count += 1

    print(f"Wrote {count} training rows to {args.out}")


if __name__ == "__main__":
    main()