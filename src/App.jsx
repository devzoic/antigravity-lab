import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import SessionGuard from './components/SessionGuard';
import UpdateBanner, { APP_VERSION } from './components/UpdateBanner';
import Icon from './components/Icon';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';

import SettingsPage from './pages/SettingsPage';
import './App.css';

function Sidebar({ currentPage, setPage }) {
  const { user, logout } = useAuth();

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', section: 'main' },
    { id: 'settings', label: 'Settings', icon: 'settings', section: 'system' },
  ];

  const sections = {
    main: 'Overview',
    system: 'System',
  };

  let lastSection = '';

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="brand-icon">
          <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
            <defs><linearGradient id="sg" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stopColor="#00d68f"/><stop offset="100%" stopColor="#4285F4"/></linearGradient></defs>
            <path d="M16 4 L16 24" stroke="url(#sg)" strokeWidth="3" strokeLinecap="round"/>
            <path d="M9 14 L16 6 L23 14" stroke="url(#sg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            <ellipse cx="16" cy="22" rx="8" ry="3" stroke="url(#sg)" strokeWidth="1.5" fill="none" opacity="0.5"/>
          </svg>
        </div>
        <div className="brand-text">
          <span className="brand-name">Antigravity <span className="brand-accent">Lab</span></span>
          <span className="brand-version">v{APP_VERSION}</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <ul style={{ listStyle: 'none' }}>
          {navItems.map(item => {
            const showSection = item.section !== lastSection;
            lastSection = item.section;
            return (
              <div key={item.id}>
                {showSection && <li className="nav-heading">{sections[item.section]}</li>}
                <li className="nav-item">
                  <a
                    href="#"
                    className={currentPage === item.id ? 'active' : ''}
                    onClick={e => { e.preventDefault(); setPage(item.id); }}
                  >
                    <Icon name={item.icon} size={18} />
                    <span>{item.label}</span>
                  </a>
                </li>
              </div>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="avatar">{user?.name?.[0]?.toUpperCase() || 'U'}</div>
          <div className="user-meta">
            <div className="name">{user?.name || 'User'}</div>
            <div className="email">{user?.email || ''}</div>
          </div>
        </div>
        <div className="nav-item" style={{ marginTop: 6 }}>
          <button onClick={logout} className="logout-btn">
            <Icon name="logout" size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

function AppContent() {
  const { user, loading } = useAuth();
  const [currentPage, setPage] = useState('dashboard');

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const pages = {
    dashboard: <DashboardPage />,
    settings: <SettingsPage />,
  };
  return (
    <div className="app-layout">
      <UpdateBanner />
      <Sidebar currentPage={currentPage} setPage={setPage} />
      <main className="main-content">
        {currentPage === 'dashboard' && <DashboardPage setPage={setPage} />}
        {currentPage === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SessionGuard>
        <AppContent />
      </SessionGuard>
    </AuthProvider>
  );
}
