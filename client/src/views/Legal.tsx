"use client";

import Link from "next/link";

type Doc = "disclaimer" | "privacy" | "terms";

const UPDATED = "June 2026";

function DisclaimerBody() {
  return (
    <>
      <p className="legal-lead">
        Findec is an <strong>information and decision-support tool</strong>. It is <strong>not</strong> investment,
        financial, legal, or tax advice, and nothing in the app is a recommendation, solicitation, or offer to buy or
        sell any security.
      </p>
      <h2>Not a registered adviser</h2>
      <p>
        Findec is not a SEBI-registered Investment Adviser or Research Analyst, nor a registered broker-dealer or
        investment adviser in any other jurisdiction. AI-generated briefs, signals, ratings, sentiment scores, and
        "what to do today" lines are automated, model-generated opinions for educational purposes only.
      </p>
      <h2>Markets carry risk</h2>
      <p>
        Investing in securities involves risk, including the possible loss of principal. Past performance — including any
        track record shown in the app — does not guarantee future results. You are solely responsible for your own
        investment decisions. Consult a qualified, registered financial adviser before investing.
      </p>
      <h2>Data accuracy</h2>
      <p>
        Market data is sourced from third-party providers (e.g. Yahoo Finance, Finnhub, Twelve Data, Financial Modeling
        Prep) and may be delayed, incomplete, or inaccurate. Prices, fundamentals, and calendars are provided "as is"
        without warranty. Always verify with your broker or the exchange before acting.
      </p>
      <h2>Paper trading</h2>
      <p>
        The paper-trading feature is a simulation using virtual money. It does not involve real funds, real orders, or
        any real brokerage, and simulated results do not reflect real trading costs, slippage, taxes, or liquidity.
      </p>
    </>
  );
}

function PrivacyBody() {
  return (
    <>
      <p className="legal-lead">
        This policy explains what Findec collects and how it is used. We aim to collect the minimum needed to run the
        product.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account data</strong> — your email, a hashed password, and your display name when you register.</li>
        <li><strong>Usage data</strong> — your watchlist, price alerts, saved AI briefs, paper-trading activity, and app preferences (e.g. risk profile, region).</li>
        <li><strong>Technical data</strong> — approximate region (derived from your IP for market localisation), and anonymous, aggregate analytics about page usage.</li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>To provide the service — authenticate you, generate briefs, evaluate alerts, and personalise market data.</li>
        <li>To send notifications you ask for (e.g. price alerts), and product-related emails.</li>
        <li>To improve reliability and features through aggregate analytics.</li>
      </ul>
      <h2>What we don&apos;t do</h2>
      <p>We do not sell your personal data. Passwords are stored only as salted hashes and are never readable by us.</p>
      <h2>Third parties</h2>
      <p>
        We use infrastructure and data providers (hosting, database, market-data APIs, the AI model provider, and
        analytics) strictly to operate the product. Your queries may be processed by our AI provider to generate briefs.
      </p>
      <h2>Your choices</h2>
      <p>
        You can delete your watchlist, alerts, and reports in-app, and you can request account deletion by contacting us.
        Enabling two-factor authentication (2FA) is strongly recommended.
      </p>
    </>
  );
}

function TermsBody() {
  return (
    <>
      <p className="legal-lead">By using Findec you agree to these terms.</p>
      <h2>Use of the service</h2>
      <p>
        Findec grants you a personal, non-exclusive, non-transferable licence to use the app for your own,
        non-commercial decision-support purposes. You agree not to scrape, resell, or redistribute the data or AI output,
        and not to misuse, attack, or attempt to gain unauthorised access to the service.
      </p>
      <h2>No advice; your responsibility</h2>
      <p>
        As set out in the <Link href="/disclaimer" className="legal-inline-link">Disclaimer</Link>, Findec does not provide
        investment advice. All decisions you make are your own. To the maximum extent permitted by law, Findec and its
        operators are not liable for any losses arising from your use of the app or reliance on its data or AI output.
      </p>
      <h2>Accounts</h2>
      <p>
        You are responsible for keeping your credentials secure and for all activity under your account. We may suspend
        accounts that violate these terms or abuse the service (including rate-limit evasion).
      </p>
      <h2>Availability &amp; changes</h2>
      <p>
        The service is provided "as is" and may change, be interrupted, or be discontinued at any time. We may update
        these terms; continued use after an update constitutes acceptance.
      </p>
      <h2>Contact</h2>
      <p>Questions about these terms? Reach out via the contact option in the app.</p>
    </>
  );
}

const DOCS: Record<Doc, { kicker: string; title: string; body: () => JSX.Element }> = {
  disclaimer: { kicker: "Legal", title: "Disclaimer", body: DisclaimerBody },
  privacy: { kicker: "Legal", title: "Privacy Policy", body: PrivacyBody },
  terms: { kicker: "Legal", title: "Terms of Service", body: TermsBody },
};

export default function Legal({ doc }: { doc: Doc }) {
  const d = DOCS[doc];
  const Body = d.body;
  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell legal-shell">
        <p className="findec-kicker">{d.kicker}</p>
        <h1 className="legal-title">{d.title}</h1>
        <p className="legal-updated">Last updated: {UPDATED}</p>

        <article className="findec-panel legal-panel">
          <Body />
        </article>

        <div className="legal-nav">
          <Link href="/disclaimer" className={`legal-nav-link${doc === "disclaimer" ? " legal-nav-link-on" : ""}`}>Disclaimer</Link>
          <Link href="/privacy" className={`legal-nav-link${doc === "privacy" ? " legal-nav-link-on" : ""}`}>Privacy</Link>
          <Link href="/terms" className={`legal-nav-link${doc === "terms" ? " legal-nav-link-on" : ""}`}>Terms</Link>
        </div>
      </div>
    </section>
  );
}
