# Middleware Layer — HTTP Request Processing

**Responsibility**: Cross-cutting concerns applied to incoming HTTP requests before they reach route handlers.

Files: `auth.js`

---

## Meta Model

| Permitted | Prohibited |
|-----------|------------|
| Inspecting and validating request headers | Business logic or DB access |
| Attaching derived data to `req` (e.g. `req.user`) | Modifying response bodies directly (use `next(err)` instead) |
| Short-circuiting with `res.status(4xx)` for auth failures | Calling geometry or scene store functions |

## auth.js — JWT Authentication

Phase A policy: requests without a token are accepted in development.
Set `BFF_REQUIRE_AUTH=true` to enforce token validation.

| Condition | Behaviour |
|-----------|-----------|
| No `Authorization` header, `BFF_REQUIRE_AUTH` is unset | Allowed; `req.user = { sub: 'anonymous', role: 'dev' }` |
| No `Authorization` header, `BFF_REQUIRE_AUTH=true` | Rejected with `401 Unauthorised` |
| Valid `Bearer <token>` | Allowed; `req.user` populated from JWT claims |
| Invalid or expired token | Rejected with `401 Invalid token` |

**Secret**: `JWT_SECRET` environment variable (default: `'easy-extrude-dev-secret'`).
Override in production. A dev token is available from `GET /api/auth/token` (no credentials needed in Phase A).

**Phase B plan**: Replace with proper user auth via a User Service.
