import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import Icon from '../components/Icon';

export default function LoginPage() {
  const { login, register, hardwareInfo, setUser } = useAuth();
  const [tab, setTab] = useState('login'); // login | register | oauth
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthStatus, setOauthStatus] = useState('idle'); // idle | waiting
  const [authUrl, setAuthUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const pollingRef = useRef(null);
  const codeRef = useRef(null);

  // ── Email/Password Login ──
  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'login') {
        await login(email, password);
      } else {
        if (password !== confirmPassword) {
          setError('Passwords do not match');
          setLoading(false);
          return;
        }
        await register(name, email, password);
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  // ── Browser OAuth ──
  function generateCode() {
    const arr = new Uint8Array(24);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  async function handleOAuth() {
    if (!hardwareInfo) {
      setError('Hardware info not available. Please restart the app.');
      return;
    }
    setError('');
    setOauthStatus('waiting');
    const code = generateCode();
    codeRef.current = code;

    try {
      const data = await api.request('POST', '/auth/request-code', {
        code,
        hardware_id: hardwareInfo.hardware_id,
        device_name: hardwareInfo.device_name,
        os: hardwareInfo.os,
      });

      // Store URL and open in browser
      const authUrl = data.auth_url;
      setAuthUrl(authUrl);
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(authUrl);
      } catch (e1) {
        try {
          const { open } = await import('@tauri-apps/plugin-opener');
          await open(authUrl);
        } catch (e2) {
          // Final fallback
          window.open(authUrl, '_blank');
        }
      }

      // Start polling for token
      let attempts = 0;
      pollingRef.current = setInterval(async () => {
        attempts++;
        if (attempts > 100) {
          clearInterval(pollingRef.current);
          setOauthStatus('idle');
          setError('Authentication timed out. Please try again.');
          return;
        }
        try {
          const res = await api.request('GET', `/auth/check-code?code=${code}`);
          if (res.status === 'authenticated') {
            clearInterval(pollingRef.current);
            api.setToken(res.token);
            localStorage.setItem('auth_user', JSON.stringify(res.user));
            setUser(res.user);
          }
        } catch {
          // Keep polling
        }
      }, 3000);
    } catch (e) {
      setError(e.message);
      setOauthStatus('idle');
    }
  }

  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="icon-wrap"><Icon name="zap" size={22} color="#fff" /></div>
          <h1>Antigravity Lab</h1>
          <p>Access your Google AI Ultra accounts</p>
        </div>

        {/* Tab Switcher */}
        <div className="login-tabs">
          <button className={`login-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => { setTab('login'); setError(''); }}>Sign In</button>
          <button className={`login-tab ${tab === 'register' ? 'active' : ''}`} onClick={() => { setTab('register'); setError(''); }}>Sign Up</button>
          <button className={`login-tab ${tab === 'oauth' ? 'active' : ''}`} onClick={() => { setTab('oauth'); setError(''); }}>Browser</button>
        </div>

        {error && <div className="alert error"><Icon name="alertTriangle" size={14} /> {error}</div>}

        {/* Email/Password Form */}
        {(tab === 'login' || tab === 'register') && (
          <form onSubmit={handleSubmit}>
            {tab === 'register' && (
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input className="form-control" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="John Doe" required />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-control" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-control" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
            {tab === 'register' && (
              <div className="form-group">
                <label className="form-label">Confirm Password</label>
                <input className="form-control" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••" required />
              </div>
            )}
            <button className="btn btn-primary btn-block" type="submit" disabled={loading} style={{ marginTop: 8, padding: 12 }}>
              {loading ? <div className="spinner" /> : tab === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        )}

        {/* Browser OAuth */}
        {tab === 'oauth' && (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.8 }}>
              Authenticate via your dashboard login. Choose your preferred method:
            </p>

            {/* Two primary action buttons — always visible */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button className="btn btn-primary" style={{ flex: 1, padding: '14px 12px', flexDirection: 'column', gap: 4 }} onClick={handleOAuth} disabled={oauthStatus === 'waiting'}>
                {oauthStatus === 'waiting' ? <div className="spinner" /> : <><Icon name="globe" size={16} /> Open in Browser</>}
              </button>
              <button className="btn btn-outline" style={{ flex: 1, padding: '14px 12px' }} onClick={async () => {
                if (authUrl) {
                  navigator.clipboard.writeText(authUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                  return;
                }
                // Generate URL first, then copy
                if (!hardwareInfo) { setError('Hardware info not available.'); return; }
                setError('');
                const code = generateCode();
                codeRef.current = code;
                try {
                  const data = await api.request('POST', '/auth/request-code', {
                    code, hardware_id: hardwareInfo.hardware_id,
                    device_name: hardwareInfo.device_name, os: hardwareInfo.os,
                  });
                  setAuthUrl(data.auth_url);
                  setOauthStatus('waiting');
                  navigator.clipboard.writeText(data.auth_url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                  // Start polling
                  let attempts = 0;
                  pollingRef.current = setInterval(async () => {
                    attempts++;
                    if (attempts > 100) { clearInterval(pollingRef.current); setOauthStatus('idle'); setError('Timed out.'); return; }
                    try {
                      const res = await api.request('GET', `/auth/check-code?code=${code}`);
                      if (res.status === 'authenticated') {
                        clearInterval(pollingRef.current);
                        api.setToken(res.token);
                        localStorage.setItem('auth_user', JSON.stringify(res.user));
                        setUser(res.user);
                      }
                    } catch {}
                  }, 3000);
                } catch (e) { setError(e.message); }
              }}>
                {copied ? <><Icon name="check" size={14} /> Copied!</> : <><Icon name="copy" size={14} /> Copy Auth Link</>}
              </button>
            </div>

            {/* Show URL if generated */}
            {authUrl && (
              <div style={{ background: 'var(--bg-input)', borderRadius: 8, padding: '10px 12px', border: '1px solid var(--border)', textAlign: 'left', marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Paste this in the browser where you're logged in:</div>
                <input className="form-control" readOnly value={authUrl} onClick={e => e.target.select()} style={{ fontSize: 11, padding: '6px 8px', fontFamily: 'monospace' }} />
              </div>
            )}

            {oauthStatus === 'waiting' && (
              <div style={{ marginTop: 4 }}>
                <div className="spinner" style={{ width: 20, height: 20, margin: '8px auto', borderWidth: 2 }} />
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Waiting — log in on the browser page, this app detects it automatically.
                </p>
                <button className="btn btn-outline btn-sm" onClick={() => { clearInterval(pollingRef.current); setOauthStatus('idle'); setAuthUrl(''); setCopied(false); }}>
                  Cancel
                </button>
              </div>
            )}

            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 16 }}>
              Tip: Use "Copy Auth Link" if you want to paste it into a specific browser.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
