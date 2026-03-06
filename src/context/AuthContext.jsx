import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hardwareInfo, setHardwareInfo] = useState(null);

  useEffect(() => {
    // Check stored auth
    const token = localStorage.getItem('auth_token');
    const storedUser = localStorage.getItem('auth_user');
    if (token && storedUser) {
      api.setToken(token);
      setUser(JSON.parse(storedUser));
    }
    setLoading(false);

    // Get hardware info
    getHardwareInfo();
  }, []);

  async function getHardwareInfo() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const info = await invoke('get_hardware_id');
      setHardwareInfo(info);
    } catch (e) {
      // Fallback for dev (browser)
      setHardwareInfo({
        hardware_id: 'dev-' + Math.random().toString(36).substring(7),
        os: navigator.platform,
        device_name: 'Dev Machine',
      });
    }
  }

  async function login(email, password) {
    if (!hardwareInfo) throw new Error('Hardware info not available');
    const data = await api.login(email, password, hardwareInfo.hardware_id, hardwareInfo.device_name, hardwareInfo.os);
    api.setToken(data.token);
    setUser(data.user);
    localStorage.setItem('auth_user', JSON.stringify(data.user));
    return data;
  }

  async function register(name, email, password) {
    if (!hardwareInfo) throw new Error('Hardware info not available');
    const data = await api.register(name, email, password, hardwareInfo.hardware_id, hardwareInfo.device_name, hardwareInfo.os);
    api.setToken(data.token);
    setUser(data.user);
    localStorage.setItem('auth_user', JSON.stringify(data.user));
    return data;
  }

  function logout() {
    api.clearToken();
    setUser(null);
    localStorage.removeItem('auth_user');
  }

  return (
    <AuthContext.Provider value={{ user, loading, hardwareInfo, login, register, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
