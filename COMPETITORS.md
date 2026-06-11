# Findec — Competitive Analysis & Value Proposition

_India-first AI stock decision app. Benchmarked against the leading Indian retail research apps (June 2026)._

## 1. Competitor feature map

| Feature | Tickertape | Trendlyne | Screener.in | Groww | MoneyControl | **Findec** |
|---|---|---|---|---|---|---|
| Live India + global quotes | ✅ | ✅ | ✅ (India) | ✅ | ✅ | ✅ |
| Fundamentals (P/E, cap, EPS, div) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (US live; India via provider) |
| Screener w/ filters | ✅ 200+ | ✅ 1,400+ | ✅ custom | ✅ basic | ➖ | ✅ (core set) |
| **Stock score (0–100)** | ✅ Scorecard | ✅ DVM | ➖ | ➖ | ➖ | ✅ **Findec Scorecard** |
| **Market mood / fear-greed** | ✅ MMI | ➖ | ➖ | ➖ | ➖ | ◑ Market Regime (→ upgrading to gauge) |
| Sector heatmap | ✅ | ✅ | ➖ | ➖ | ✅ | ✅ |
| Dividend tracker | ✅ | ✅ | ✅ | ➖ | ➖ | ✅ |
| Price alerts | ✅ | ✅ realtime | ➖ | ✅ | ✅ | ✅ (once/daily) |
| Watchlist | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Earnings / event calendar | ✅ | ✅ | ✅ | ➖ | ✅ | ◑ (needs paid data tier) |
| Paper trading | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ |
| Broker portfolio import | ✅ | ✅ 16+ | ➖ | ✅ (own) | ✅ | ➖ (future) |
| Backtesting | ➖ | ✅ | ➖ | ➖ | ➖ | ➖ (future) |
| **Conversational AI brief per stock** | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ **unique** |
| **AI grades its own past calls** | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ **unique (AI Track Record)** |
| **AI natural-language screener** | ➖ | ✅ (premium, 2026) | ➖ | ➖ | ➖ | ◑ planned |
| 2FA / security | ➖ | ➖ | ➖ | ✅ | ✅ | ✅ TOTP |

✅ = yes · ◑ = partial/in progress · ➖ = no. Sources: strike.money reviews, tickertape.in, trendlyne.com, winvesta 2026 guide.

## 2. How Findec is better (today)

1. **AI Brief** — a researcher/analyst/risk-manager verdict in plain English per stock. No Indian competitor offers conversational AI verdicts; they give raw data/scores.
2. **AI Track Record** — Findec scores *its own* past buy/sell/hold calls against what the stock actually did (hit-rate, "called at → now"). No competitor holds itself accountable like this — a powerful trust/retention hook.
3. **Free paper trading** — none of Tickertape/Trendlyne/Screener/MoneyControl bundle a simulator.
4. **One free app spanning India + global** with AI, screener, alerts, and decision support — competitors split this across tiers/apps.

## 3. Value props (the pitch)

> **"The only India stock app where AI gives you a verdict, grades its own track record, and you can practise the trade for free."**

- For **beginners**: an AI second opinion + paper trading to learn risk-free.
- For **active investors**: scorecard + screener + alerts + AI compare, free.
- **Trust**: transparent track record + "decision support, not advice" disclaimers.

## 4. The 3 net-new features that put us ahead (build queue)

1. **AI Natural-Language Screener** — "show me profitable midcap IT stocks under P/E 20" → AI builds the filter. Only Trendlyne *premium* has this; we make it free. _(planned)_
2. **AI Compare Verdict** — head-to-head AI call between 2–3 stocks (we have Compare + AI; competitors only show side-by-side data). _(planned)_
3. **AI Track Record** — already shipped; keep as a flagship differentiator. ✅

## 5. MVP gaps to close (parity)

- **Findec Scorecard** (0–100) — ✅ shipped (matches Tickertape Scorecard / Trendlyne DVM).
- **Fear & Greed gauge** — upgrade the Market Regime into an MMI-style 0–100 gauge.
- **India fundamentals + earnings calendar** — needs a data tier that covers NSE (FMP free does **not**; evaluate paid FMP / a NSE source).
- **Professional UI** — design-system polish pass.

## 6. Future versions (post-MVP)

Broker portfolio import (Zerodha/Groww/Upstox), backtesting, superstar-investor tracking, mutual funds/SIP, mobile PWA, push notifications, AI portfolio rebalancing.

## 7. Data authenticity

Verified live: Findec `RELIANCE.NS` = ₹1263 vs raw Yahoo chart ₹1263.0 (exact). Prices are genuine. US fundamentals from Finnhub match. Earnings calendar requires a paid data tier.
