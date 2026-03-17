import axios from "axios";
import { env } from "../config";
import type { AgentReport } from "../models/Report.model";
import type { RiskProfile } from "../models/User.model";

export type PythonRunPayload = {
  query: string;
  ticker: string;
  budget: number;
  risk_profile: RiskProfile;
  version: number;
};

export type PythonRunResponse = Omit<AgentReport, "id" | "userId" | "createdAt">;

export async function runPythonAgents(payload: PythonRunPayload): Promise<PythonRunResponse> {
  const response = await axios.post<PythonRunResponse>(env.pythonServiceUrl, payload, {
    timeout: 30_000
  });

  return response.data;
}
