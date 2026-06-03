#!/usr/bin/env bash


# automatically converts a sequence of NSAA pdfs into training data schema


set -euo pipefail

START_YEAR=2024
END_YEAR=2007

mkdir -p output/logs

for year in $(seq "$START_YEAR" -1 "$END_YEAR"); do
  prompt=$(cat <<EOF
Extract raw/${year}.pdf into output/questions_${year}.json.

Follow CLAUDE.md exactly.
Do not solve any questions.
Do not explain reasoning.
Preserve LaTeX exactly.
Crop all visible figures into output/images_${year}/.
Update output/manifest.json.
Return only file edits and valid JSON
EOF
)

  echo "=== Processing ${year} ==="

  while true; do
    set +e
    out=$(claude -p "$prompt" --output-format json --allowedTools "Read,Edit,Bash" 2>&1)
    code=$?
    set -e

    printf '%s\n' "$out" > "output/logs/${year}.log"

    if [ "$code" -eq 0 ]; then
      echo "Done: ${year}"
      break
    fi

    if printf '%s' "$out" | grep -qiE 'reset|session limit|weekly limit|Opus limit'; then
      echo "Rate-limited on ${year}. Waiting and retrying..."
      sleep 1800
      continue
    fi

    echo "Claude failed on ${year}"
    exit "$code"
  done
done
