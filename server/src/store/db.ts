import type { AgentReport } from "../models/Report.model";
import type { AuthSessionRecord } from "../models/AuthSession.model";
import type { QueryRecord } from "../models/Query.model";
import type { UserRecord } from "../models/User.model";

const users = new Map<string, UserRecord>();
const reports = new Map<string, AgentReport>();
const queries = new Map<string, QueryRecord>();
const authSessions = new Map<string, AuthSessionRecord>();

export const db = {
  users,
  reports,
  queries,
  authSessions
};

export function findUserByEmail(email: string): UserRecord | undefined {
  return Array.from(users.values()).find((user) => user.email === email.toLowerCase());
}

export function listReportsByUser(userId: string): AgentReport[] {
  return Array.from(reports.values())
    .filter((report) => report.userId === userId)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}

export function revokeSession(sessionId: string): void {
  const session = authSessions.get(sessionId);
  if (!session || session.revokedAt) {
    return;
  }

  const now = new Date().toISOString();
  authSessions.set(sessionId, {
    ...session,
    revokedAt: now,
    updatedAt: now
  });
}

export function revokeAllSessionsForUser(userId: string): void {
  for (const session of authSessions.values()) {
    if (session.userId === userId) {
      revokeSession(session.id);
    }
  }
}
