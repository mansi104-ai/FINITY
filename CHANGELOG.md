# Changelog

All notable changes to FINITY are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [v0.7.0] — 2026-06-08

### Added
- **AI Insights page** (`/insights`) with an "Insights" nav link — new AI/analytics features built entirely separate from the protected AI Brief page.
- **Market regime classifier** — `GET /api/insights/regime` (public) reads breadth across a 20-name large-cap basket and classifies the tape as risk-on / risk-off / neutral via a composite of breadth and average move, with leaders/laggards.
- **Portfolio analysis** — `GET /api/insights/portfolio` (auth) treats watchlist items that have a buy price as positions and computes total P&L, per-holding P&L, sector diversification/allocation, concentration risk, and a deterministic plain-English narrative.
- API client types + helpers `getMarketRegime()` / `getPortfolioInsights()`; reusable server helpers `fetchQuoteForSymbol()` and exported `sectorForSymbol()`.

### Notes
- Insight generation is **deterministic and dependency-free** (no Anthropic SDK in the server; the AI Brief uses a separate Python agents service). This keeps the Vercel build lean and works without API keys. The protected `QueryPage.tsx` was not touched.

---

## [v0.6.0] — 2026-06-08

### Added
- **Price alerts** — new `/alerts` page (and "Alerts" nav link) to set "notify me when TICKER crosses above/below $X". Alerts list splits into Active and Triggered; each links to the stock detail page.
- **Alerts API** (auth-protected): `GET/POST /api/alerts`, `DELETE /api/alerts/:id`, and `POST /api/alerts/check` for on-demand evaluation. New `priceAlerts` collection + in-memory fallback, with `id` (unique) and `(userId, active)` indexes.
- **Serverless-correct alert firing** — because Vercel functions are ephemeral (`setInterval` doesn't persist), the NotificationBell's 60s poll now calls `POST /api/alerts/check` first, so alerts evaluate against live prices and fire `price_alert` notifications even on serverless. On persistent hosts a 5-minute background interval also checks all active alerts.
- **Daily digest email** — the morning digest now also sends a best-effort email per user (via `sendEmail`), and triggered price alerts email the user too.
- **Pluggable email** — `EMAIL_WEBHOOK_URL` env var. When unset, `sendEmail` logs and no-ops, so nothing hard-fails without email configured. Point it at a Resend/SendGrid proxy accepting `{ to, subject, text }`.

### Notes
- Price evaluation uses Yahoo `v7/quote` with the `query1 → query2` fallback. An alert fires once, then is marked inactive.

---

## [v0.5.0] — 2026-06-08

### Added
- **Research page** (`/research`) with two tools, plus a new "Research" nav link.
- **Sector heatmap** — tracked constituents are grouped into sectors (Technology, Communication, Consumer Cyclical/Defensive, Financials, Healthcare, Energy, Industrials, Other). Each cell shows the sector's average session move with red→green heat shading and its top gainer / top loser, each linking to the stock detail page.
- **Dividend tracker** — sortable table (by yield, today's move, or symbol) of dividend-paying tracked stocks, with yields ≥ 3% highlighted as income-grade.
- **Server endpoint** — `GET /api/market/research` reuses the existing live stock pipeline (Yahoo → Finnhub → stale cache) via a new shared `loadDetailedStocks()` helper, then derives the sector summaries and dividend list server-side.

### Changed
- `getStocksController` refactored to use the shared `loadDetailedStocks()` helper (no behavior change).

---

## [v0.4.0] — 2026-06-08

### Added
- **Advanced charting on the stock detail page** — new `AdvancedChart` component renders SVG candlesticks (OHLC) with selectable ranges (1M/3M/6M/1Y/2Y).
- **Technical indicators (all computed client-side, no extra dependencies)**:
  - **Bollinger Bands** (20-period SMA ± 2σ) and **SMA 20/50** as toggleable price overlays.
  - **RSI (14)** sub-pane with 30/70 overbought/oversold guides and live reading.
  - **MACD (12, 26, 9)** sub-pane with MACD line, signal line, and histogram.
- **Server candle endpoint** — `GET /api/market/candles/:ticker?range=` returns OHLCV from Yahoo Finance `v8/finance/chart` with the same `query1 → query2` retry fallback used elsewhere. Supported ranges: 1mo, 3mo, 6mo, 1y (daily), 2y, 5y (weekly).
- Types `Candle` / `CandlesResponse` and `getCandles()` API client helper.

### Notes
- Charting is intentionally dependency-free (hand-rolled SVG + pure indicator math) to keep the Vercel bundle small and the build fast. The advanced chart is shown for equities, not indices.

---

## [v0.3.0] — 2026-05-27

### Added
- **Live-only market data** — removed all static fallback price data. Quotes and history now always reflect live sources, never stale hardcoded numbers.
- **Finnhub integration** — `finnhub.ts` service wrapping quote, profile, metrics, company/market news, earnings calendar, IPO calendar, and analyst recommendations. Used as a live fallback when Yahoo Finance blocks Vercel's cloud IPs, and to enrich stock detail (52w range, beta, P/E, P/B, EPS, dividend yield).
- **Earnings calendar page** (`/earnings`) — upcoming and recent earnings with EPS estimate vs. actual.
- **IPO calendar** — upcoming IPOs via `GET /api/market/ipo`.
- **Analyst recommendations** — consensus buy/hold/sell breakdown on the stock detail page via `GET /api/market/recommendations/:ticker`.
- **Location-independent Finnhub fallback** — when Yahoo is blocked, the snapshot/stocks endpoints serve live US equities regardless of detected geolocation.

### Changed
- `getStockDetailController` now layers Yahoo → Finnhub quote → Finnhub metric enrichment.
- MongoDB connection failures on Vercel are handled gracefully (in-memory fallback) instead of crashing the function.

---

## [v0.2.0] — 2026-05-27

### Added
- **Watchlist → MongoDB** — watchlist data now syncs to the server (`watchlists` collection). GET/POST/DELETE/PATCH `/api/watchlist` endpoints, all auth-protected. `Watchlist.tsx` migrated from `localStorage` to the API; buy prices and ticker labels persist across devices/sessions.
- **Login and Register pages** — `/login` and `/register` with proper email+password forms. Successful auth saves the access token and redirects to watchlist. `AccountLink` in nav shows logged-in username and a logout button; guests see "Login".
- **Morning digest watchdog** — at exactly 9:00 AM in each market's local timezone (US/ET, IN/IST, GB/GMT, JP/JST, CN/CST), Mon–Fri, the server fetches current prices for each user's watchlist symbols in that market and writes a `morning_digest` notification to MongoDB. No external cron dependency — pure Node.js `setInterval` polling every 60 s.
- **In-app Notification Bell** — bell icon in nav header. Fetches unread count on mount and polls every 60 s. Click opens a dropdown showing the 20 most recent notifications with type, body (movers list), and relative timestamp. All mark as read on open.
- **Server models** — `Watchlist.model.ts`, `Notification.model.ts`
- **DB functions** — `getWatchlist`, `saveWatchlist`, `getAllWatchlists`, `getNotifications`, `getUnreadCount`, `saveNotification`, `markNotificationRead`, `markAllNotificationsRead`
- **MongoDB indexes** — `watchlists.userId` (unique), `notifications.id` (unique), `notifications.(userId, createdAt)` compound

### Changed
- `requiresAuth()` in `api.ts` now covers `/api/watchlist` and `/api/notifications`
- Nav layout updated: `findec-topnav-right` flex container groups bell + account link

---

## [v0.1.0] — 2026-05-27

### Fixed
- **Yahoo Finance API reliability** — upgraded `User-Agent` to full Chrome browser string + added `Accept` / `Accept-Language` headers across all Yahoo Finance calls (`fetchDetailedQuotesBatch`, `fetchHistory`, `fetchQuotes`). Previously the minimal `"Mozilla/5.0"` string was blocked by Yahoo from cloud IPs, causing Compare and Screener to error.
- **query2 retry fallback** — `fetchDetailedQuotesBatch` and `fetchHistory` now retry on `query2.finance.yahoo.com` when `query1` fails. This handles Yahoo's intermittent IP-based blocking.
- **Compare page ERROR state** — `getStockDetailController` now checks the MongoDB stocks cache first (before hitting Yahoo Finance), eliminating unnecessary API calls and returning data instantly for recently-loaded tickers. Previously it always called Yahoo first.
- **F and GM showing ERROR in Compare** — `F` (Ford) and `GM` (General Motors) were in the tracked US symbol list but not in the static fallback data. Added them (and GOOGL, META, JPM, BAC, GS, COIN, PLTR) to the static fallback so the final safety net is comprehensive.
- **Removed unused `env` import** in `market.controller.ts`.

### Added
- **Expanded static fallback data** — 14 US tickers (was 8) covering the full Compare preset list.

---

## [v0.0.2] — 2026-05-26

### Added
- Universal stock search (Yahoo Finance autocomplete) in Watchlist — type any company name, not just ticker symbols
- History page full redesign with `hist-*` CSS classes: stats row, filter tabs (all/buy/sell/hold), report cards with verdict/badge/meta
- Watchlist autocomplete dropdown (`wtch-dropdown`) with debounced search, outside-click dismiss, symbol + name + exchange display
- Google News RSS news source (replaces NewsAPI.org which only works on localhost)
- Screener expanded to 60+ US symbols plus IN/GB/JP/CN markets
- Compare page: 5 quick-compare presets, 30-day normalised chart, full metrics table with best-value highlighting
- Suspense boundaries on `/compare` and `/news` pages for `useSearchParams` (Next.js 14 requirement)

---

## [v0.0.1] — 2026-05-24 (initial)

### Added
- Next.js 14 client with App Router — Markets, Screener, Watchlist, AI Brief, History, Compare, News, Stock Detail pages
- Express + TypeScript backend with JWT auth (15-min access tokens, refresh token rotation with revocation)
- MongoDB Atlas hybrid storage — production MongoDB + in-memory Maps fallback for dev
- AI Brief agent (multi-step LLM pipeline: data ingestion → analysis → recommendation)
- Rate limiting: 10 queries/hour per user, 10 auth attempts/15 minutes
- Dark terminal aesthetic (`findec-*` CSS class system)
- 5-country market support: US, IN, GB, JP, CN with geolocation-based defaults
