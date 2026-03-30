# TrainingGuide (RAG Visualizer)

This repository is a **RAG (retrieval-augmented generation) pipeline visualizer**: a **FastAPI** backend streams pipeline events, and a **React + Vite** frontend shows the run. Scenarios live under `scenarios/` at the repo root; the LLM and embeddings run through **Ollama** on your machine.

## What you need installed

| Tool | Notes |
|------|--------|
| **Python** | 3.11 or newer |
| **Node.js** | Current LTS is fine (for the frontend) |
| **Ollama** | Must be running locally so the backend can call chat and embedding APIs |

### Ollama models

The backend defaults (see `backend/src/infra/container.py`) expect:

- **Chat:** `gemma3:4b`
- **Embeddings:** `embeddinggemma:latest`

Install them if needed:

```bash
ollama pull gemma3:4b
ollama pull embeddinggemma:latest
```

You can use other models by setting environment variables when starting the backend (see below).

---

## 1. Backend (API)

From the **repository root**:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
```

Start the server (still from `backend/`):

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Check that it is up: open [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health) — you should see `{"status":"ok"}`.

### Backend environment variables (optional)

| Variable | Default | Purpose |
|----------|---------|---------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama HTTP API |
| `OLLAMA_CHAT_MODEL` | `gemma3:4b` | Model for generation |
| `OLLAMA_EMBED_MODEL` | `embeddinggemma:latest` | Model for embeddings |

Example:

```bash
export OLLAMA_CHAT_MODEL=mistral:latest
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

---

## 2. Frontend (UI)

From the **repository root**:

```bash
cd frontend
npm install
npm run dev
```

Vite usually serves the app at [http://localhost:5173](http://localhost:5173).

### Pointing the UI at the API

The frontend calls the API base from `VITE_API_BASE_URL`. If you omit it, it defaults to `http://localhost:8000`.

If your API runs elsewhere or on another port, create `frontend/.env.local`:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000
```

Restart `npm run dev` after changing env files.

---

## 3. Typical workflow

1. Start **Ollama** (so something is listening on port `11434`).
2. In one terminal: run the **backend** (`uvicorn` as above).
3. In another terminal: run the **frontend** (`npm run dev`).
4. Open the Vite URL in the browser and pick a scenario / run a query.

---

## Troubleshooting

- **`Connection refused` to Ollama** — Start the Ollama app or daemon, or set `OLLAMA_BASE_URL` to where Ollama actually listens.
- **Model not found** — Run `ollama pull <model>` for the chat and embedding models you configured, or align `OLLAMA_*_MODEL` with models you already have (`ollama list`).
- **Empty scenarios** — Scenarios are loaded from the `scenarios/` folder at the **repo root**. Run the backend from `backend/` as described; do not move that folder without updating the app configuration.

---

## Project layout (short)

- `backend/` — FastAPI app (`main.py` entrypoint, `src/` for domain, use cases, adapters, HTTP).
- `frontend/` — React + TypeScript + Vite.
- `scenarios/` — YAML and content files defining RAG scenarios.

For architecture conventions used in this repo, see `AGENTS.md`.
