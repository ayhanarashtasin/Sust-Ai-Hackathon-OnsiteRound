import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { LangContext, LANGS } from './i18n/index.js';
import TopBar from './components/TopBar.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AgentDetail from './pages/AgentDetail.jsx';
import CaseView from './pages/CaseView.jsx';

function Protected({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const [lang, setLang] = useState('en');
  return (
    <LangContext.Provider value={{ lang, t: LANGS[lang], setLang }}>
      <AuthProvider>
        <BrowserRouter>
          <TopBar />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Protected><Dashboard /></Protected>} />
            <Route path="/agent/:id" element={<Protected><AgentDetail /></Protected>} />
            <Route path="/case/:id" element={<Protected><CaseView /></Protected>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </LangContext.Provider>
  );
}
