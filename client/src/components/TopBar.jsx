import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../i18n/index.js';

export default function TopBar() {
  const { user, logout } = useAuth();
  const { t, lang, setLang } = useLang();
  return (
    <div className="topbar">
      <Link to="/"><h1>🏦 {t.appTitle}</h1></Link>
      <span className="badge-sim">{t.simulated}</span>
      <Link to="/service-status"><button>{t.serviceStatus}</button></Link>
      {user && <span className="badge-role">{user.name} · {user.role}</span>}
      <select value={lang} onChange={(e) => setLang(e.target.value)}>
        <option value="en">EN</option>
        <option value="bn">বাংলা</option>
        <option value="banglish">Banglish</option>
      </select>
      {user && <button onClick={logout}>{t.logout}</button>}
    </div>
  );
}
