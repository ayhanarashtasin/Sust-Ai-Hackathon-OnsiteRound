import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api, realtimeOrigin } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!user || !token) return undefined;
    const options = { auth: { token }, transports: ['websocket'] };
    const socket = realtimeOrigin ? io(realtimeOrigin, options) : io(options);
    socket.on('data-updated', () => window.dispatchEvent(new Event('sust:data-updated')));
    return () => socket.disconnect();
  }, [user?.id, user?.role]);

  async function login(email, password) {
    const { token, user } = await api.login(email, password);
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    setUser(user);
    return user;
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
