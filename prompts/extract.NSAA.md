# Past Paper Extraction — Reference Guide

This prompt is for **ChatGPT** (GPT-4o or later, with PDF/vision capability). Upload the PDF and send the prompt below. ChatGPT will read the paper and output the JSON — download the result and drop it into the project.

Supported exams: **TMUA**, **ESAT**, **NSAA**, or any similar MCQ paper.

---

## What you are doing

You are reading a PDF of a past exam paper and producing a single JSON file containing all questions in the schema described below. You are **not** solving the exam. You are **not** explaining anything. You are only faithfully extracting the content into structured JSON.

The output must be a **downloadable JSON file**. Ask ChatGPT to output the result as a file attachment (it can do this natively). If it outputs a code block instead, copy the contents and save manually.

---

## Images — already extracted

**Do not extract or base64-encode any images.** Images have already been extracted from the PDF separately. For questions that have a diagram or figure that is a real image (e.g. a circuit, a graph drawn in the PDF, a biological diagram), use the `src` field with the convention:

```
images_<paper_label>/q<NN>_<description>.png
```

Example: `images_spec_paper_2/q07_graph.png`

The actual image file will be placed there manually. You only need to reference it by the expected filename.

---

## When to use each figure type

There are three figure schemas — choose based on what the question actually contains:

| Situation | Use |
|---|---|
| A real diagram/circuit/drawing in the PDF that is a pre-rendered image | `src`-based figure (old schema) |
| A data table embedded in the question | `figure_type: "table"` |
| A labelled graph with numeric data you can read off the axes | `figure_type: "simple_graph"` |
| A complex diagram that needs AI to redraw (e.g. geometry, force diagram, pulley) | `figure_type: "complex_diagram"` |

---

## Figure schemas

### Old schema — image reference
Use for any figure that is a real rendered image in the PDF:
```json
{
  "figure_id": "q07_graph",
  "type": "graph",
  "src": "images_spec_paper_2/q07_graph.png"
}
```

### New schema — table
Use when the question contains a data table you can read:
```json
{
  "figure_type": "table",
  "caption": "Results table",
  "diagram_prompt": null,
  "table_headers": ["Column A", "Column B", "Column C"],
  "table_rows": [
    ["row1_a", "row1_b", "row1_c"],
    ["row2_a", "row2_b", "row2_c"]
  ],
  "table_row_labels": ["A", "B", "C", "D"],
  "graph_type": null,
  "graph_title": null,
  "graph_x_label": null,
  "graph_y_label": null,
  "graph_x_labels": null,
  "graph_series": null,
  "graph_x_min": null,
  "graph_x_max": null,
  "graph_y_min": null,
  "graph_y_max": null,
  "url": null
}
```
`table_row_labels` is optional — use it if the rows correspond to answer options (A, B, C…).

### New schema — simple graph
Use when you can read numeric axis values off the graph:
```json
{
  "figure_type": "simple_graph",
  "caption": "Velocity vs time",
  "diagram_prompt": null,
  "table_headers": null,
  "table_rows": null,
  "table_row_labels": null,
  "graph_type": "line",
  "graph_title": "v / m s⁻¹ against t / s",
  "graph_x_label": "t / s",
  "graph_y_label": "v / m s⁻¹",
  "graph_x_labels": null,
  "graph_series": [
    { "name": "Series 1", "x_values": [0, 1, 2, 3], "y_values": [0, 5, 10, 15] }
  ],
  "graph_x_min": 0,
  "graph_x_max": 3,
  "graph_y_min": 0,
  "graph_y_max": 15,
  "url": null
}
```
`graph_type` must be one of: `"line"`, `"bar"`, `"scatter"`.

### New schema — complex diagram
Use for geometry diagrams, force diagrams, circuit schematics, pulley systems, etc. that cannot be represented as a table or simple graph:
```json
{
  "figure_type": "complex_diagram",
  "caption": "Force diagram",
  "diagram_prompt": "A block of mass m sits on a frictionless inclined plane at angle θ. Draw the weight mg vertically downward, the normal force perpendicular to the slope, and label both.",
  "table_headers": null,
  "table_rows": null,
  "table_row_labels": null,
  "graph_type": null,
  "graph_title": null,
  "graph_x_label": null,
  "graph_y_label": null,
  "graph_x_labels": null,
  "graph_series": null,
  "graph_x_min": null,
  "graph_x_max": null,
  "graph_y_min": null,
  "graph_y_max": null,
  "url": null
}
```
Write `diagram_prompt` as a precise visual description that would allow an AI image model to recreate the diagram.

---

## Hard rules

- Never solve questions.
- Never explain or summarise content.
- Never invent text that is not in the PDF.
- Preserve all LaTeX exactly as it appears — use `\\frac`, `\\sqrt`, `\\leq` etc. with double backslashes (so they survive JSON serialisation).
- Do not convert LaTeX to Unicode.
- Do not let page numbers, axis labels, or figure captions bleed into the question stem.
- If a question spans multiple pages, merge it into a single entry.
- If you are unsure of a value, set it to `null` — do not guess.
- Do not let questions without diagrams have figures entries.
- `figures: []` for any question with no figure.

---

## Full JSON schema — one question

```json
{
  "question_id": "EXAM_paperlabel_NN",
  "source": {
    "exam": "TMUA",
    "year": null,
    "paper": "Specimen Paper 1",
    "section": "A",
    "question_number": 1,
    "page": 2,
    "source_pdf": "specimen_paper_1.pdf"
  },
  "content": {
    "subject": "math",
    "topic": null,
    "subtopic": null,
    "archetype": null,
    "difficulty": 3,
    "requires_diagram": false,
    "requires_calculation": true
  },
  "prompt": {
    "stem": "Question text with $\\LaTeX$...",
    "options": [
      { "label": "A", "text": "$2x$" },
      { "label": "B", "text": "$3x$" },
      { "label": "C", "text": "$4x$" },
      { "label": "D", "text": "$5x$" },
      { "label": "E", "text": "$6x$" }
    ],
    "figures": []
  },
  "validation": {
    "answer_label": "C",
    "answer_text": null,
    "worked_solution": null,
    "status": "unverified"
  },
  "metadata": {
    "estimated_time_seconds": null,
    "tags": []
  }
}
```

### question_id format
`EXAM_paperlabel_NN` where:
- `EXAM` = exam name in uppercase (e.g. `TMUA`, `ESAT`, `NSAA`)
- `paperlabel` = short snake_case label for the paper (e.g. `spec1`, `practice2`, `2023`)
- `NN` = zero-padded question number (e.g. `01`, `12`)

Example: `TMUA_spec1_07`, `ESAT_2023_14`, `NSAA_practice2_03`

### subject values
`"math"`, `"physics"`, `"chemistry"`, `"biology"`

### section
The section letter for this question (e.g. `"A"`, `"B"`). TMUA and ESAT papers are usually all `"A"`. NSAA splits by subject section.

---

## Output format

The output must be a **single JSON object** at the top level:

```json
{
  "meta": {
    "exam": "TMUA",
    "label": "TMUA Specimen Paper 1",
    "year": null,
    "paper": "1",
    "count": 20,
    "sections": ["A"]
  },
  "paper": {
    "source": "TMUA Specimen Paper 1",
    "questions": [ ...all questions... ]
  }
}
```

Save this as e.g. `questions_spec_paper_1.json`. The user will download this file and drop it into the project.

---

## Prompt to send Claude

Replace `[PAPER TITLE]` and `[PAPER LABEL]` with the actual paper name and a short snake_case identifier:

```
You are extracting a past exam paper PDF into a structured JSON file.

Paper: [PAPER TITLE]
Label (for question IDs): [PAPER LABEL]   e.g. spec1, practice2, 2023

Instructions:
- Read the attached PDF using your vision capability.
- Extract every question into the JSON schema provided.
- Do NOT solve any question.
- Do NOT explain anything.
- Preserve all LaTeX with double backslashes (\\frac, \\sqrt, \\leq etc.).
- Images are already extracted — do not extract or embed any images.
  For questions with a real diagram/image in the PDF, reference it as:
  images_[PAPER LABEL]/qNN_description.png
- For tables and graphs that can be described structurally, use the new figure schemas.
- Set figures: [] for questions with no figure.
- Output a single downloadable JSON file matching the schema exactly.
- Do not output anything else — no explanation, no commentary.

Schema and figure type rules are above — paste this entire document into the ChatGPT conversation before sending the prompt, or attach it as a file.
```
i may attach every question of the pdf as an image to help you out

please entitle the created full json schema file you create as 

questions_2020_paper_1.json