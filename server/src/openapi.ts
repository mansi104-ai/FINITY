// Hand-written OpenAPI 3.0 spec (dependency-free) describing the public API surface.
// Served at GET /api/openapi.json and rendered by Swagger UI at GET /api/docs.

export const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "FINITY API",
    version: "1.0.0",
    description:
      "Backend for FINITY — market data, AI briefs, watchlist, alerts, research, insights, paper trading, and sharing. Decision support only; not financial advice.",
  },
  servers: [{ url: "/", description: "Same origin" }],
  tags: [
    { name: "Health" }, { name: "Auth" }, { name: "Market" }, { name: "Research" },
    { name: "Insights" }, { name: "Watchlist" }, { name: "Alerts" }, { name: "Notifications" },
    { name: "Paper Trading" }, { name: "Reports" }, { name: "Public" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
  },
  paths: {
    "/api/health": { get: { tags: ["Health"], summary: "Service health + version", responses: { "200": { description: "OK" } } } },

    "/api/auth/register": { post: { tags: ["Auth"], summary: "Create account", responses: { "201": { description: "Created" }, "409": { description: "Email exists" } } } },
    "/api/auth/login": { post: { tags: ["Auth"], summary: "Login (totp required if 2FA on)", responses: { "200": { description: "Tokens" }, "401": { description: "Invalid / 2FA required" } } } },
    "/api/auth/refresh": { post: { tags: ["Auth"], summary: "Rotate refresh token", responses: { "200": { description: "Tokens" } } } },
    "/api/auth/logout": { post: { tags: ["Auth"], security: [{ bearerAuth: [] }], summary: "Revoke session", responses: { "200": { description: "OK" } } } },
    "/api/auth/2fa/status": { get: { tags: ["Auth"], security: [{ bearerAuth: [] }], summary: "2FA enabled?", responses: { "200": { description: "OK" } } } },
    "/api/auth/2fa/enroll": { post: { tags: ["Auth"], security: [{ bearerAuth: [] }], summary: "Begin TOTP enrollment", responses: { "200": { description: "secret + otpauthUri" } } } },
    "/api/auth/2fa/activate": { post: { tags: ["Auth"], security: [{ bearerAuth: [] }], summary: "Confirm + enable 2FA", responses: { "200": { description: "OK" } } } },
    "/api/auth/2fa/disable": { post: { tags: ["Auth"], security: [{ bearerAuth: [] }], summary: "Disable 2FA", responses: { "200": { description: "OK" } } } },

    "/api/market/snapshot": { get: { tags: ["Market"], summary: "Market overview + status", responses: { "200": { description: "OK" } } } },
    "/api/market/stocks": { get: { tags: ["Market"], summary: "Stock list with fundamentals", responses: { "200": { description: "OK" } } } },
    "/api/market/stock/{ticker}": { get: { tags: ["Market"], summary: "Single quote", parameters: [{ name: "ticker", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
    "/api/market/history/{ticker}": { get: { tags: ["Market"], summary: "30-day close history", parameters: [{ name: "ticker", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
    "/api/market/candles/{ticker}": { get: { tags: ["Market"], summary: "OHLCV candles", parameters: [{ name: "ticker", in: "path", required: true, schema: { type: "string" } }, { name: "range", in: "query", schema: { type: "string", enum: ["1mo", "3mo", "6mo", "1y", "2y", "5y"] } }], responses: { "200": { description: "OK" } } } },
    "/api/market/news": { get: { tags: ["Market"], summary: "News articles", parameters: [{ name: "ticker", in: "query", schema: { type: "string" } }, { name: "category", in: "query", schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
    "/api/market/search": { get: { tags: ["Market"], summary: "Ticker search", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
    "/api/market/earnings": { get: { tags: ["Market"], summary: "Earnings calendar", responses: { "200": { description: "OK" } } } },
    "/api/market/ipo": { get: { tags: ["Market"], summary: "IPO calendar", responses: { "200": { description: "OK" } } } },
    "/api/market/recommendations/{ticker}": { get: { tags: ["Market"], summary: "Analyst consensus", parameters: [{ name: "ticker", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
    "/api/market/research": { get: { tags: ["Research"], summary: "Sector heatmap + dividend tracker", responses: { "200": { description: "OK" } } } },

    "/api/insights/regime": { get: { tags: ["Insights"], summary: "Market regime classifier", responses: { "200": { description: "OK" } } } },
    "/api/insights/portfolio": { get: { tags: ["Insights"], security: [{ bearerAuth: [] }], summary: "Portfolio analysis from watchlist", responses: { "200": { description: "OK" } } } },

    "/api/watchlist": {
      get: { tags: ["Watchlist"], security: [{ bearerAuth: [] }], summary: "List items", responses: { "200": { description: "OK" } } },
      post: { tags: ["Watchlist"], security: [{ bearerAuth: [] }], summary: "Add item", responses: { "201": { description: "Created" } } },
    },
    "/api/watchlist/{ticker}": {
      delete: { tags: ["Watchlist"], security: [{ bearerAuth: [] }], summary: "Remove item", parameters: [{ name: "ticker", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } },
      patch: { tags: ["Watchlist"], security: [{ bearerAuth: [] }], summary: "Update buy price", parameters: [{ name: "ticker", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } },
    },

    "/api/alerts": {
      get: { tags: ["Alerts"], security: [{ bearerAuth: [] }], summary: "List price alerts", responses: { "200": { description: "OK" } } },
      post: { tags: ["Alerts"], security: [{ bearerAuth: [] }], summary: "Create price alert", responses: { "201": { description: "Created" } } },
    },
    "/api/alerts/check": { post: { tags: ["Alerts"], security: [{ bearerAuth: [] }], summary: "Evaluate alerts now", responses: { "200": { description: "OK" } } } },
    "/api/alerts/{id}": { delete: { tags: ["Alerts"], security: [{ bearerAuth: [] }], summary: "Delete alert", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },

    "/api/notifications": { get: { tags: ["Notifications"], security: [{ bearerAuth: [] }], summary: "List notifications + unread count", responses: { "200": { description: "OK" } } } },

    "/api/paper": { get: { tags: ["Paper Trading"], security: [{ bearerAuth: [] }], summary: "Paper account + positions", responses: { "200": { description: "OK" } } } },
    "/api/paper/trade": { post: { tags: ["Paper Trading"], security: [{ bearerAuth: [] }], summary: "Buy/sell at live price", responses: { "200": { description: "OK" } } } },
    "/api/paper/reset": { post: { tags: ["Paper Trading"], security: [{ bearerAuth: [] }], summary: "Reset to $100k", responses: { "200": { description: "OK" } } } },

    "/api/query": { post: { tags: ["Reports"], security: [{ bearerAuth: [] }], summary: "Run AI Brief (rate-limited)", responses: { "200": { description: "OK" } } } },
    "/api/reports": { get: { tags: ["Reports"], security: [{ bearerAuth: [] }], summary: "List saved reports", responses: { "200": { description: "OK" } } } },
    "/api/reports/{id}": { get: { tags: ["Reports"], security: [{ bearerAuth: [] }], summary: "Get report", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
    "/api/reports/{id}/share": { post: { tags: ["Reports"], security: [{ bearerAuth: [] }], summary: "Publish public share slug", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "slug" } } } },
    "/api/public/report/{slug}": { get: { tags: ["Public"], summary: "Read shared report (no auth)", parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" }, "404": { description: "Not found" } } } },
  },
} as const;

export const swaggerHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FINITY API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({ url: "/api/openapi.json", dom_id: "#swagger-ui" });
    };
  </script>
</body>
</html>`;
