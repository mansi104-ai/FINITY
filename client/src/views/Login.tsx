"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { loginUser } from "../services/api";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await loginUser(email.trim(), password, needs2fa ? totp.trim() : undefined);
      router.push("/watchlist");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed. Check your credentials.";
      if (/2fa code/i.test(msg)) {
        setNeeds2fa(true);
        setError(needs2fa ? "Invalid 2FA code — try again." : "Enter the 6-digit code from your authenticator app.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="findec-minimal-page auth-page">
      <div className="auth-card">
        <p className="findec-kicker">Welcome back</p>
        <h1 className="auth-title">Sign in to FINITY</h1>

        <form className="auth-form" onSubmit={(e) => void handleSubmit(e)}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="email">Email</label>
            <input
              id="email"
              className="auth-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="password">Password</label>
            <input
              id="password"
              className="auth-input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          {needs2fa && (
            <div className="auth-field">
              <label className="auth-label" htmlFor="totp">2FA code</label>
              <input
                id="totp"
                className="auth-input"
                inputMode="numeric"
                placeholder="123456"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                autoComplete="one-time-code"
                autoFocus
              />
            </div>
          )}
          {error && <p className="auth-error">{error}</p>}
          <button className="auth-btn" type="submit" disabled={loading}>
            {loading ? "Signing in…" : needs2fa ? "Verify & sign in" : "Sign in"}
          </button>
        </form>

        <p className="auth-footer">
          No account?{" "}
          <Link href="/register" className="auth-link">Create one →</Link>
        </p>
      </div>
    </section>
  );
}
