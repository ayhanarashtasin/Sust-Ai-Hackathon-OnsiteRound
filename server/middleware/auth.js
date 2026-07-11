import jwt from 'jsonwebtoken';

/*
  JWT secret is REQUIRED — no hard-coded fallback. A demo signed with a
  publicly known secret is a forged-token vector; fail fast with a clear
  message instead (copy .env.example → server/.env to get one).
*/
export function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[auth] JWT_SECRET is not set. Copy .env.example to server/.env and set JWT_SECRET.');
    process.exit(1);
  }
  return secret;
}

export function verifyToken(token) {
  return jwt.verify(token, jwtSecret());
}

/* Staff console JWT — verifies token, attaches req.user = { id, name, role, area, providerScope, agentId } */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'Insufficient role' });
    next();
  };
}

/*
  Express 4 does not catch async handler rejections — an awaited DB call that
  fails (e.g. a transient Atlas DNS error) would crash the whole process.
  Route through the central error handler instead: fail the request, not the server.
*/
export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
