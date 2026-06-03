#!/usr/bin/env python3
import json
import re
from pathlib import Path
from typing import Any, Dict

ANSWER_KEY_TEXT = r"""
1 E 41 E
2 D 42 B
3 D 43 C
4 E 44 G
5 D 45 D
6 D 46 A
7 C 47 E
8 B 48 F
9 B 49 H
10 B 50 G
11 G 51 C
12 C 52 A
13 G 53 D
14 C 54 E
15 E 55 D
16 B 56 C
17 E 57 F
18 A 58 A
19 D 59 E
20 C 60 B
21 A 61 A
22 C 62 B
23 E 63 F
24 G 64 B
25 E 65 D
26 B 66 E
27 A 67 G
28 G 68 G
29 B 69 D
30 D 70 F
31 E 71 G
32 C 72 B
33 G 73 D
34 C 74 F
35 D 75 C
36 D 76 F
37 F 77 A
38 E 78 G
39 E 79 D
40 A 80 C
"""

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
INPUT_FILE = PROJECT_ROOT / "output" / "questions_2022.json"
OUTPUT_FILE = INPUT_FILE


def parse_answer_key(text: str) -> Dict[int, str]:
    mapping: Dict[int, str] = {}
    for line in text.strip().splitlines():
        nums = re.findall(r"(\d+)\s+([A-H])", line)
        for qnum_str, label in nums:
            mapping[int(qnum_str)] = label
    return mapping


def set_answer_fields(question: Dict[str, Any], answer_label: str) -> None:
    validation = question.setdefault("validation", {})
    validation["answer_label"] = answer_label

    answer_text = None
    for opt in question.get("prompt", {}).get("options", []):
        if opt.get("label") == answer_label:
            answer_text = opt.get("text")
            break

    validation["answer_text"] = answer_text
    validation["status"] = "verified" if answer_text is not None else "unverified"


def main():
    print(f"Reading:  {INPUT_FILE}")
    data = json.loads(INPUT_FILE.read_text(encoding="utf-8"))
    answer_map = parse_answer_key(ANSWER_KEY_TEXT)

    updated = 0
    for q in data.get("questions", []):
        qnum = q.get("source", {}).get("question_number")
        if qnum in answer_map:
            set_answer_fields(q, answer_map[qnum])
            updated += 1

    OUTPUT_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Updated {updated} questions.")
    print(f"Saved to: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()