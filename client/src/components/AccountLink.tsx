"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSessionUser, logoutUser, subscribeToAuthChanges } from "../services/api";

export default function AccountLink() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const syncUser = () => {
      const user = getSessionUser();
      setEmail(user?.email ?? null);
    };

    syncUser();
    return subscribeToAuthChanges(syncUser);
  }, []);

  if (email) {
    return (
      <div className="findec-account-wrap">
        <span className="findec-account-email" title={email}>
          {email.split("@")[0]}
        </span>
        <button
          className="findec-topnav-link findec-logout-btn"
          onClick={() => { void logoutUser().then(() => { setEmail(null); window.location.href = "/login"; }); }}
        >
          Out
        </button>
      </div>
    );
  }

  return (
    <Link className="findec-topnav-link findec-login-link" href="/login">
      Login
    </Link>
  );
}
