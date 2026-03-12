import { useState, useEffect } from 'react';
import api from '../services/api';
import Icon from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { invoke } from '@tauri-apps/api/core';

export default function DashboardPage() {
  const { user, hardwareInfo } = useAuth();
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeEmail, setActiveEmail] = useState('');
  const [activating, setActivating] = useState(null);
  const [activateMsg, setActivateMsg] = useState('');

  async function activateAccount(acc) {
    if (!acc?.id || !acc?.email) return;
    setActivating(acc.id); setActivateMsg(''); setError('');
    try {
      const tokenData = await api.getAccountToken(acc.id, hardwareInfo?.hardware_id);
      const tokenRequest = {
        access_token: tokenData.access_token,
        refresh_token: 'proxy-managed',
        expiry: tokenData.expires_at || Math.floor(Date.now() / 1000) + 3600,
        email: acc.email,
      };
      try {
        const result = await invoke('switch_and_restart_antigravity', { request: tokenRequest });
        setActiveEmail(acc.email);
        setActivateMsg(result.success
          ? `✓ ${acc.email} activated — Antigravity restarted`
          : `✓ ${acc.email} activated. ${result.message || 'Restart Antigravity manually.'}`);
      } catch {
        await invoke('inject_antigravity_token', { request: tokenRequest });
        setActiveEmail(acc.email);
        setActivateMsg(`✓ ${acc.email} token injected — restart Antigravity manually`);
      }
    } catch (e) {
      setError(`Failed to activate: ${e.message || e}`);
    }
    setActivating(null);
    setTimeout(() => setActivateMsg(''), 5000);
  }

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getCurrentQuota();
        setQuota(data);
      } catch (e) {
        setError(e.message);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
      </div>
    );
  }

  const sub = quota?.subscription;
  const plan = quota?.plan;
  const accounts = quota?.accounts || [];
  const greeting = getGreeting();
  const daysPercent = sub ? Math.max(0, Math.min(100, (sub.days_remaining / 30) * 100)) : 0;

  return (
    <div className="dash-redesign animate-fade-in">

      {/* ── Hero Welcome Banner ── */}
      <div className="dash-hero">
        <div className="hero-glow"></div>
        <div className="hero-content">
          <div className="hero-text">
            <span className="hero-greeting">{greeting}</span>
            <h1 className="hero-name">{user?.name || 'Guest'}</h1>
            <p className="hero-sub">
              {sub ? (
                <>Your <strong>{plan?.name}</strong> subscription is {sub.status === 'active' ? 'active and running' : 'currently paused'}.</>
              ) : 'Get started by choosing a subscription plan.'}
            </p>
          </div>
          {sub && (
            <div className="hero-ring-wrap">
              <svg className="hero-ring" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
                <circle cx="60" cy="60" r="52" fill="none" stroke="url(#ringGrad)" strokeWidth="8"
                  strokeLinecap="round" strokeDasharray={`${daysPercent * 3.27} 327`}
                  transform="rotate(-90 60 60)" style={{ transition: 'stroke-dasharray 1s ease' }} />
                <defs>
                  <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#00d68f" />
                    <stop offset="100%" stopColor="#4285F4" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="ring-label">
                <span className="ring-number">{sub.days_remaining ?? '—'}</span>
                <span className="ring-unit">days left</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Stats Cards ── */}
      {sub && (
        <div className="dash-stats-row">
          <div className="dash-stat-card">
            <div className="dstat-icon" style={{ background: 'rgba(66,133,244,0.1)' }}>
              <Icon name="package" size={20} color="#4285F4" />
            </div>
            <div className="dstat-body">
              <span className="dstat-label">Plan</span>
              <span className="dstat-value">{plan?.name}</span>
            </div>
          </div>
          <div className="dash-stat-card">
            <div className="dstat-icon" style={{ background: 'rgba(0,214,143,0.1)' }}>
              <Icon name="key" size={20} color="#00d68f" />
            </div>
            <div className="dstat-body">
              <span className="dstat-label">Active Accounts</span>
              <span className="dstat-value">{accounts.length}<span className="dstat-dim"> / {plan?.max_accounts}</span></span>
            </div>
          </div>
          <div className="dash-stat-card">
            <div className="dstat-icon" style={{ background: sub.status === 'active' ? 'rgba(0,214,143,0.1)' : 'rgba(255,77,106,0.1)' }}>
              <Icon name="shield" size={20} color={sub.status === 'active' ? '#00d68f' : '#ff4d6a'} />
            </div>
            <div className="dstat-body">
              <span className="dstat-label">System</span>
              <span className="dstat-value" style={{ color: sub.status === 'active' ? '#00d68f' : '#ff4d6a' }}>
                {sub.status === 'active' ? 'Operational' : 'Inactive'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Accounts & Quota Section ── */}
      {accounts.length > 0 && (
        <div className="dash-accounts-section">
          <div className="dash-section-head">
            <div className="section-title-group">
              <h3>AI Accounts</h3>
              <span className="section-count">{accounts.length}</span>
            </div>
            <span className="section-live"><span className="live-dot"></span> Live</span>
          </div>

          <div className="dash-account-grid">
            {accounts.map((acc, i) => (
              <div className="dash-acc-card" key={i}>
                {/* Top stripe */}
                <div className={`acc-card-stripe ${acc.status}`}></div>

                {/* Header */}
                <div className="acc-card-header">
                  <div className="acc-card-avatar">
                    <span>G</span>
                  </div>
                  <div className="acc-card-identity">
                    <div className="acc-card-name">
                      {acc.display_name || acc.email?.split('@')[0]}
                      <span className={`acc-dot ${acc.status}`}></span>
                    </div>
                    <div className="acc-card-email">{acc.email}</div>
                  </div>
                  <div className="acc-card-type">
                    <span className={`type-chip ${(acc.account_type || 'free').toLowerCase()}`}>
                      {acc.subscription_tier || acc.account_type || 'Free'}
                    </span>
                  </div>
                </div>

                {/* Quota Grid */}
                <div className="acc-card-quota">
                  {acc.quota_models && acc.quota_models.length > 0 ? (
                    <div className="quota-visual-grid">
                      {acc.quota_models.slice(0, 6).map((model, idx) => {
                        const pct = model.percentage;
                        const name = shortModelName(model.name, model.display_name);
                        const color = pct < 20 ? '#ff4d6a' : pct < 50 ? '#ffb020' : pct < 80 ? '#4285F4' : '#00d68f';
                        return (
                          <div key={idx} className="qv-item">
                            <div className="qv-top">
                              <span className="qv-name">{name}</span>
                              <span className="qv-pct" style={{ color }}>{pct}%</span>
                            </div>
                            <div className="qv-track">
                              <div className="qv-fill" style={{ width: `${pct}%`, background: color }}></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="quota-empty">
                      <Icon name="cloud" size={16} color="rgba(255,255,255,0.2)" />
                      <span>Sync quota from Accounts page</span>
                    </div>
                  )}
                </div>

                {/* Use in Antigravity */}
                {acc.status === 'active' && (
                  <div className="dash-activate-section">
                    <button
                      className={`dash-use-btn ${activeEmail === acc.email ? 'is-active' : ''}`}
                      onClick={() => activateAccount(acc)}
                      disabled={activating === acc.id}
                    >
                      {activating === acc.id ? (
                        <><div className="btn-spinner" /> Activating...</>
                      ) : activeEmail === acc.email ? (
                        <><Icon name="check" size={14} /> Active in Antigravity</>
                      ) : (
                        <><Icon name="zap" size={14} /> Use in Antigravity</>
                      )}
                    </button>
                  </div>
                )}

                {/* Footer */}
                <div className="acc-card-footer">
                  <div className="acc-footer-stat">
                    {activeEmail === acc.email ? (
                      <><span className="ag-active-badge"><Icon name="zap" size={11} color="#00d68f" /> Active in AG</span></>
                    ) : (
                      <><Icon name="activity" size={12} color="rgba(255,255,255,0.3)" />
                      <span className={acc.status === 'active' ? 'ft-active' : 'ft-limited'}>
                        {acc.status === 'active' ? 'Ready' : 'Limited'}
                      </span></>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── No Subscription CTA ── */}
      {!sub && (
        <div className="dash-cta-card">
          <div className="cta-bg-icon"><Icon name="zap" size={120} color="rgba(0,214,143,0.04)" /></div>
          <div className="cta-inner">
            <div className="cta-icon-wrap">
              <Icon name="star" size={28} color="#00d68f" />
            </div>
            <h3>Ignite Your Workflow</h3>
            <p>You don't have an active subscription yet. Choose a plan to unlock Google AI.</p>
            <button className="cta-btn">View Plans</button>
          </div>
        </div>
      )}

      {activateMsg && (
        <div className="dash-success">
          <Icon name="zap" size={16} /> {activateMsg}
        </div>
      )}

      {error && (
        <div className="dash-error">
          <Icon name="alertTriangle" size={16} /> {error}
        </div>
      )}

      <style>{`
        .dash-redesign { padding: 0; max-width: 1100px; margin: 0 auto; }

        /* ── Hero ── */
        .dash-hero {
          position: relative;
          background: linear-gradient(135deg, rgba(0,214,143,0.06) 0%, rgba(66,133,244,0.04) 50%, rgba(255,255,255,0.01) 100%);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 24px;
          padding: 36px 40px;
          margin-bottom: 28px;
          overflow: hidden;
        }
        .hero-glow {
          position: absolute; top: -40px; right: -40px;
          width: 200px; height: 200px;
          background: radial-gradient(circle, rgba(0,214,143,0.12) 0%, transparent 70%);
          pointer-events: none;
        }
        .hero-content { display: flex; align-items: center; justify-content: space-between; position: relative; z-index: 1; }
        .hero-greeting {
          font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.35);
          text-transform: uppercase; letter-spacing: 0.12em; display: block; margin-bottom: 6px;
        }
        .hero-name {
          font-size: 32px; font-weight: 800; margin: 0;
          background: linear-gradient(135deg, #fff 20%, rgba(255,255,255,0.5));
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          letter-spacing: -0.02em;
        }
        .hero-sub { font-size: 14px; color: rgba(255,255,255,0.4); margin-top: 8px; line-height: 1.5; }
        .hero-sub strong { color: var(--primary); font-weight: 700; }

        /* Ring */
        .hero-ring-wrap { position: relative; width: 120px; height: 120px; flex-shrink: 0; }
        .hero-ring { width: 100%; height: 100%; }
        .ring-label {
          position: absolute; inset: 0; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
        }
        .ring-number { font-size: 28px; font-weight: 800; color: #fff; line-height: 1; }
        .ring-unit { font-size: 10px; color: rgba(255,255,255,0.35); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }

        /* ── Stat Cards ── */
        .dash-stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 28px; }
        .dash-stat-card {
          display: flex; align-items: center; gap: 14px;
          background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 16px; padding: 20px 22px;
          transition: all 0.3s ease;
        }
        .dash-stat-card:hover { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.1); transform: translateY(-3px); }
        .dstat-icon { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .dstat-label { font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.3); text-transform: uppercase; letter-spacing: 0.08em; display: block; }
        .dstat-value { font-size: 20px; font-weight: 800; color: #fff; margin-top: 2px; display: block; }
        .dstat-dim { font-size: 14px; font-weight: 400; color: rgba(255,255,255,0.2); }

        /* ── Accounts Section ── */
        .dash-accounts-section { margin-top: 4px; }
        .dash-section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
        .section-title-group { display: flex; align-items: center; gap: 10px; }
        .section-title-group h3 { font-size: 18px; font-weight: 800; color: rgba(255,255,255,0.9); margin: 0; }
        .section-count {
          font-size: 11px; font-weight: 800; background: rgba(0,214,143,0.1); color: #00d68f;
          width: 24px; height: 24px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
        }
        .section-live { font-size: 11px; color: rgba(255,255,255,0.3); font-weight: 600; display: flex; align-items: center; gap: 6px; }
        .live-dot { width: 8px; height: 8px; border-radius: 50%; background: #00d68f; animation: pulse 2s infinite; }

        /* Account Cards Grid */
        .dash-account-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
        .dash-acc-card {
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 18px;
          overflow: hidden;
          transition: all 0.35s cubic-bezier(0.165, 0.84, 0.44, 1);
        }
        .dash-acc-card:hover { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.1); transform: translateY(-4px); box-shadow: 0 12px 40px rgba(0,0,0,0.2); }

        .acc-card-stripe { height: 3px; }
        .acc-card-stripe.active { background: linear-gradient(90deg, #00d68f, #4285F4); }
        .acc-card-stripe:not(.active) { background: rgba(255,255,255,0.06); }

        .acc-card-header { display: flex; align-items: center; padding: 18px 20px 12px; gap: 12px; }
        .acc-card-avatar {
          width: 40px; height: 40px; border-radius: 12px; flex-shrink: 0;
          background: linear-gradient(135deg, rgba(66,133,244,0.2), rgba(0,214,143,0.2));
          display: flex; align-items: center; justify-content: center;
          font-weight: 900; font-size: 16px; color: #fff;
        }
        .acc-card-identity { flex: 1; min-width: 0; }
        .acc-card-name {
          font-size: 14px; font-weight: 700; color: #fff;
          display: flex; align-items: center; gap: 8px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .acc-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .acc-dot.active { background: #00d68f; box-shadow: 0 0 8px rgba(0,214,143,0.5); }
        .acc-card-email { font-size: 11px; color: rgba(255,255,255,0.3); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .acc-card-type { flex-shrink: 0; }
        .type-chip {
          font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em;
          padding: 4px 10px; border-radius: 6px;
        }
        .type-chip.ultra { background: linear-gradient(135deg, #9333ea, #db2777); color: #fff; }
        .type-chip.pro { background: linear-gradient(135deg, #2563eb, #4f46e5); color: #fff; }
        .type-chip.free, .type-chip { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.5); }

        /* Quota */
        .acc-card-quota { padding: 0 20px 16px; }
        .quota-visual-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .qv-item {
          padding: 8px 10px; background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.04); border-radius: 10px;
        }
        .qv-top { display: flex; justify-content: space-between; margin-bottom: 6px; }
        .qv-name { font-size: 10px; color: rgba(255,255,255,0.4); font-weight: 600; }
        .qv-pct { font-size: 10px; font-weight: 800; }
        .qv-track { height: 3px; background: rgba(255,255,255,0.04); border-radius: 10px; overflow: hidden; }
        .qv-fill { height: 100%; border-radius: 10px; transition: width 0.8s ease; }
        .quota-empty {
          display: flex; align-items: center; gap: 8px; justify-content: center;
          padding: 16px; color: rgba(255,255,255,0.2); font-size: 11px;
        }

        /* Footer */
        .acc-card-footer {
          padding: 12px 20px;
          border-top: 1px solid rgba(255,255,255,0.04);
          display: flex; justify-content: space-between; align-items: center;
        }
        .acc-footer-stat { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; }
        .ft-active { color: #00d68f; }
        .ft-limited { color: #ffb020; }

        /* Active Badge */
        .ag-active-badge {
          display: flex; align-items: center; gap: 5px;
          color: #00d68f; font-size: 11px; font-weight: 700;
        }

        /* Use Button */
        .dash-activate-section { padding: 0 20px 14px; }
        .dash-use-btn {
          position: relative; overflow: hidden;
          width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
          padding: 10px 24px; border-radius: 12px;
          background: transparent;
          border: 1.5px solid rgba(0,214,143,0.4);
          font-size: 12.5px; font-weight: 700; letter-spacing: 0.03em; cursor: pointer;
          color: #00d68f;
          transition: all 0.3s ease;
        }
        .dash-use-btn::before {
          content: ''; position: absolute; top: 0; left: -100%; width: 60%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(0,214,143,0.06), transparent);
          animation: shimmer 4s ease-in-out infinite;
        }
        .dash-use-btn:hover:not(:disabled) {
          background: rgba(0,214,143,0.08);
          border-color: rgba(0,214,143,0.6);
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(0,214,143,0.15);
        }
        .dash-use-btn:active:not(:disabled) { transform: translateY(0); }
        .dash-use-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .dash-use-btn:disabled::before { animation: none; }
        .dash-use-btn.is-active {
          background: rgba(0,214,143,0.06);
          border-color: rgba(0,214,143,0.25);
          color: rgba(0,214,143,0.7);
        }
        .dash-use-btn.is-active::before { animation: none; opacity: 0; }
        .dash-use-btn.is-active:hover:not(:disabled) {
          background: rgba(0,214,143,0.08); transform: none; box-shadow: none;
        }
        @keyframes shimmer { 0%,100% { left: -100%; } 50% { left: 150%; } }
        .btn-spinner {
          width: 13px; height: 13px; border-radius: 50%;
          border: 2px solid rgba(0,214,143,0.2); border-top-color: #00d68f;
          animation: spin 0.6s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Success Message */
        .dash-success {
          margin-top: 20px; padding: 12px 16px; border-radius: 10px;
          background: rgba(0,214,143,0.08); border: 1px solid rgba(0,214,143,0.15);
          color: #00d68f; font-size: 13px; display: flex; align-items: center; gap: 8px;
          animation: fadeIn 0.3s ease;
        }

        /* ── CTA Card ── */
        .dash-cta-card {
          position: relative; text-align: center;
          background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 24px; padding: 64px 40px; overflow: hidden;
        }
        .cta-bg-icon { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
        .cta-inner { position: relative; z-index: 1; }
        .cta-icon-wrap {
          width: 56px; height: 56px; border-radius: 16px;
          background: rgba(0,214,143,0.1); border: 1px solid rgba(0,214,143,0.15);
          display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;
        }
        .cta-inner h3 { font-size: 22px; font-weight: 800; color: #fff; margin: 0 0 8px; }
        .cta-inner p { font-size: 14px; color: rgba(255,255,255,0.4); margin: 0 0 24px; }
        .cta-btn {
          background: var(--primary); color: #fff; border: none;
          padding: 12px 28px; border-radius: 10px; font-size: 13px; font-weight: 700;
          cursor: pointer; transition: all 0.2s;
        }
        .cta-btn:hover { background: var(--primary-hover); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,214,143,0.2); }

        /* ── Error ── */
        .dash-error {
          margin-top: 20px; padding: 12px 16px; border-radius: 10px;
          background: rgba(255,77,106,0.08); border: 1px solid rgba(255,77,106,0.15);
          color: #ff4d6a; font-size: 13px; display: flex; align-items: center; gap: 8px;
        }

        /* ── Animate ── */
        .animate-fade-in { animation: fadeIn 0.6s cubic-bezier(0.23, 1, 0.32, 1); }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(0,214,143,0.5); } 70% { box-shadow: 0 0 0 8px rgba(0,214,143,0); } 100% { box-shadow: 0 0 0 0 rgba(0,214,143,0); } }

        /* Responsive */
        @media (max-width: 768px) {
          .hero-content { flex-direction: column; text-align: center; }
          .hero-ring-wrap { margin-top: 20px; }
          .dash-stats-row { grid-template-columns: 1fr; }
          .dash-account-grid { grid-template-columns: 1fr; }
          .hero-name { font-size: 24px; }
        }
      `}</style>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function shortModelName(name, displayName) {
  let label = displayName || name;
  label = label.replace(/^models\//, '');
  if (label.length > 20) {
    label = label
      .replace('gemini-2.5-pro', 'Gemini 2.5 Pro').replace('gemini-2.5-flash', 'Gemini 2.5 Flash')
      .replace('gemini-2.0-flash', 'Gemini 2.0 Flash').replace('gemini-1.5-pro', 'Gemini 1.5 Pro')
      .replace('gemini-1.5-flash', 'Gemini 1.5 Flash').replace('claude-', 'Claude ')
      .replace('gpt-', 'GPT-').replace('imagen-', 'Imagen ')
      .replace('-latest', '').replace('-exp-', ' Exp ');
  }
  if (label.length > 18) label = label.substring(0, 16) + '…';
  return label;
}
