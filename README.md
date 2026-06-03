# OxAI

OxAI generates NSAA-style multiple-choice questions using a model trained on a dataset of over **500 historical NSAA questions**.

> **Version:** v0.0.1

## Features

* Generate new NSAA-style multiple-choice questions
* Control question subject, topic, and difficulty
* Retrieve similar examples from the training dataset for style consistency
* Export questions as structured JSON
* Support for LoRA fine-tuned adapters

## Installation

```bash
pip install torch transformers peft
```

## Usage

### Web UI

Launch the UI and generate questions interactively or browse the training data.

### Command Line

Generate a question directly from the terminal:

```bash
python generate_question.py \
  --base-model Qwen/Qwen2.5-7B-Instruct \
  --subject Physics \
  --topic Mechanics \
  --difficulty 3
```

### Using a Fine-Tuned Adapter

```bash
python generate_question.py \
  --base-model Qwen/Qwen2.5-7B-Instruct \
  --adapter-dir checkpoints/lora \
  --subject Physics \
  --topic Mechanics \
  --difficulty 3
```

## Parameters

| Parameter          | Description                                    |
| ------------------ | ---------------------------------------------- |
| `--base-model`     | Base language model to use                     |
| `--adapter-dir`    | Optional LoRA adapter checkpoint               |
| `--subject`        | Subject area (e.g. Physics, Mathematics)       |
| `--topic`          | Topic within the subject                       |
| `--difficulty`     | Target difficulty level                        |
| `--examples`       | Number of retrieved examples used in prompting |
| `--out`            | Output file location                           |
| `--max-new-tokens` | Maximum generation length                      |

## Output

Generated questions are written as structured JSON containing:

* Question metadata
* Subject and topic information
* Question stem
* Answer options
* Validation fields
* Generation metadata

## Project Status

OxAI is currently an early-stage prototype and remains under active development. Generated questions should be reviewed before use in teaching, revision materials, or assessments.

