# FINITY

Multi-Agent Finance Orchestrator with:
- Next.js + TypeScript frontend
- Node.js + Express + TypeScript backend
- Python FastAPI multi-agent ML service

## Versioned Build Roadmap

1. Version 1: Frontend + Agent 1 (Researcher sentiment)
2. Version 2: Add Agent 2 (Analyst prediction)
3. Version 3: Add backend orchestration and storage APIs
4. Version 4: Full pipeline (Researcher + Analyst + Risk Manager)

The `version` field sent in `/api/query` selects staged behavior (`1..4`).

## Project Structure

- `client/`: Next.js app (App Router, TypeScript)
- `server/`: Express API (TypeScript)
- `python_agents/`: FastAPI multi-agent service

## Quick Start (Local)

### 1) Python agents
```bash
cd python_agents
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 2) Backend
```bash
cd server
npm install
npm run dev
```

### 3) Frontend
```bash
cd client
npm install
npm run dev
```

Open `http://localhost:3000`.

## Quick Start (Docker)

```bash
docker compose up --build
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000/api/health`
- Python service: `http://localhost:8000/health`

## Core APIs

### Backend
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/profile`
- `PATCH /api/profile`
- `POST /api/query`
- `GET /api/reports`
- `GET /api/reports/:id`

### Python
- `POST /run`
- `GET /health`

## Notes

- This implementation uses in-memory backend storage for rapid prototyping.
- News and market calls gracefully fall back to synthetic/local logic when external APIs are unavailable.
- Set `USE_LIVE_MARKET_DATA=true` for live yfinance pulls.
- Set `ENABLE_GOV_POLICY_SEARCH=true` to include U.S. government regulation/tariff scan (Federal Register).
- Set `POLICY_BASELINE_SCAN=true` to run a default policy scan even when query is not explicitly policy-focused.
- `risk_profile` supports `low | medium | high`.

