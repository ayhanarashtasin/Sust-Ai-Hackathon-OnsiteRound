import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { LangContext, LANGS, useLang } from './i18n/index.js';
import TopBar from './components/TopBar.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AgentDetail from './pages/AgentDetail.jsx';
import CaseView from './pages/CaseView.jsx';
import ServiceStatus from './pages/ServiceStatus.jsx';

function Protected({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

function NotFound() {
  const { t } = useLang();
  return (
    <div className="page" style={{ textAlign: 'center', paddingTop: 60 }}>
      <h2>404 — {t.notFound}</h2>
      <Link to="/"><button className="primary" style={{ marginTop: 12 }}>{t.goHome}</button></Link>
    </div>
  );
}

export default function App() {
  // Language survives reloads
  const [lang, setLangState] = useState(() => {
    const saved = localStorage.getItem('lang');
    if (saved === 'bn') return 'bn';
    if (saved === 'banglish') return 'banglish';
    return 'en';
  });
  const setLang = (l) => {
    if (l === 'en') {
      localStorage.setItem('lang', 'en');
      setLangState('en');
    } else if (l === 'bn') {
      localStorage.setItem('lang', 'bn');
      setLangState('bn');
    } else if (l === 'banglish') {
      localStorage.setItem('lang', 'banglish');
      setLangState('banglish');
    }
  };
  return (
    <LangContext.Provider value={{ lang, t: LANGS[lang], setLang }}>
      <AuthProvider>
        <BrowserRouter>
          <TopBar />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/service-status" element={<ServiceStatus />} />
            <Route path="/" element={<Protected><Dashboard /></Protected>} />
            <Route path="/agent/:id" element={<Protected><AgentDetail /></Protected>} />
            <Route path="/case/:id" element={<Protected><CaseView /></Protected>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </LangContext.Provider>
  );
}
