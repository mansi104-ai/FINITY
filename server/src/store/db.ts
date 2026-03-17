import type { AgentReport } from "../models/Report.model";
import type { QueryRecord } from "../models/Query.model";
import type { UserRecord } from "../models/User.model";

const users = new Map<string, UserRecord>();
const reports = new Map<string, AgentReport>();
const queries = new Map<string, QueryRecord>();

export const db = {
  users,
  reports,
  queries
};

export function findUserByEmail(email: string): UserRecord | undefined {
  return Array.from(users.values()).find((user) => user.email === email.toLowerCase());
}

export function listReportsByUser(userId: string): AgentReport[] {
  return Array.from(reports.values())
    .filter((report) => report.userId === userId)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
}
