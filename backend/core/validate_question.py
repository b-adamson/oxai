#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from typing import Any, Dict, List


REQUIRED_TOP_LEVEL = [
    "question_id",
    "source",
    "content",
    "prompt",
    "generation",
    "validation",
    "metadata",
    "data_quality_notes",
]


def validate(question: Dict[str, Any]) -> List[str]:
    errors = []

    for key in REQUIRED_TOP_LEVEL:
        if key not in question:
            errors.append(f"Missing top-level key: {key}")

    prompt = question.get("prompt", {})
    options = prompt.get("options", [])

    if not isinstance(options, list) or not options:
        errors.append("prompt.options must be a non-empty list")
    else:
        labels = [opt.get("label") for opt in options if isinstance(opt, dict)]
        if len(labels) != len(set(labels)):
            errors.append("Duplicate option labels found")
        if any(not isinstance(opt, dict) or "label" not in opt or "text" not in opt for opt in options):
            errors.append("Each option must have label and text")

    validation = question.get("validation", {})
    if validation.get("answer_label") is not None and not isinstance(validation.get("answer_label"), str):
        errors.append("validation.answer_label must be a string or null")
    if validation.get("status") not in {"unverified", "verified", None}:
        errors.append("validation.status must be unverified, verified, or null")

    return errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("file", type=Path)
    args = parser.parse_args()

    data = json.loads(args.file.read_text(encoding="utf-8"))
    errs = validate(data)

    if errs:
        print("INVALID")
        for e in errs:
            print(f"- {e}")
        raise SystemExit(1)

    print("VALID")


if __name__ == "__main__":
    main()