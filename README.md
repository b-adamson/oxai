# OxAI

Generate NSAA-style multiple-choice questions using a model trained on 500+ historical NSAA questions.

> Version: v0.0.1

## Run

### Backend

Start the API:

```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8000
```

### Frontend

Install frontend dependencies:

```bash
cd frontend
npm install
```

Start the frontend:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Features

* Generate NSAA-style multiple-choice questions
* Select subject, topic, and difficulty
* Retrieve similar training examples
* Export questions as JSON
* LoRA adapter support
