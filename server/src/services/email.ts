import { env } from "../config";

/**
 * Lightweight email sender. If no SMTP/webhook is configured we log and no-op
 * so the digest/alert flow never hard-fails in dev or on Vercel without email.
 *
 * To enable real delivery, set EMAIL_WEBHOOK_URL to an endpoint that accepts
 * { to, subject, text } JSON (e.g. a Resend/SendGrid proxy or a serverless fn).
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!env.emailWebhookUrl) {
    console.log(`[email] (no EMAIL_WEBHOOK_URL set) would send to ${to}: ${subject}`);
    return false;
  }
  try {
    const { default: axios } = await import("axios");
    await axios.post(env.emailWebhookUrl, { to, subject, text }, { timeout: 8000 });
    return true;
  } catch (err) {
    console.warn("[email] send failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
