Backend:
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
PYTHONPATH=. uvicorn main:app --reload --port 8000

Frontend:
cd frontend
npm install
npm run dev