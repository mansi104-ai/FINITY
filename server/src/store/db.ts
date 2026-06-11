import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { env } from "../config";
import type { AgentReport } from "../models/Report.model";
import type { AuthSessionRecord } from "../models/AuthSession.model";
import type { QueryRecord } from "../models/Query.model";
import type { RevokedRefreshTokenRecord } from "../models/RevokedRefreshToken.model";
import type { UserRecord } from "../models/User.model";
import type { WatchlistRecord } from "../models/Watchlist.model";
import type { NotificationRecord } from "../models/Notification.model";
import type { PriceAlertRecord } from "../models/PriceAlert.model";
import type { PaperAccountRecord } from "../models/PaperAccount.model";
import type { LedgerRecord } from "../models/Ledger.model";
import type { StockQuoteResponse } from "../controllers/market.controller";

// ─── In-memory fallback (local dev when DATABASE_URL is unset) ─────────────────
const memoryUsers = new Map<string, UserRecord>();
const memoryReports = new Map<string, AgentReport>();
const memoryQueries = new Map<string, QueryRecord>();
const memoryAuthSessions = new Map<string, AuthSessionRecord>();
const memoryRevokedRefreshTokens = new Map<string, RevokedRefreshTokenRecord>();
const memoryWatchlists = new Map<string, WatchlistRecord>();
const memoryNotifications = new Map<string, NotificationRecord>();
const memoryPriceAlerts = new Map<string, PriceAlertRecord>();
const memoryPaperAccounts = new Map<string, PaperAccountRecord>();
const memoryLedgers = new Map<string, LedgerRecord>();
const memoryStocksCache = new Map<string, { stocks: StockQuoteResponse[]; indices: StockQuoteResponse[]; cachedAt: string }>();
const memorySnapshotCache = new Map<string, { tickers: unknown[]; cachedAt: string }>();
const memoryQuoteCache = new Map<string, { data: StockQuoteResponse; cachedAt: string }>();
const memoryWaitlist = new Map<string, { email: string; plan: string; createdAt: string; meta?: unknown }>();

// ─── Neon Postgres (serverless) ────────────────────────────────────────────────
type Sql = NeonQueryFunction<false, false>;
const sql: Sql | null = env.databaseUrl ? neon(env.databaseUrl) : null;
let schemaPromise: Promise<void> | null = null;

async function ensureSchema(client: Sql): Promise<void> {
  await client`CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email text UNIQUE NOT NULL, data jsonb NOT NULL)`;
  await client`CREATE TABLE IF NOT EXISTS auth_sessions (id text PRIMARY KEY, user_id text NOT NULL, data jsonb NOT NULL)`;
  await client`CREATE TABLE IF NOT EXISTS queries (id text PRIMARY KEY, data jsonb NOT NULL)`;
  await client`CREATE TABLE IF NOT EXISTS reports (id text PRIMARY KEY, user_id text, public_slug text, created_at timestamptz, data jsonb NOT NULL)`;
  await client`CREATE TABLE IF NOT EXISTS revoked_refresh_tokens (token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL, data jsonb NOT NULL)`;
  await client`CREATE TABLE IF NOT EXISTS watchlists (user_id text PRIMARY KEY, data jsonb NOT NULL)`;
  await client`CREATE TABLE IF NOT EXISTS notifications (id text PRIMARY KEY, user_id text, read boolean, created_at timestamptz, data jsonb NOT NULL)`;
  await client`CREATE TABLE IF NOT EXISTS price_alerts (id text PRIMARY KEY, user_id text, active boolean, created_at timestamptz, data jsonb NOT NULL)`;
  await client`CREATE TABLE IF NOT EXISTS paper_accounts (user_id text PRIMARY KEY, data jsonb NOT NULL)`;
  await client`CREATE TABLE IF NOT EXISTS ledgers (user_id text PRIMARY KEY, data jsonb NOT NULL)`;
  await client`CREATE TABLE IF NOT EXISTS stocks_cache (country_code text PRIMARY KEY, stocks jsonb NOT NULL, indices jsonb NOT NULL, cached_at timestamptz NOT NULL)`;
  await client`CREATE TABLE IF NOT EXISTS snapshot_cache (country_code text PRIMARY KEY, tickers jsonb NOT NULL, cached_at timestamptz NOT NULL)`;
  await client`CREATE TABLE IF NOT EXISTS quotes_cache (symbol text PRIMARY KEY, data jsonb NOT NULL, cached_at timestamptz NOT NULL)`;
  await client`CREATE TABLE IF NOT EXISTS waitlist (email text PRIMARY KEY, plan text, created_at timestamptz NOT NULL, data jsonb NOT NULL)`;
  await client`CREATE INDEX IF NOT EXISTS idx_reports_user ON reports (user_id, created_at DESC)`;
  await client`CREATE INDEX IF NOT EXISTS idx_reports_slug ON reports (public_slug)`;
  await client`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC)`;
  await client`CREATE INDEX IF NOT EXISTS idx_alerts_user_active ON price_alerts (user_id, active)`;
}

// Returns the SQL client once the schema is ready, or null when running in-memory.
async function db(): Promise<Sql | null> {
  if (!sql) return null;
  if (!schemaPromise) {
    schemaPromise = ensureSchema(sql).catch((err) => {
      console.error("[db] schema init failed:", err instanceof Error ? err.message : err);
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
  return sql;
}

const J = (v: unknown) => JSON.stringify(v);

// True when a real persistent database is configured (used to gate auth in prod).
export function isPersistenceReady(): boolean {
  return Boolean(sql);
}

// ─── Users ─────────────────────────────────────────────────────────────────────
export async function getUserById(userId: string): Promise<UserRecord | undefined> {
  const q = await db();
  if (!q) return memoryUsers.get(userId);
  const rows = await q`SELECT data FROM users WHERE id = ${userId}`;
  return rows[0]?.data as UserRecord | undefined;
}

export async function findUserByEmail(email: string): Promise<UserRecord | undefined> {
  const normalizedEmail = email.toLowerCase();
  const q = await db();
  if (!q) return Array.from(memoryUsers.values()).find((u) => u.email === normalizedEmail);
  const rows = await q`SELECT data FROM users WHERE email = ${normalizedEmail}`;
  return rows[0]?.data as UserRecord | undefined;
}

export async function saveUser(user: UserRecord): Promise<void> {
  const q = await db();
  if (!q) { memoryUsers.set(user.id, user); return; }
  await q`INSERT INTO users (id, email, data) VALUES (${user.id}, ${user.email.toLowerCase()}, ${J(user)}::jsonb)
          ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, data = EXCLUDED.data`;
}

// ─── Auth sessions ───────────────────────────────────────────────────────────
export async function getSessionById(sessionId: string): Promise<AuthSessionRecord | undefined> {
  const q = await db();
  if (!q) return memoryAuthSessions.get(sessionId);
  const rows = await q`SELECT data FROM auth_sessions WHERE id = ${sessionId}`;
  return rows[0]?.data as AuthSessionRecord | undefined;
}

export async function saveSession(session: AuthSessionRecord): Promise<void> {
  const q = await db();
  if (!q) { memoryAuthSessions.set(session.id, session); return; }
  await q`INSERT INTO auth_sessions (id, user_id, data) VALUES (${session.id}, ${session.userId}, ${J(session)}::jsonb)
          ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, data = EXCLUDED.data`;
}

export async function revokeSession(sessionId: string): Promise<void> {
  const existing = await getSessionById(sessionId);
  if (!existing || existing.revokedAt) return;
  await saveSession({ ...existing, revokedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  const q = await db();
  if (!q) {
    for (const session of memoryAuthSessions.values()) {
      if (session.userId === userId && !session.revokedAt) {
        memoryAuthSessions.set(session.id, { ...session, revokedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
    }
    return;
  }
  const rows = await q`SELECT data FROM auth_sessions WHERE user_id = ${userId}`;
  const now = new Date().toISOString();
  for (const row of rows) {
    const s = row.data as AuthSessionRecord;
    if (!s.revokedAt) await saveSession({ ...s, revokedAt: now, updatedAt: now });
  }
}

// ─── Queries ───────────────────────────────────────────────────────────────────
export async function saveQuery(query: QueryRecord): Promise<void> {
  const q = await db();
  if (!q) { memoryQueries.set(query.id, query); return; }
  await q`INSERT INTO queries (id, data) VALUES (${query.id}, ${J(query)}::jsonb)
          ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`;
}

// ─── Reports ─────────────────────────────────────────────────────────────────
export async function saveReport(report: AgentReport): Promise<void> {
  const q = await db();
  if (!q) { memoryReports.set(report.id, report); return; }
  const slug = (report as AgentReport & { publicSlug?: string }).publicSlug ?? null;
  await q`INSERT INTO reports (id, user_id, public_slug, created_at, data)
          VALUES (${report.id}, ${report.userId}, ${slug}, ${report.createdAt}, ${J(report)}::jsonb)
          ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, public_slug = EXCLUDED.public_slug,
            created_at = EXCLUDED.created_at, data = EXCLUDED.data`;
}

export async function getReportById(reportId: string): Promise<AgentReport | undefined> {
  const q = await db();
  if (!q) return memoryReports.get(reportId);
  const rows = await q`SELECT data FROM reports WHERE id = ${reportId}`;
  return rows[0]?.data as AgentReport | undefined;
}

export async function listReportsByUser(userId: string): Promise<AgentReport[]> {
  const q = await db();
  if (!q) {
    return Array.from(memoryReports.values())
      .filter((r) => r.userId === userId)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  const rows = await q`SELECT data FROM reports WHERE user_id = ${userId} ORDER BY created_at DESC`;
  return rows.map((r) => r.data as AgentReport);
}

export async function getReportByPublicSlug(slug: string): Promise<AgentReport | undefined> {
  const q = await db();
  if (!q) {
    return Array.from(memoryReports.values()).find((r) => (r as AgentReport & { publicSlug?: string }).publicSlug === slug);
  }
  const rows = await q`SELECT data FROM reports WHERE public_slug = ${slug} LIMIT 1`;
  return rows[0]?.data as AgentReport | undefined;
}

// ─── Revoked refresh tokens ────────────────────────────────────────────────────
export async function revokeRefreshToken(record: RevokedRefreshTokenRecord): Promise<void> {
  const q = await db();
  if (!q) { memoryRevokedRefreshTokens.set(record.tokenHash, record); return; }
  await q`INSERT INTO revoked_refresh_tokens (token_hash, expires_at, data)
          VALUES (${record.tokenHash}, ${record.expiresAt}, ${J(record)}::jsonb)
          ON CONFLICT (token_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at, data = EXCLUDED.data`;
}

export async function isRefreshTokenRevoked(tokenHash: string): Promise<boolean> {
  const q = await db();
  if (!q) {
    const record = memoryRevokedRefreshTokens.get(tokenHash);
    if (!record) return false;
    if (+new Date(record.expiresAt) <= Date.now()) { memoryRevokedRefreshTokens.delete(tokenHash); return false; }
    return true;
  }
  const rows = await q`SELECT 1 FROM revoked_refresh_tokens WHERE token_hash = ${tokenHash} AND expires_at > now()`;
  return rows.length > 0;
}

// ─── Watchlist ───────────────────────────────────────────────────────────────
export async function getWatchlist(userId: string): Promise<WatchlistRecord | null> {
  const q = await db();
  if (!q) return memoryWatchlists.get(userId) ?? null;
  const rows = await q`SELECT data FROM watchlists WHERE user_id = ${userId}`;
  return (rows[0]?.data as WatchlistRecord | undefined) ?? null;
}

export async function saveWatchlist(record: WatchlistRecord): Promise<void> {
  const q = await db();
  if (!q) { memoryWatchlists.set(record.userId, record); return; }
  await q`INSERT INTO watchlists (user_id, data) VALUES (${record.userId}, ${J(record)}::jsonb)
          ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data`;
}

export async function getAllWatchlists(): Promise<WatchlistRecord[]> {
  const q = await db();
  if (!q) return Array.from(memoryWatchlists.values());
  const rows = await q`SELECT data FROM watchlists`;
  return rows.map((r) => r.data as WatchlistRecord);
}

// ─── Notifications ───────────────────────────────────────────────────────────
export async function getNotifications(userId: string, limit = 20): Promise<NotificationRecord[]> {
  const q = await db();
  if (!q) {
    return Array.from(memoryNotifications.values())
      .filter((n) => n.userId === userId)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, limit);
  }
  const rows = await q`SELECT data FROM notifications WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map((r) => r.data as NotificationRecord);
}

export async function getUnreadCount(userId: string): Promise<number> {
  const q = await db();
  if (!q) return Array.from(memoryNotifications.values()).filter((n) => n.userId === userId && !n.read).length;
  const rows = await q`SELECT count(*)::int AS c FROM notifications WHERE user_id = ${userId} AND read = false`;
  return Number(rows[0]?.c ?? 0);
}

export async function saveNotification(notification: NotificationRecord): Promise<void> {
  const q = await db();
  if (!q) { memoryNotifications.set(notification.id, notification); return; }
  await q`INSERT INTO notifications (id, user_id, read, created_at, data)
          VALUES (${notification.id}, ${notification.userId}, ${notification.read}, ${notification.createdAt}, ${J(notification)}::jsonb)
          ON CONFLICT (id) DO UPDATE SET read = EXCLUDED.read, data = EXCLUDED.data`;
}

export async function markNotificationRead(id: string, userId: string): Promise<void> {
  const q = await db();
  if (!q) {
    const n = memoryNotifications.get(id);
    if (n && n.userId === userId) memoryNotifications.set(id, { ...n, read: true });
    return;
  }
  await q`UPDATE notifications SET read = true, data = jsonb_set(data, '{read}', 'true'::jsonb)
          WHERE id = ${id} AND user_id = ${userId}`;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const q = await db();
  if (!q) {
    for (const [k, n] of memoryNotifications.entries()) {
      if (n.userId === userId) memoryNotifications.set(k, { ...n, read: true });
    }
    return;
  }
  await q`UPDATE notifications SET read = true, data = jsonb_set(data, '{read}', 'true'::jsonb)
          WHERE user_id = ${userId} AND read = false`;
}

// ─── Price alerts ───────────────────────────────────────────────────────────
export async function getPriceAlertsForUser(userId: string): Promise<PriceAlertRecord[]> {
  const q = await db();
  if (!q) {
    return Array.from(memoryPriceAlerts.values())
      .filter((a) => a.userId === userId)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  const rows = await q`SELECT data FROM price_alerts WHERE user_id = ${userId} ORDER BY created_at DESC`;
  return rows.map((r) => r.data as PriceAlertRecord);
}

export async function getActivePriceAlerts(): Promise<PriceAlertRecord[]> {
  const q = await db();
  if (!q) return Array.from(memoryPriceAlerts.values()).filter((a) => a.active);
  const rows = await q`SELECT data FROM price_alerts WHERE active = true`;
  return rows.map((r) => r.data as PriceAlertRecord);
}

export async function getActivePriceAlertsForUser(userId: string): Promise<PriceAlertRecord[]> {
  const q = await db();
  if (!q) return Array.from(memoryPriceAlerts.values()).filter((a) => a.active && a.userId === userId);
  const rows = await q`SELECT data FROM price_alerts WHERE user_id = ${userId} AND active = true`;
  return rows.map((r) => r.data as PriceAlertRecord);
}

export async function savePriceAlert(alert: PriceAlertRecord): Promise<void> {
  const q = await db();
  if (!q) { memoryPriceAlerts.set(alert.id, alert); return; }
  await q`INSERT INTO price_alerts (id, user_id, active, created_at, data)
          VALUES (${alert.id}, ${alert.userId}, ${alert.active}, ${alert.createdAt}, ${J(alert)}::jsonb)
          ON CONFLICT (id) DO UPDATE SET active = EXCLUDED.active, data = EXCLUDED.data`;
}

export async function deletePriceAlert(id: string, userId: string): Promise<void> {
  const q = await db();
  if (!q) {
    const a = memoryPriceAlerts.get(id);
    if (a && a.userId === userId) memoryPriceAlerts.delete(id);
    return;
  }
  await q`DELETE FROM price_alerts WHERE id = ${id} AND user_id = ${userId}`;
}

// ─── Paper trading accounts ─────────────────────────────────────────────────
export async function getPaperAccount(userId: string): Promise<PaperAccountRecord | null> {
  const q = await db();
  if (!q) return memoryPaperAccounts.get(userId) ?? null;
  const rows = await q`SELECT data FROM paper_accounts WHERE user_id = ${userId}`;
  return (rows[0]?.data as PaperAccountRecord | undefined) ?? null;
}

export async function savePaperAccount(account: PaperAccountRecord): Promise<void> {
  const q = await db();
  if (!q) { memoryPaperAccounts.set(account.userId, account); return; }
  await q`INSERT INTO paper_accounts (user_id, data) VALUES (${account.userId}, ${J(account)}::jsonb)
          ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data`;
}

// ─── Ledger (income / savings / expenses) ──────────────────────────────────────
export async function getLedger(userId: string): Promise<LedgerRecord | null> {
  const q = await db();
  if (!q) return memoryLedgers.get(userId) ?? null;
  const rows = await q`SELECT data FROM ledgers WHERE user_id = ${userId}`;
  return (rows[0]?.data as LedgerRecord | undefined) ?? null;
}

export async function saveLedger(record: LedgerRecord): Promise<void> {
  const q = await db();
  if (!q) { memoryLedgers.set(record.userId, record); return; }
  await q`INSERT INTO ledgers (user_id, data) VALUES (${record.userId}, ${J(record)}::jsonb)
          ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data`;
}

// ─── Market caches (stocks + snapshot) ─────────────────────────────────────────
export async function readStocksCache(countryCode: string): Promise<{ stocks: StockQuoteResponse[]; indices: StockQuoteResponse[]; cachedAt: string } | null> {
  const q = await db();
  if (!q) return memoryStocksCache.get(countryCode) ?? null;
  const rows = await q`SELECT stocks, indices, cached_at FROM stocks_cache WHERE country_code = ${countryCode}`;
  if (!rows[0]) return null;
  return { stocks: rows[0].stocks as StockQuoteResponse[], indices: rows[0].indices as StockQuoteResponse[], cachedAt: new Date(rows[0].cached_at as string).toISOString() };
}

export async function writeStocksCache(countryCode: string, stocks: StockQuoteResponse[], indices: StockQuoteResponse[]): Promise<void> {
  const cachedAt = new Date().toISOString();
  const q = await db();
  if (!q) { memoryStocksCache.set(countryCode, { stocks, indices, cachedAt }); return; }
  await q`INSERT INTO stocks_cache (country_code, stocks, indices, cached_at)
          VALUES (${countryCode}, ${J(stocks)}::jsonb, ${J(indices)}::jsonb, ${cachedAt})
          ON CONFLICT (country_code) DO UPDATE SET stocks = EXCLUDED.stocks, indices = EXCLUDED.indices, cached_at = EXCLUDED.cached_at`;
}

export async function readSnapshotCache(countryCode: string): Promise<{ tickers: unknown[]; cachedAt: string } | null> {
  const q = await db();
  if (!q) return memorySnapshotCache.get(countryCode) ?? null;
  const rows = await q`SELECT tickers, cached_at FROM snapshot_cache WHERE country_code = ${countryCode}`;
  if (!rows[0]) return null;
  return { tickers: rows[0].tickers as unknown[], cachedAt: new Date(rows[0].cached_at as string).toISOString() };
}

export async function readQuoteCache(symbol: string): Promise<{ data: StockQuoteResponse; cachedAt: string } | null> {
  const q = await db();
  if (!q) return memoryQuoteCache.get(symbol) ?? null;
  const rows = await q`SELECT data, cached_at FROM quotes_cache WHERE symbol = ${symbol}`;
  if (!rows[0]) return null;
  return { data: rows[0].data as StockQuoteResponse, cachedAt: new Date(rows[0].cached_at as string).toISOString() };
}

export async function writeQuoteCache(symbol: string, data: StockQuoteResponse): Promise<void> {
  const cachedAt = new Date().toISOString();
  const q = await db();
  if (!q) { memoryQuoteCache.set(symbol, { data, cachedAt }); return; }
  await q`INSERT INTO quotes_cache (symbol, data, cached_at) VALUES (${symbol}, ${J(data)}::jsonb, ${cachedAt})
          ON CONFLICT (symbol) DO UPDATE SET data = EXCLUDED.data, cached_at = EXCLUDED.cached_at`;
}

export async function writeSnapshotCache(countryCode: string, tickers: unknown[]): Promise<void> {
  const cachedAt = new Date().toISOString();
  const q = await db();
  if (!q) { memorySnapshotCache.set(countryCode, { tickers, cachedAt }); return; }
  await q`INSERT INTO snapshot_cache (country_code, tickers, cached_at)
          VALUES (${countryCode}, ${J(tickers)}::jsonb, ${cachedAt})
          ON CONFLICT (country_code) DO UPDATE SET tickers = EXCLUDED.tickers, cached_at = EXCLUDED.cached_at`;
}

// ─── Pro waitlist (monetization intent capture) ───────────────────────────────
export async function saveWaitlistEntry(email: string, plan: string, meta?: unknown): Promise<{ alreadyOn: boolean }> {
  const normalized = email.trim().toLowerCase();
  const createdAt = new Date().toISOString();
  const q = await db();
  if (!q) {
    const exists = memoryWaitlist.has(normalized);
    memoryWaitlist.set(normalized, { email: normalized, plan, createdAt, meta });
    return { alreadyOn: exists };
  }
  const rows = await q`INSERT INTO waitlist (email, plan, created_at, data)
          VALUES (${normalized}, ${plan}, ${createdAt}, ${J({ email: normalized, plan, meta, createdAt })}::jsonb)
          ON CONFLICT (email) DO NOTHING
          RETURNING email`;
  return { alreadyOn: rows.length === 0 };
}

export async function countWaitlistEntries(): Promise<number> {
  const q = await db();
  if (!q) return memoryWaitlist.size;
  const rows = await q`SELECT COUNT(*)::int AS n FROM waitlist`;
  return Number((rows[0] as { n?: number })?.n ?? 0);
}
