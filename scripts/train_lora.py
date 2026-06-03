#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from typing import Dict, List

import torch
from datasets import load_dataset
from peft import LoraConfig, get_peft_model, TaskType
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    Trainer,
    TrainingArguments,
)


TARGET_MODULES = [
    "q_proj",
    "k_proj",
    "v_proj",
    "o_proj",
    "gate_proj",
    "up_proj",
    "down_proj",
]


def format_chat(tokenizer, messages: List[Dict[str, str]]) -> str:
    if hasattr(tokenizer, "apply_chat_template"):
        return tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False,
        )
    # Fallback if a model/tokenizer lacks chat templates
    parts = []
    for m in messages:
        parts.append(f"{m['role'].upper()}: {m['content']}")
    return "\n\n".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model", type=str, required=True)
    parser.add_argument("--train-file", type=Path, default=Path("data/training/sft_questions.jsonl"))
    parser.add_argument("--output-dir", type=Path, default=Path("checkpoints/qwen-nsaa-lora"))
    parser.add_argument("--max-length", type=int, default=4096)
    parser.add_argument("--epochs", type=float, default=3.0)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--per-device-batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=8)
    args = parser.parse_args()

    tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    use_cuda = torch.cuda.is_available()
    use_bf16 = bool(use_cuda and torch.cuda.is_bf16_supported())

    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        trust_remote_code=True,
        torch_dtype=torch.bfloat16 if use_bf16 else (torch.float16 if use_cuda else torch.float32),
    )
    model.config.use_cache = False
    model.gradient_checkpointing_enable()

    lora_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        target_modules=TARGET_MODULES,
        bias="none",
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    ds = load_dataset("json", data_files=str(args.train_file), split="train")

    def tokenize_example(example):
        text = format_chat(tokenizer, example["messages"])
        enc = tokenizer(
            text,
            truncation=True,
            max_length=args.max_length,
            padding=False,
        )
        enc["labels"] = enc["input_ids"].copy()
        return enc

    tokenized = ds.map(
        tokenize_example,
        remove_columns=ds.column_names,
        desc="Tokenizing",
    )

    def collate(features):
        max_len = max(len(f["input_ids"]) for f in features)
        pad_id = tokenizer.pad_token_id
        batch_input_ids = []
        batch_attention = []
        batch_labels = []

        for f in features:
            ids = f["input_ids"]
            attn = f["attention_mask"]
            labels = f["labels"]

            pad_len = max_len - len(ids)
            batch_input_ids.append(ids + [pad_id] * pad_len)
            batch_attention.append(attn + [0] * pad_len)
            batch_labels.append(labels + [-100] * pad_len)

        return {
            "input_ids": torch.tensor(batch_input_ids, dtype=torch.long),
            "attention_mask": torch.tensor(batch_attention, dtype=torch.long),
            "labels": torch.tensor(batch_labels, dtype=torch.long),
        }

    training_args = TrainingArguments(
        output_dir=str(args.output_dir),
        num_train_epochs=args.epochs,
        learning_rate=args.learning_rate,
        per_device_train_batch_size=args.per_device_batch_size,
        gradient_accumulation_steps=args.grad_accum,
        logging_steps=10,
        save_strategy="epoch",
        report_to="none",
        bf16=use_bf16,
        fp16=bool(use_cuda and not use_bf16),
        remove_unused_columns=False,
        optim="adamw_torch",
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        save_total_limit=2,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized,
        data_collator=collate,
    )

    trainer.train()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    trainer.model.save_pretrained(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)

    print(f"Saved adapter/checkpoint to {args.output_dir}")


if __name__ == "__main__":
    main()