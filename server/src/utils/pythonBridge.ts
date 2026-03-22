import axios, { AxiosError } from "axios";
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

export class PythonServiceError extends Error {
  constructor(
    message: string,
    public code: "UNREACHABLE" | "TIMEOUT" | "ERROR" | "UNKNOWN" = "UNKNOWN"
  ) {
    super(message);
    this.name = "PythonServiceError";
  }
}

export async function runPythonAgents(payload: PythonRunPayload): Promise<PythonRunResponse> {
  try {
    const response = await axios.post<PythonRunResponse>(env.pythonServiceUrl, payload, {
      timeout: 30_000
    });

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      if (axiosError.code === "ECONNREFUSED" || axiosError.code === "ENOTFOUND") {
        const message = `Unable to reach the analysis server at ${env.pythonServiceUrl}. Please ensure the Python service is running.`;
        console.error("[PythonBridge] Connection failed:", message);
        throw new PythonServiceError(message, "UNREACHABLE");
      }

      if (axiosError.code === "ECONNABORTED") {
        const message = `Analysis server request timed out after 30 seconds. Please try again in a moment.`;
        console.error("[PythonBridge] Timeout:", message);
        throw new PythonServiceError(message, "TIMEOUT");
      }

      if (axiosError.response) {
        const status = axiosError.response.status;
        const detail =
          typeof axiosError.response.data === "object" &&
          axiosError.response.data &&
          "detail" in axiosError.response.data
            ? (axiosError.response.data.detail as string)
            : "Unknown error";
        const message = `Analysis server error (${status}): ${detail}`;
        console.error("[PythonBridge] Service error:", message);
        throw new PythonServiceError(message, "ERROR");
      }

      const message = `Analysis server request failed: ${axiosError.message}`;
      console.error("[PythonBridge] Request failed:", message);
      throw new PythonServiceError(message, "UNKNOWN");
    }

    // Handle non-axios errors
    const message = error instanceof Error ? error.message : "Unknown error calling analysis service";
    console.error("[PythonBridge] Unexpected error:", message);
    throw new PythonServiceError(message, "UNKNOWN");
  }
}
