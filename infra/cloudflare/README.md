# Cloudflare (DNS · WAF · Pages · R2)

Reference notes only — no secrets, no runnable IaC. See the V1 Architecture
and the Implementation Blueprint (section 17) for the full sequence.

## Pages (frontend)

- Static SPA build from `apps/web`
- SPA fallback to `index.html` for client-side routing
- `_headers` / `_redirects` live in `apps/web/public` once the frontend
  ships routes (Sprint 1 has none yet)

## WAF / rate limiting

- Rate limits apply to `/auth/*` and `/p/*` (public QR ordering) —
  configured in the Cloudflare dashboard, not checked into this repo
- CSP: `default-src 'self'; img-src 'self' <r2 host>; script-src 'self'`;
  `X-Frame-Options: DENY` except `/print/*`

## R2 (image storage)

- Private bucket, pre-signed PUT for uploads
- Consumed by the `storage` module (not implemented in Sprint 1)

## Not part of Sprint 1 / Gate 1

No Cloudflare resources are provisioned by this repository. This is
documentation only, staged for Gate 14.
