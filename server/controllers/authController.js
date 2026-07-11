import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

/*
  STAFF console authentication only. This is NOT customer wallet auth —
  no PIN/OTP is ever requested anywhere in this system (brief §14 guardrail).
*/
function sign(user) {
  return jwt.sign(
    { id: user._id.toString(), name: user.name, role: user.role, area: user.area, providerScope: user.providerScope, agentId: user.agentId },
    process.env.JWT_SECRET || 'change-me-demo-secret',
    { expiresIn: '12h' }
  );
}

export async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = await User.findOne({ email: String(email).toLowerCase() });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({ token: sign(user), user: { name: user.name, role: user.role, area: user.area, providerScope: user.providerScope, agentId: user.agentId } });
}

export async function me(req, res) {
  res.json({ user: req.user });
}
