"use client";

import { useEffect, useState } from "react";
import {
  get2faStatus,
  enroll2fa,
  activate2fa,
  disable2fa,
  getSessionUser,
} from "../services/api";

type Stage = "loading" | "off" | "enrolling" | "on" | "guest";

export default function TwoFactorCard() {
  const [stage, setStage] = useState<Stage>("loading");
  const [secret, setSecret] = useState("");
  const [otpauth, setOtpauth] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (getSessionUser() === null) { setStage("guest"); return; }
    get2faStatus()
      .then((s) => setStage(s.enabled ? "on" : "off"))
      .catch(() => setStage("off"));
  }, []);

  const startEnroll = async () => {
    setBusy(true); setMsg("");
    try {
      const res = await enroll2fa();
      setSecret(res.secret);
      setOtpauth(res.otpauthUri);
      setStage("enrolling");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not start enrollment."); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    setBusy(true); setMsg("");
    try {
      await activate2fa(code.trim());
      setStage("on"); setCode(""); setMsg("Two-factor authentication is now enabled.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Activation failed."); }
    finally { setBusy(false); }
  };

  const turnOff = async () => {
    setBusy(true); setMsg("");
    try {
      await disable2fa(code.trim());
      setStage("off"); setCode(""); setMsg("Two-factor authentication disabled.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not disable 2FA."); }
    finally { setBusy(false); }
  };

  if (stage === "guest") return null;

  return (
    <article className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Security</p>
          <h3>Two-Factor Authentication</h3>
        </div>
        {stage === "on" && <span className="findec-tag findec-tag-green">Enabled</span>}
      </div>

      {stage === "loading" && <p className="text-muted">Checking status…</p>}

      {stage === "off" && (
        <>
          <p className="text-muted">Add a time-based one-time code (TOTP) from an authenticator app as a second factor at login.</p>
          <button className="button button-primary" disabled={busy} onClick={() => void startEnroll()}>Enable 2FA</button>
        </>
      )}

      {stage === "enrolling" && (
        <>
          <p className="text-muted">1. Add this secret to your authenticator app (Google Authenticator, Authy, 1Password…):</p>
          <code className="twofa-secret">{secret}</code>
          <p className="text-muted twofa-uri-note">Or import this URI: <span className="twofa-uri">{otpauth}</span></p>
          <p className="text-muted">2. Enter the 6-digit code it shows to confirm:</p>
          <div className="twofa-confirm-row">
            <input className="alert-input" inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="button button-primary" disabled={busy} onClick={() => void confirm()}>Confirm</button>
          </div>
        </>
      )}

      {stage === "on" && (
        <>
          <p className="text-muted">2FA is active. To disable it, enter a current code:</p>
          <div className="twofa-confirm-row">
            <input className="alert-input" inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="button button-secondary" disabled={busy} onClick={() => void turnOff()}>Disable 2FA</button>
          </div>
        </>
      )}

      {msg && <p className="twofa-msg">{msg}</p>}
    </article>
  );
}
