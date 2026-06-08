"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getLedger, addLedgerEntry, deleteLedgerEntry,
  getWatchlist, getEarnings, getSessionUser, subscribeToAuthChanges,
  type LedgerEntry, type LedgerSummary,
} from "../services/api";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function money(v: number): string {
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const INCOME_WORDS = ["salary", "income", "bonus", "dividend", "interest", "refund", "payout", "profit", "freelance", "stipend", "commission", "rent received", "sale", "cashback", "reimburse"];
const EXPENSE_WORDS = ["rent", "food", "grocer", "bill", "emi", "loan", "tax", "fee", "fuel", "petrol", "shopping", "subscription", "insurance", "travel", "medical", "expense", "utilit", "electric", "recharge"];

// Identify income vs expense from a category/note keyword (#7).
function detectLedgerType(text: string): "income" | "expense" | null {
  const t = text.toLowerCase();
  if (INCOME_WORDS.some((w) => t.includes(w))) return "income";
  if (EXPENSE_WORDS.some((w) => t.includes(w))) return "expense";
  return null;
}

export default function Calendar() {
  const [signedIn, setSignedIn] = useState(false);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [summary, setSummary] = useState<LedgerSummary>({ income: 0, expense: 0, net: 0, count: 0 });
  const [earningsByDate, setEarningsByDate] = useState<Record<string, string[]>>({});
  const [error, setError] = useState("");
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState<string>(ymd(now.getFullYear(), now.getMonth(), now.getDate()));

  // Add-entry form
  const [type, setType] = useState<"income" | "expense">("expense");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const loadLedger = useCallback(async () => {
    try { const res = await getLedger(); setEntries(res.entries); setSummary(res.summary); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load ledger."); }
  }, []);

  useEffect(() => {
    const sync = () => {
      const isIn = getSessionUser() !== null;
      setSignedIn(isIn);
      if (isIn) void loadLedger(); else { setEntries([]); }
    };
    sync();
    return subscribeToAuthChanges(sync);
  }, [loadLedger]);

  // Watchlist earnings → per-date map (profile-specific calendar events).
  useEffect(() => {
    if (!signedIn) return;
    void (async () => {
      try {
        const [wl, earn] = await Promise.all([getWatchlist(), getEarnings()]);
        const tickers = new Set(wl.items.map((i) => i.ticker.toUpperCase()));
        const map: Record<string, string[]> = {};
        for (const e of [...earn.upcoming, ...earn.recent]) {
          if (!tickers.has(e.symbol.toUpperCase())) continue;
          const d = e.date.slice(0, 10);
          (map[d] ??= []).push(e.symbol.toUpperCase());
        }
        setEarningsByDate(map);
      } catch { /* earnings overlay optional */ }
    })();
  }, [signedIn]);

  const entriesByDate = useMemo(() => {
    const map: Record<string, LedgerEntry[]> = {};
    for (const e of entries) (map[e.date] ??= []).push(e);
    return map;
  }, [entries]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError("Enter a positive amount."); return; }
    setBusy(true); setError("");
    try {
      await addLedgerEntry({ type, category: category.trim() || (type === "income" ? "Income" : "Expense"), amount: amt, note: note.trim() || undefined, date: selected });
      setAmount(""); setNote(""); setCategory("");
      await loadLedger();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add entry."); }
    finally { setBusy(false); }
  };

  const onDelete = async (id: string) => {
    try { await deleteLedgerEntry(id); await loadLedger(); } catch { /* ignore */ }
  };

  if (!signedIn) {
    return (
      <section className="findec-minimal-page">
        <div className="findec-minimal-shell earn-shell">
          <div className="findec-panel hist-empty">
            <p className="hist-empty-title">Sign in for your calendar &amp; ledger</p>
            <p className="hist-empty-sub">Track income, savings, and expenses, and see your watchlist&apos;s earnings dates.</p>
            <Link href="/login" className="hist-empty-cta">Login →</Link>
          </div>
        </div>
      </section>
    );
  }

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const prevMonth = () => { if (month === 0) { setMonth(11); setYear((y) => y - 1); } else setMonth((m) => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear((y) => y + 1); } else setMonth((m) => m + 1); };

  const selectedEntries = entriesByDate[selected] ?? [];
  const selectedEarnings = earningsByDate[selected] ?? [];

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell earn-shell">
        <div className="earn-header">
          <div>
            <p className="findec-kicker">Your Calendar &amp; Ledger</p>
            <h1 className="earn-title">Calendar &amp; Money</h1>
          </div>
          <div className="earn-header-actions">
            <Link href="/watchlist" className="earn-nav-btn">Watchlist →</Link>
          </div>
        </div>

        {/* Summary */}
        <div className="ins-totals">
          <div className="ins-total-card"><span>Income</span><strong className="findec-subline-up">${money(summary.income)}</strong></div>
          <div className="ins-total-card"><span>Expenses</span><strong className="findec-subline-down">${money(summary.expense)}</strong></div>
          <div className="ins-total-card"><span>Net / Savings</span><strong className={summary.net >= 0 ? "findec-subline-up" : "findec-subline-down"}>${money(summary.net)}</strong></div>
        </div>

        {error && <div className="findec-panel earn-error">{error}</div>}

        {/* Calendar grid */}
        <div className="findec-panel cal-panel">
          <div className="cal-nav">
            <button className="adv-chip" onClick={prevMonth}>←</button>
            <strong className="cal-title">{MONTHS[month]} {year}</strong>
            <button className="adv-chip" onClick={nextMonth}>→</button>
          </div>
          <div className="cal-grid cal-dow">
            {DOW.map((d) => <div key={d} className="cal-dow-cell">{d}</div>)}
          </div>
          <div className="cal-grid">
            {cells.map((day, idx) => {
              if (day == null) return <div key={`b${idx}`} className="cal-cell cal-cell-empty" />;
              const date = ymd(year, month, day);
              const dayEntries = entriesByDate[date] ?? [];
              const net = dayEntries.reduce((s, e) => s + (e.type === "income" ? e.amount : -e.amount), 0);
              const earn = earningsByDate[date] ?? [];
              const isSel = date === selected;
              const isToday = date === ymd(now.getFullYear(), now.getMonth(), now.getDate());
              return (
                <button
                  key={date}
                  className={`cal-cell${isSel ? " cal-cell-sel" : ""}${isToday ? " cal-cell-today" : ""}`}
                  onClick={() => setSelected(date)}
                >
                  <span className="cal-daynum">{day}</span>
                  {dayEntries.length > 0 && (
                    <span className={`cal-net ${net >= 0 ? "findec-subline-up" : "findec-subline-down"}`}>{net >= 0 ? "+" : ""}{money(net)}</span>
                  )}
                  {earn.length > 0 && <span className="cal-earn" title={`Earnings: ${earn.join(", ")}`}>📊 {earn.length}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected day + add entry */}
        <div className="cal-two">
          <div className="findec-panel cal-day-panel">
            <p className="findec-kicker">{selected}</p>
            {selectedEarnings.length > 0 && (
              <p className="cal-day-earn">Watchlist earnings: {selectedEarnings.map((s) => (
                <Link key={s} href={`/stock/${encodeURIComponent(s)}`} className="earn-symbol">{s}</Link>
              )).reduce((a, b) => <>{a} · {b}</>)}</p>
            )}
            {selectedEntries.length === 0 ? (
              <p className="text-muted">No ledger entries on this day.</p>
            ) : (
              <ul className="cal-entry-list">
                {selectedEntries.map((e) => (
                  <li key={e.id} className="cal-entry">
                    <span className={`cal-entry-amt ${e.type === "income" ? "findec-subline-up" : "findec-subline-down"}`}>
                      {e.type === "income" ? "+" : "−"}${money(e.amount)}
                    </span>
                    <span className="cal-entry-cat">{e.category}{e.note ? ` · ${e.note}` : ""}</span>
                    <button className="alert-del" onClick={() => void onDelete(e.id)}>✕</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form className="findec-panel cal-add" onSubmit={submit}>
            <p className="findec-kicker">Add entry · {selected}</p>
            {/* Single toggle to switch Income ⇄ Expense (#7) */}
            <button
              type="button"
              className={`cal-type-toggle ${type === "income" ? "is-income" : "is-expense"}`}
              onClick={() => setType((t) => (t === "income" ? "expense" : "income"))}
              aria-label={`Type: ${type}. Tap to switch.`}
            >
              <span className={type === "income" ? "on" : ""}>Income</span>
              <span className="cal-type-knob" />
              <span className={type === "expense" ? "on" : ""}>Expense</span>
            </button>
            <input
              className="alert-input cal-input"
              placeholder="Category (e.g. Salary, Rent) — auto-detects type"
              value={category}
              onChange={(e) => {
                const val = e.target.value;
                setCategory(val);
                const detected = detectLedgerType(val);
                if (detected) setType(detected); // keyword-driven; user can still flip the toggle
              }}
            />
            <input className="alert-input cal-input" type="number" step="0.01" min="0" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <input className="alert-input cal-input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="earn-nav-btn" type="submit" disabled={busy}>{busy ? "Adding…" : "Add to ledger"}</button>
          </form>
        </div>
      </div>
    </section>
  );
}
