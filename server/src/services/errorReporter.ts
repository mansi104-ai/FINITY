import { env } from "../config";

/**
 * Dependency-free error reporter. Always logs to stderr; if ERROR_WEBHOOK_URL
 * (or a Sentry-style ingest webhook) is configured, also POSTs a JSON payload.
 * No SDK, so it adds nothing to the bundle and never blocks the response.
 */
export function reportError(err: unknown, context: Record<string, unknown> = {}): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error("[error]", message, context, stack ?? "");

  if (!env.errorWebhookUrl) return;
  // Fire-and-forget; swallow transport failures so reporting never cascades.
  void (async () => {
    try {
      const { default: axios } = await import("axios");
      await axios.post(env.errorWebhookUrl, {
        service: "findec-server",
        message, stack, context,
        at: new Date().toISOString(),
      }, { timeout: 4000 });
    } catch { /* never throw from the reporter */ }
  })();
}
