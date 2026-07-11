import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { jwtSecret } from '../middleware/auth.js';

/*
  STAFF console authentication only. This is NOT customer wallet auth —
  no PIN/OTP is ever requested anywhere in this system (brief §14 guardrail).
*/
function sign(user) {
  return jwt.sign(
    { id: user._id.toString(), name: user.name, role: user.role, area: user.area, providerScope: user.providerScope, agentId: user.agentId },
    jwtSecret(),
    { expiresIn: '12h' }
  );
}

/*
  In-memory login throttle: 10 failures per email+IP per 15 minutes → 429.
  Enough to stop naive credential guessing on a demo box without a dependency.
*/
const FAIL_LIMIT = 10;
const FAIL_WINDOW_MS = 15 * 60_000;
const failures = new Map(); // key -> [timestamps]

function throttled(key) {
  const cutoff = Date.now() - FAIL_WINDOW_MS;
  const recent = (failures.get(key) || []).filter((t) => t > cutoff);
  failures.set(key, recent);
  return recent.length >= FAIL_LIMIT;
}

export async function login(req, res) {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  const key = `${req.ip}:${email.toLowerCase()}`;
  if (throttled(key)) return res.status(429).json({ error: 'Too many failed attempts — try again later' });

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    failures.get(key).push(Date.now()); // throttled() guarantees the entry exists
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  failures.delete(key);
  res.json({ token: sign(user), user: { name: user.name, role: user.role, area: user.area, providerScope: user.providerScope, agentId: user.agentId } });
}

export async function me(req, res) {
  res.json({ user: req.user });
}
