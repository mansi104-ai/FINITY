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

`POST /api/query` is rate-limited to 10 requests per hour per authenticated user.

Access tokens expire after 15 minutes. Refresh tokens are rotated on every `POST /api/auth/refresh` call, and reused or revoked refresh tokens are rejected.

### Python
- `POST /run`
- `GET /health`

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `MONGODB_URI` | MongoDB connection string | — |
| `JWT_SECRET` | Secret for access tokens (15min TTL) | — |
| `JWT_REFRESH_SECRET` | Secret for refresh tokens | — |
| `NEWS_API_KEY` | NewsAPI key (falls back to synthetic) | — |
| `USE_LIVE_MARKET_DATA` | Enable live yfinance pulls | `false` |

## Rate Limits

`POST /api/query`: 10 requests per hour per authenticated user (sliding window).

## Disclaimer

FINDEC is a decision support tool only and does not constitute financial advice.

## Notes

- Start MongoDB locally or with Docker before running the backend, and set `MONGODB_URI` in your environment.
- `docker compose up --build` now includes a `mongo:7` service with a named `mongo-data` volume.
- Auth uses 15-minute access tokens plus refresh-token rotation with per-session revocation.
- News and market calls gracefully fall back to synthetic/local logic when external APIs are unavailable.
- `risk_profile` supports `low | medium | high`.

