# FINDEC

Current workspace milestone: `v0.0.2`

Multi-Agent Finance Orchestrator with:
- Next.js + TypeScript frontend
- Node.js + Express + TypeScript backend
- Python FastAPI multi-agent ML service

## Versioned Build Roadmap

### v0.0.2 UI Direction

- New workspace home focused on "Conversational Dashboarding"
- Split-pane architecture with a contextual AI copilot sidebar
- Dark pro palette for a more terminal-like investing workspace
- Visual-first morning dashboard to reduce metric overload

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
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/logout-all`
- `GET /api/profile`
- `PATCH /api/profile`
- `POST /api/query`
- `GET /api/reports`
- `GET /api/reports/:id`

### Python
- `POST /run`
- `GET /health`

## Notes

- Backend auth, users, reports, and queries can persist in MongoDB when `MONGODB_URI` is set; otherwise the server falls back to in-memory storage for rapid prototyping.
- Auth uses short-lived access tokens + refresh token rotation with per-session revocation.
- News and market calls gracefully fall back to synthetic/local logic when external APIs are unavailable.
- Set `USE_LIVE_MARKET_DATA=true` for live yfinance pulls.
- `risk_profile` supports `low | medium | high`.

