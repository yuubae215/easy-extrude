/**
 * JWT auth middleware (Phase A — dev-friendly).
 *
 * Phase A policy: requests without a token are accepted in development
 * (BFF_REQUIRE_AUTH=true to enforce). A dev token can be obtained via
 * GET /api/auth/token (no credentials needed in Phase A).
 *
 * In Phase B, proper user auth (User Service) will replace this.
 */
import jwt from 'jsonwebtoken'

export const JWT_SECRET = process.env.JWT_SECRET ?? 'easy-extrude-dev-secret'
const REQUIRE_AUTH = process.env.BFF_REQUIRE_AUTH === 'true'

/**
 * Verifies Bearer JWT. Attaches `req.user` if present.
 * Rejects with 401 only when BFF_REQUIRE_AUTH=true.
 */
export function jwtMiddleware(req, res, next) {
  const header = req.headers['authorization'] ?? ''
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) {
    if (REQUIRE_AUTH) return res.status(401).json({ error: 'Unauthorised' })
    req.user = { sub: 'anonymous', role: 'dev' }
    return next()
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}
