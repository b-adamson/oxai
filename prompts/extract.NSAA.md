# NSAA Exam Extraction — Reference Guide

This project extracts NSAA (Natural Sciences Admissions Assessment) past papers from PDF into a structured JSON schema, served by a browser-based viewer with MathJax LaTeX rendering.

The goal is to turn a PDF into:
- `output/questions_YEAR.json`
- `output/images_YEAR/`
- `output/manifest.json`

Do not solve the exam. Do not explain the exam. Only extract it.

---

## Extraction strategy

Use Claude Code directly on the PDF and write the JSON into `output/`.

For each paper:
- extract all questions into `output/questions_YEAR.json`
- crop visible figures into `output/images_YEAR/`
- update `output/manifest.json`

Do not use API-client extractor scripts for this workflow.

---

## Hard rules

- Never solve questions.
- Never explain reasoning.
- Never rewrite or summarize the exam.
- Never invent missing text.
- Output only the requested JSON or file edits.
- Preserve visible LaTeX exactly.
- If a question continues onto the next page, merge the continuation.
- If uncertain, leave the content minimal and mark it for review rather than guessing.
- Do not let page numbers become answer options.
- Do not let graph axis labels leak into the stem.
- Do not convert mathematical notation into plain text.
- Do not replace LaTeX with Unicode when the LaTeX is visible.

---

Ensure you get the figures right. do NOT paste in the entire page as a png and call that a diagram. We need bounding boxes or extracted images such that the viewer shows them as a diagram.

## Section mapping

- Q1–20 = Part A Mathematics
- Q21–40 = Part B Physics
- Q41–60 = Part C Chemistry
- Q61–80 = Part D Biology

---

## Full JSON schema

Every question must conform to this structure:

```json
{
  "question_id": "2021_B_22",
  "source": {
    "exam": "NSAA",
    "year": 2021,
    "paper": "Part B Physics",
    "section": "B",
    "question_number": 22,
    "page": 7,
    "source_pdf": "raw/2021.pdf"
  },
  "content": {
    "subject": "physics",
    "topic": null,
    "subtopic": null,
    "archetype": null,
    "difficulty": 2,
    "requires_diagram": true,
    "requires_calculation": true
  },
  "prompt": {
    "stem": "Question text with $\\LaTeX$...",
    "options": [
      { "label": "A", "text": "$2x$" },
      { "label": "B", "text": "$3x$" }
    ],
    "figures": [
      {
        "figure_id": "q22_figure",
        "type": "figure",
        "src": "images_2021/q22_figure.png"
      }
    ]
  },
  "generation": {
    "template_id": "physics_q022",
    "template_version": "1.0",
    "parameters": {},
    "solution_steps": [],
    "distractor_strategy": []
  },
  "validation": {
    "answer_label": null,
    "answer_text": null,
    "status": "unverified"
  },
  "metadata": {
    "estimated_time_seconds": null,
    "tags": ["physics"]
  }
}

PROMPT:

Extract raw/2020.pdf into output/questions_2020.json.

Follow the above instructions exactly.
Do not solve any questions.
Do not explain reasoning.
Preserve LaTeX exactly.
Crop all visible figures into output/images_2020/.
Update output/manifest.json.
Return only file edits and valid JSON.

