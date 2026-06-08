import { MongoClient, type Db } from "mongodb";
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

const memoryUsers = new Map<string, UserRecord>();
const memoryReports = new Map<string, AgentReport>();
const memoryQueries = new Map<string, QueryRecord>();
const memoryAuthSessions = new Map<string, AuthSessionRecord>();
const memoryRevokedRefreshTokens = new Map<string, RevokedRefreshTokenRecord>();
const memoryWatchlists = new Map<string, WatchlistRecord>();
const memoryNotifications = new Map<string, NotificationRecord>();
const memoryPriceAlerts = new Map<string, PriceAlertRecord>();
const memoryPaperAccounts = new Map<string, PaperAccountRecord>();

let mongoDbPromise: Promise<Db | null> | null = null;
let indexesReady = false;

async function getMongoDb(): Promise<Db | null> {
  // Production uses MongoDB when configured; local/dev can still run without external infrastructure.
  if (!env.mongodbUri) {
    return null;
  }

  if (!mongoDbPromise) {
    mongoDbPromise = MongoClient.connect(env.mongodbUri, { serverSelectionTimeoutMS: 5000 })
      .then((client) => client.db(env.mongodbDbName || "findec"))
      .catch((err: unknown) => {
        console.warn("MongoDB connection failed, falling back to in-memory store:", err instanceof Error ? err.message : err);
        mongoDbPromise = null;
        return null;
      });
  }

  const db = await mongoDbPromise;
  if (db && !indexesReady) {
    await Promise.all([
      db.collection<UserRecord>("users").createIndex({ id: 1 }, { unique: true }),
      db.collection<UserRecord>("users").createIndex({ email: 1 }, { unique: true }),
      db.collection<AuthSessionRecord>("authSessions").createIndex({ id: 1 }, { unique: true }),
      db.collection<AuthSessionRecord>("authSessions").createIndex({ userId: 1 }),
      db.collection<QueryRecord>("queries").createIndex({ id: 1 }, { unique: true }),
      db.collection<AgentReport>("reports").createIndex({ id: 1 }, { unique: true }),
      db.collection<AgentReport>("reports").createIndex({ userId: 1, createdAt: -1 }),
      db.collection<RevokedRefreshTokenRecord>("revokedRefreshTokens").createIndex({ tokenHash: 1 }, { unique: true }),
      db.collection<RevokedRefreshTokenRecord>("revokedRefreshTokens").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection<WatchlistRecord>("watchlists").createIndex({ userId: 1 }, { unique: true }),
      db.collection<NotificationRecord>("notifications").createIndex({ id: 1 }, { unique: true }),
      db.collection<NotificationRecord>("notifications").createIndex({ userId: 1, createdAt: -1 }),
      db.collection<PriceAlertRecord>("priceAlerts").createIndex({ id: 1 }, { unique: true }),
      db.collection<PriceAlertRecord>("priceAlerts").createIndex({ userId: 1, active: 1 }),
      db.collection<PaperAccountRecord>("paperAccounts").createIndex({ userId: 1 }, { unique: true }),
    ]);
    indexesReady = true;
  }

  return db;
}

export async function getUserById(userId: string): Promise<UserRecord | undefined> {
  const db = await getMongoDb();
  if (!db) {
    return memoryUsers.get(userId);
  }
  return (await db.collection<UserRecord>("users").findOne({ id: userId }, { projection: { _id: 0 } })) ?? undefined;
}

export async function findUserByEmail(email: string): Promise<UserRecord | undefined> {
  const normalizedEmail = email.toLowerCase();
  const db = await getMongoDb();
  if (!db) {
    return Array.from(memoryUsers.values()).find((user) => user.email === normalizedEmail);
  }
  return (
    await db.collection<UserRecord>("users").findOne({ email: normalizedEmail }, { projection: { _id: 0 } })
  ) ?? undefined;
}

export async function saveUser(user: UserRecord): Promise<void> {
  const db = await getMongoDb();
  if (!db) {
    memoryUsers.set(user.id, user);
    return;
  }
  await db.collection<UserRecord>("users").replaceOne({ id: user.id }, user, { upsert: true });
}

export async function getSessionById(sessionId: string): Promise<AuthSessionRecord | undefined> {
  const db = await getMongoDb();
  if (!db) {
    return memoryAuthSessions.get(sessionId);
  }
  return (
    await db
      .collection<AuthSessionRecord>("authSessions")
      .findOne({ id: sessionId }, { projection: { _id: 0 } })
  ) ?? undefined;
}

export async function saveSession(session: AuthSessionRecord): Promise<void> {
  const db = await getMongoDb();
  if (!db) {
    memoryAuthSessions.set(session.id, session);
    return;
  }
  await db.collection<AuthSessionRecord>("authSessions").replaceOne({ id: session.id }, session, { upsert: true });
}

export async function revokeSession(sessionId: string): Promise<void> {
  const existing = await getSessionById(sessionId);
  if (!existing || existing.revokedAt) {
    return;
  }

  const updated: AuthSessionRecord = {
    ...existing,
    revokedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveSession(updated);
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  const db = await getMongoDb();
  if (!db) {
    for (const session of memoryAuthSessions.values()) {
      if (session.userId === userId) {
        memoryAuthSessions.set(session.id, {
          ...session,
          revokedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
    return;
  }

  await db.collection<AuthSessionRecord>("authSessions").updateMany(
    { userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } },
  );
}

export async function saveQuery(query: QueryRecord): Promise<void> {
  const db = await getMongoDb();
  if (!db) {
    memoryQueries.set(query.id, query);
    return;
  }
  await db.collection<QueryRecord>("queries").replaceOne({ id: query.id }, query, { upsert: true });
}

export async function saveReport(report: AgentReport): Promise<void> {
  const db = await getMongoDb();
  if (!db) {
    memoryReports.set(report.id, report);
    return;
  }
  await db.collection<AgentReport>("reports").replaceOne({ id: report.id }, report, { upsert: true });
}

export async function getReportById(reportId: string): Promise<AgentReport | undefined> {
  const db = await getMongoDb();
  if (!db) {
    return memoryReports.get(reportId);
  }
  return (
    await db.collection<AgentReport>("reports").findOne({ id: reportId }, { projection: { _id: 0 } })
  ) ?? undefined;
}

export async function listReportsByUser(userId: string): Promise<AgentReport[]> {
  const db = await getMongoDb();
  if (!db) {
    return Array.from(memoryReports.values())
      .filter((report) => report.userId === userId)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }

  return db
    .collection<AgentReport>("reports")
    .find({ userId }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .toArray();
}

export async function revokeRefreshToken(record: RevokedRefreshTokenRecord): Promise<void> {
  const db = await getMongoDb();
  if (!db) {
    memoryRevokedRefreshTokens.set(record.tokenHash, record);
    return;
  }

  await db
    .collection<RevokedRefreshTokenRecord>("revokedRefreshTokens")
    .replaceOne({ tokenHash: record.tokenHash }, record, { upsert: true });
}

// Expose raw DB for controllers that need it (e.g. stocks cache)
export async function getDb(): Promise<import("mongodb").Db | null> {
  return getMongoDb();
}

// ─── Watchlist ────────────────────────────────────────────────────────────────

export async function getWatchlist(userId: string): Promise<WatchlistRecord | null> {
  const db = await getMongoDb();
  if (!db) return memoryWatchlists.get(userId) ?? null;
  return (await db.collection<WatchlistRecord>("watchlists").findOne({ userId }, { projection: { _id: 0 } })) ?? null;
}

export async function saveWatchlist(record: WatchlistRecord): Promise<void> {
  const db = await getMongoDb();
  if (!db) { memoryWatchlists.set(record.userId, record); return; }
  await db.collection<WatchlistRecord>("watchlists").replaceOne({ userId: record.userId }, record, { upsert: true });
}

export async function getAllWatchlists(): Promise<WatchlistRecord[]> {
  const db = await getMongoDb();
  if (!db) return Array.from(memoryWatchlists.values());
  return db.collection<WatchlistRecord>("watchlists").find({}, { projection: { _id: 0 } }).toArray();
}

// ─── Notifications ────────────────────────────────────────────────────────────

export async function getNotifications(userId: string, limit = 20): Promise<NotificationRecord[]> {
  const db = await getMongoDb();
  if (!db) {
    return Array.from(memoryNotifications.values())
      .filter(n => n.userId === userId)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
      .slice(0, limit);
  }
  return db.collection<NotificationRecord>("notifications")
    .find({ userId }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

export async function getUnreadCount(userId: string): Promise<number> {
  const db = await getMongoDb();
  if (!db) return Array.from(memoryNotifications.values()).filter(n => n.userId === userId && !n.read).length;
  return db.collection<NotificationRecord>("notifications").countDocuments({ userId, read: false });
}

export async function saveNotification(notification: NotificationRecord): Promise<void> {
  const db = await getMongoDb();
  if (!db) { memoryNotifications.set(notification.id, notification); return; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db.collection("notifications") as any).insertOne({ ...notification });
}

export async function markNotificationRead(id: string, userId: string): Promise<void> {
  const db = await getMongoDb();
  if (!db) {
    const n = memoryNotifications.get(id);
    if (n && n.userId === userId) memoryNotifications.set(id, { ...n, read: true });
    return;
  }
  await db.collection<NotificationRecord>("notifications").updateOne({ id, userId }, { $set: { read: true } });
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const db = await getMongoDb();
  if (!db) {
    for (const [k, n] of memoryNotifications.entries()) {
      if (n.userId === userId) memoryNotifications.set(k, { ...n, read: true });
    }
    return;
  }
  await db.collection<NotificationRecord>("notifications").updateMany({ userId, read: false }, { $set: { read: true } });
}

// ─── Price alerts ───────────────────────────────────────────────────────────

export async function getPriceAlertsForUser(userId: string): Promise<PriceAlertRecord[]> {
  const db = await getMongoDb();
  if (!db) {
    return Array.from(memoryPriceAlerts.values())
      .filter((a) => a.userId === userId)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return db.collection<PriceAlertRecord>("priceAlerts")
    .find({ userId }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .toArray();
}

export async function getActivePriceAlerts(): Promise<PriceAlertRecord[]> {
  const db = await getMongoDb();
  if (!db) return Array.from(memoryPriceAlerts.values()).filter((a) => a.active);
  return db.collection<PriceAlertRecord>("priceAlerts").find({ active: true }, { projection: { _id: 0 } }).toArray();
}

export async function getActivePriceAlertsForUser(userId: string): Promise<PriceAlertRecord[]> {
  const db = await getMongoDb();
  if (!db) return Array.from(memoryPriceAlerts.values()).filter((a) => a.active && a.userId === userId);
  return db.collection<PriceAlertRecord>("priceAlerts").find({ userId, active: true }, { projection: { _id: 0 } }).toArray();
}

export async function savePriceAlert(alert: PriceAlertRecord): Promise<void> {
  const db = await getMongoDb();
  if (!db) { memoryPriceAlerts.set(alert.id, alert); return; }
  await db.collection<PriceAlertRecord>("priceAlerts").replaceOne({ id: alert.id }, alert, { upsert: true });
}

export async function deletePriceAlert(id: string, userId: string): Promise<void> {
  const db = await getMongoDb();
  if (!db) {
    const a = memoryPriceAlerts.get(id);
    if (a && a.userId === userId) memoryPriceAlerts.delete(id);
    return;
  }
  await db.collection<PriceAlertRecord>("priceAlerts").deleteOne({ id, userId });
}

// ─── Paper trading accounts ─────────────────────────────────────────────────

export async function getPaperAccount(userId: string): Promise<PaperAccountRecord | null> {
  const db = await getMongoDb();
  if (!db) return memoryPaperAccounts.get(userId) ?? null;
  return (await db.collection<PaperAccountRecord>("paperAccounts").findOne({ userId }, { projection: { _id: 0 } })) ?? null;
}

export async function savePaperAccount(account: PaperAccountRecord): Promise<void> {
  const db = await getMongoDb();
  if (!db) { memoryPaperAccounts.set(account.userId, account); return; }
  await db.collection<PaperAccountRecord>("paperAccounts").replaceOne({ userId: account.userId }, account, { upsert: true });
}

// ─── Public report sharing ────────────────────────────────────────────────────

export async function getReportByPublicSlug(slug: string): Promise<AgentReport | undefined> {
  const db = await getMongoDb();
  if (!db) {
    return Array.from(memoryReports.values()).find((r) => (r as AgentReport & { publicSlug?: string }).publicSlug === slug);
  }
  return (await db.collection<AgentReport>("reports").findOne({ publicSlug: slug } as Record<string, unknown>, { projection: { _id: 0 } })) ?? undefined;
}

export async function isRefreshTokenRevoked(tokenHash: string): Promise<boolean> {
  const db = await getMongoDb();
  if (!db) {
    const record = memoryRevokedRefreshTokens.get(tokenHash);
    if (!record) {
      return false;
    }
    if (+new Date(record.expiresAt) <= Date.now()) {
      memoryRevokedRefreshTokens.delete(tokenHash);
      return false;
    }
    return true;
  }

  const record = await db
    .collection<RevokedRefreshTokenRecord>("revokedRefreshTokens")
    .findOne({ tokenHash }, { projection: { tokenHash: 1 } });
  return Boolean(record);
}
