import { MongoClient, type Db } from "mongodb";
import { env } from "../config";
import type { AgentReport } from "../models/Report.model";
import type { AuthSessionRecord } from "../models/AuthSession.model";
import type { QueryRecord } from "../models/Query.model";
import type { UserRecord } from "../models/User.model";

const memoryUsers = new Map<string, UserRecord>();
const memoryReports = new Map<string, AgentReport>();
const memoryQueries = new Map<string, QueryRecord>();
const memoryAuthSessions = new Map<string, AuthSessionRecord>();

let mongoDbPromise: Promise<Db | null> | null = null;
let indexesReady = false;

async function getMongoDb(): Promise<Db | null> {
  if (!env.mongodbUri) {
    return null;
  }

  if (!mongoDbPromise) {
    mongoDbPromise = MongoClient.connect(env.mongodbUri).then((client) =>
      client.db(env.mongodbDbName || "finity"),
    );
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
