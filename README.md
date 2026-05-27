# FINITY

A financial decision platform — real-time market data, AI-powered stock briefs, screener, watchlist, compare, and more.

**Current version: v0.1.0**

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser (Next.js 14)              │
│  Markets · Screener · Watchlist · Compare · Brief    │
│  History · News · Stock Detail · Portfolio           │
└────────────────────┬────────────────────────────────┘
                     │ HTTPS REST
┌────────────────────▼────────────────────────────────┐
│              Express + TypeScript Server             │
│  /api/market   /api/auth   /api/brief   /api/query   │
│                                                      │
│  ┌──────────────┐   ┌────────────────────────────┐   │
│  │ Yahoo Finance│   │   Google News RSS          │   │
│  │ v7/v8 quote  │   │   (no API key needed)      │   │
│  │ + autocomplete│  └────────────────────────────┘   │
│  └──────────────┘                                    │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │   MongoDB Atlas                               │   │
│  │   users · authSessions · queries · reports   │   │
│  │   revokedRefreshTokens · stocks_cache (30m)  │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites
- Node.js 20+
- MongoDB Atlas URI (optional — omit for in-memory dev fallback)
- Anthropic API key (for AI Brief)

### Server

```bash
cd server
cp .env.example .env   # fill MONGODB_URI, ANTHROPIC_API_KEY, JWT_SECRET, JWT_REFRESH_SECRET
npm install
npm run dev            # tsx watch — hot reload on port 3001
```

### Client

```bash
cd client
cp .env.example .env.local   # set NEXT_PUBLIC_API_URL=http://localhost:3001
npm install
npm run dev                  # Next.js dev on port 3000
```

---

## Environment Variables

### Server (`server/.env`)

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default 3001) |
| `MONGODB_URI` | No | MongoDB Atlas connection string. Omit for in-memory dev mode. |
| `MONGODB_DB_NAME` | No | Database name (default `findec`) |
| `JWT_SECRET` | Yes | Secret for signing access tokens (15 min TTL) |
| `JWT_REFRESH_SECRET` | Yes | Secret for signing refresh tokens |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for AI Brief |
| `CLIENT_ORIGIN` | No | CORS allowed origin (default `http://localhost:3000`) |

### Client (`client/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | Backend URL e.g. `http://localhost:3001` |

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/market/snapshot` | No | Market overview + geo-detected market status |
| GET | `/api/market/stocks` | No | Full stock list with fundamentals (MongoDB cache, 30 min TTL) |
| GET | `/api/market/stock/:ticker` | No | Single stock quote + fundamentals |
| GET | `/api/market/history/:ticker` | No | 30-day price history |
| GET | `/api/market/news?ticker=` | No | News articles via Google News RSS |
| GET | `/api/market/search?q=` | No | Ticker/company name autocomplete (Yahoo Finance) |
| POST | `/api/auth/register` | No | Create account |
| POST | `/api/auth/login` | No | Login, returns access + refresh tokens |
| POST | `/api/auth/refresh` | No | Rotate refresh token |
| POST | `/api/auth/logout` | Yes | Revoke current session |
| GET | `/api/profile` | Yes | Get user profile |
| PATCH | `/api/profile` | Yes | Update user profile |
| POST | `/api/query` | Yes | Run AI Brief (rate-limited: 10/hr) |
| GET | `/api/query/history` | Yes | List past queries |
| GET | `/api/report/:id` | Yes | Get full AI report |

---

## Auth

- Access tokens: 15-minute TTL (JWT, HS256)
- Refresh tokens: rotated on every `/api/auth/refresh` call
- Revoked refresh tokens stored in MongoDB with TTL index
- Rate limits: 10 queries/hour per user; 10 auth attempts/15 minutes per IP

---

## Roadmap

| Version | Focus | Status |
|---|---|---|
| v0.1 | Yahoo Finance reliability (headers, query2 retry, cache-first detail) | **Done** |
| v0.2 | Real auth UX (/login, /register), watchlist → MongoDB | Planned |
| v0.3 | Portfolio management (positions, transactions, P&L) | Planned |
| v0.4 | Advanced charting (candlesticks, RSI, MACD, Bollinger Bands) | Planned |
| v0.5 | Research tools (earnings calendar, dividend tracker, sector heatmap) | Planned |
| v0.6 | Alerts & notifications (price alerts, daily digest email) | Planned |
| v0.7 | AI v2 (portfolio analysis, social sentiment, market regime) | Planned |
| v0.8 | Sharing (public report URLs, PDF export, paper trading) | Planned |
| v0.9 | Security hardening (Google OAuth, 2FA TOTP, Redis cache) | Planned |
| v1.0 | Production launch (mobile polish, Sentry, OpenAPI docs) | Planned |

See [CHANGELOG.md](./CHANGELOG.md) for full release notes.

---

## Disclaimer

FINITY is a decision support tool only and does not constitute financial advice.
