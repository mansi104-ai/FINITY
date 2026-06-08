# Security Policy

## Overview
FINDEC implements defense-in-depth security practices across authentication, data protection, and infrastructure. This document outlines our security model and recommendations for deployment.

---

## Authentication & Tokens

### JWT Token Model
- **Access Tokens**: 15-minute TTL (short-lived), signed with `JWT_SECRET`
  - Stored in memory by client, sent on every protected request
  - Invalidated on user logout or session revocation
  - Token version tracking prevents reuse after password change

- **Refresh Tokens**: 7-day TTL (long-lived), signed with `JWT_REFRESH_SECRET`
  - Stored in secure `httpOnly` cookies (not accessible to JavaScript)
  - Single-use rotation: each `/api/auth/refresh` issues a new token
  - Revoked tokens tracked in MongoDB (TTL index auto-cleanup after 7 days)
  - If stolen, attacker can only refresh once before invalidation detected

### Session Model
- Each (user, device) pair gets one active session
- Session ID shared by access + refresh tokens
- Revoking a session invalidates both tokens immediately
- Token version mismatch after password change = automatic logout

---

## Secret Management

### CRITICAL: In Production

**All three secrets must be present as environment variables:**
```bash
JWT_SECRET="<32+ random characters>"
JWT_REFRESH_SECRET="<32+ random characters, DIFFERENT from above>"
MONGODB_URI="mongodb+srv://user:pass@cluster..."
```

Generate secrets with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**The server will FAIL TO START in production if secrets are missing.** This is intentional.

### Secrets Rotation (Emergency)
If `JWT_SECRET` is compromised:
1. Set new `JWT_SECRET` in environment
2. Increment all users' `tokenVersion`
3. Revoke all active sessions
4. All users must re-login

---

## HTTPS & Transport Security

### Production Requirements
- **HTTPS Only**: Server redirects HTTP→HTTPS when behind reverse proxy
- **Secure Cookies**: `secure` flag set in production
- **HSTS**: Recommended in reverse proxy config (e.g., nginx)
  ```nginx
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  ```
- **Certificate Pinning**: Optional but recommended for mobile apps

---

## CORS & Cross-Origin Requests

### Origin Validation
- In development: `CORS_ORIGIN=*` (allow all)
- In production: `CORS_ORIGIN="https://app.example.com,https://www.example.com"`

If origin not whitelisted:
- Request rejected with 403 error
- Rejection logged (include origin for debugging)
- No credentials sent

### Protected Endpoints
All `/api/*` routes (except `/health`, `/market/snapshot`, `/market/stocks`, etc.) require authentication.

---

## Rate Limiting

### Configured Limits
- **Auth**: 10 attempts per IP per 15 minutes (login + register + refresh)
- **Queries**: 10 AI Brief queries per user per hour
- **Custom**: Extend via `QUERY_LIMIT_PER_HOUR` and `AUTH_ATTEMPTS_PER_15_MINUTES` env vars

### Rate Limit Responses
- **429 Too Many Requests** - includes `Retry-After` header
- **In-Memory Cleanup**: Expired entries purged every 5 minutes (prevents memory leak)

---

## Data Protection

### At Rest
- **MongoDB**: Stored as-is (use MongoDB Encryption at Rest in Atlas)
- **Passwords**: Hashed with bcryptjs (salt rounds = 10)
- **Sessions**: Stored with TTL index (auto-deleted after expiry)
- **PII**: Minimal—only email stored; market data is public

### In Transit
- **HTTPS Only**: All client↔server communication encrypted (TLS 1.3+)
- **No Logs of Credentials**: Passwords never logged; auth errors sanitized
- **Request ID Tracking**: All logs tagged with `X-Request-ID` for audit trail

---

## Input Validation

### Validation Strategy
1. **Zod Schema Validation**: All POST/PATCH bodies validated on server
2. **Type Safety**: TypeScript strict mode prevents type confusion
3. **SQL Injection**: Not applicable (using MongoDB with typed documents)
4. **XSS Prevention**: React escapes by default; no `dangerouslySetInnerHTML`

### Email Validation
- RFC 5321 format via Zod (max 320 chars)
- Normalized to lowercase before storage
- Unique constraint at DB level

### Ticker Validation
- Regex: `^[A-Z][A-Z0-9.-]{0,14}$` (e.g., "AAPL", "RELIANCE.NS", "BRK.A")
- Whitelist of 60+ symbols per market
- Prevents SQL injection or API abuse

---

## Error Handling

### Error Response Model
```json
{
  "error": "Human-readable error",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-06-08T12:37:19.746Z"
}
```

### Internal Errors (5XX)
- No stack traces sent to client
- Request ID included for server-side correlation
- Full error logged server-side with context (method, path, userId, etc.)

### Auth Errors
- 401 Unauthorized: Missing/invalid/expired token
- 403 Forbidden: Valid token but insufficient permissions
- Detailed error messages only in dev; generic in prod

---

## Dependency Security

### Pinned Versions
- All dependencies pinned (no `^` ranges) for reproducibility
- Automated scanning via Dependabot (GitHub)
- Regular updates: monthly patch+minor, quarterly major

### High-Risk Dependencies
- `bcryptjs`: Password hashing (no alternatives better)
- `jsonwebtoken`: Token signing (standard, mature)
- `express`: Web framework (de facto standard)
- `mongodb`: Database driver (official)

---

## Infrastructure & Deployment

### Vercel (Recommended)
- ✅ HTTPS auto-configured + renewed
- ✅ DDoS protection at edge
- ✅ Automatic security patches
- ⚠️ Ensure `TRUST_PROXY=true` for IP-based rate limiting

### Self-Hosted (e.g., AWS EC2)
Required security setup:
- [ ] Reverse proxy (nginx/HAProxy) with HSTS + TLS 1.3+
- [ ] WAF (Web Application Firewall) for DDoS protection
- [ ] VPC with security groups (restrict inbound to HTTPS only)
- [ ] MongoDB in private subnet (not public internet)
- [ ] Secrets manager (AWS Secrets Manager / HashiCorp Vault)
- [ ] Error tracking (Sentry / DataDog)
- [ ] Log aggregation (CloudWatch / ELK)

---

## Monitoring & Incident Response

### Health Checks
- Server exposes `/api/health` (no auth required)
- Includes DB connectivity status, config flags
- Use to monitor uptime and auto-failover

### Logs to Monitor
```json
{
  "timestamp": "...",
  "requestId": "...",
  "method": "POST",
  "path": "/api/auth/login",
  "error": "Too many authentication attempts",
  "stack": "..."
}
```

### Alert on:
- High error rate (>1% of requests)
- Database connection failures
- Spike in 429 rate limit responses
- Failed auth attempts from single IP

---

## Known Limitations

1. **No 2FA**: Current design supports TOTP; not yet implemented
2. **No OAuth**: Email-password only; social login future feature
3. **No Mobile Certificate Pinning**: Client can be MitM'd on untrusted networks
4. **No API Key Auth**: Only JWT; API keys for 3rd-party integrations future
5. **No Field-Level Encryption**: Relies on HTTPS + MongoDB encryption

---

## Reporting Security Issues

**Do not open public GitHub issues for security vulnerabilities.**

Contact the maintainers privately:
- 📧 Email: security@findec.example.com (configure this)
- OR create a private GitHub Security Advisory

Response time: 48 hours

---

## References

- [OWASP Top 10](https://owasp.org/Top10/)
- [JWT Best Practices](https://tools.ietf.org/html/rfc7519)
- [MongoDB Security](https://docs.mongodb.com/manual/security/)
- [Express.js Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
