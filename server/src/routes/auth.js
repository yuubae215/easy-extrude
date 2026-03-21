/**
 * Auth routes (Phase A — dev token only).
 *
 * GET /api/auth/token   — returns a signed dev JWT (no credentials required).
 *
 * In Phase B this will be replaced by proper user registration / login
 * delegated to the User Service.
 */
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../middleware/auth.js'

export const authRouter = Router()

// GET /api/auth/token  (Phase A dev helper)
authRouter.get('/token', (_req, res) => {
  const token = jwt.sign(
    { sub: 'dev-user', role: 'dev' },
    JWT_SECRET,
    { expiresIn: '7d' },
  )
  res.json({ token })
})
