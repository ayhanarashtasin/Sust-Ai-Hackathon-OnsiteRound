import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../i18n/index.js';

export default function Login() {
  const { login } = useAuth();
  const { t } = useLang();
  const nav = useNavigate();
  const [email, setEmail] = useState('field@demo.test');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    try {
      await login(email, password);
      nav('/');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="login-box" onSubmit={submit}>
      <h2>{t.login}</h2>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.email} autoComplete="username" />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t.password} autoComplete="current-password" />
      {error && <div className="error">{error}</div>}
      <button className="primary" type="submit">{t.login}</button>
      {/* Guardrail note: staff console only — never customer wallet credentials */}
      <div className="login-note">🛡 {t.loginNote}</div>
      <div className="demo-accounts">
        <strong>Demo accounts</strong> (password: demo1234)<br />
        agent@demo.test — agent view<br />
        field@demo.test — field officer (receives liquidity alerts)<br />
        ops@demo.test — provider operations<br />
        risk@demo.test — risk analyst (escalations)<br />
        mgmt@demo.test — management (read-only)
      </div>
    </form>
  );
}
