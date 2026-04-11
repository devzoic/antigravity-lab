import { useState, useEffect } from 'react';
import { api } from '../services/api';
import Icon from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { invoke } from '@tauri-apps/api/core';

export default function DashboardPage({ setPage }) {
  const { user, hardwareInfo } = useAuth();
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeEmail, setActiveEmail] = useState('');
  const [activating, setActivating] = useState(null);
  const [activateMsg, setActivateMsg] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [refreshingId, setRefreshingId] = useState(null);
  const [success, setSuccess] = useState('');

  async function loadQuota() {
    try {
      const data = await api.getCurrentQuota();
      setQuota(data);
      
      // Auto-set the active button state based on the database flag
      if (data?.accounts) {
        const activeAcc = data.accounts.find(a => a.is_proxy_active === true);
        if (activeAcc) setActiveEmail(activeAcc.email);
      }

      // Silently sync the active token into IDE's SQLite (no restart needed)
      if (data?.active_access_token) {
        try {
          await invoke('inject_real_token', { accessToken: data.active_access_token });
          console.log('[Dashboard] Token synced to IDE.');
        } catch (e) {
          console.warn('[Dashboard] Token sync failed:', e);
        }
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  useEffect(() => { loadQuota(); }, []);

  useEffect(() => {
    if (success || error || activateMsg) {
      const t = setTimeout(() => { setSuccess(''); setError(''); setActivateMsg(''); }, 4000);
      return () => clearTimeout(t);
    }
  }, [success, error, activateMsg]);

  async function requestAccount() {
    setActionLoading('request'); setError(''); setSuccess('');
    try {
      await api.requestAccount(hardwareInfo?.hardware_id);
      setSuccess('Account allocated successfully.');
      loadQuota();
    } catch (e) { setError(e.message); }
    setActionLoading('');
  }

  async function releaseAccount(accountId) {
    setActionLoading('release'); setError(''); setSuccess('');
    try {
      await api.releaseAccount(accountId);
      setSuccess('Account released.');
      loadQuota();
    } catch (e) { setError(e.message); }
    setActionLoading('');
  }

  async function refreshQuota(accountId) {
    setRefreshingId(accountId); setError('');
    try {
      await api.refreshQuota(accountId);
      setSuccess('Quota refreshed.');
      loadQuota();
    } catch (e) { setError(e.message); }
    setRefreshingId(null);
  }

  async function activateAccount(acc) {
    if (!acc?.id || !acc?.email) return;
    setActivating(acc.id); setActivateMsg(''); setError('');
    try {
      // 1. Tell Laravel to set this account as active
      await api.activateProxyAccount(acc.id, hardwareInfo?.hardware_id);
      setActiveEmail(acc.email);
      
      // 2. Get the fresh access token
      const freshQuota = await api.getCurrentQuota();
      
      if (freshQuota?.active_access_token) {
        // 3. Remove any leftover proxy settings
        try { await invoke('restore_gemini_config'); } catch (e) { /* ok */ }
        
        // 4. Inject token into IDE's SQLite database
        try {
          await invoke('inject_real_token', { accessToken: freshQuota.active_access_token });
          
          // 5. Auto-restart IDE to pick up the new token
          await invoke('restart_antigravity');
          setActivateMsg(`✓ ${acc.email} activated — Antigravity restarted`);
        } catch (e) {
          setActivateMsg(`✓ ${acc.email} activated — restart Antigravity manually`);
        }
      } else {
        setError(`${acc.email} has no valid token. Refresh quota first.`);
      }
      
      setQuota(freshQuota);
    } catch (e) {
      setError(`Failed to activate: ${e.message || e}`);
    }
    setActivating(null);
  }



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
        <div className="dash-stats-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '32px' }}>
          <div className="dash-stat-card" style={{ height: '100%' }}>
            <div className="dstat-icon" style={{ background: 'rgba(66,133,244,0.1)' }}>
              <Icon name="package" size={20} color="#4285F4" />
            </div>
            <div className="dstat-body">
              <span className="dstat-label">Plan Coverage</span>
              <span className="dstat-value" style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-primary)' }}>{plan?.name}</span>
            </div>
          </div>
          
          <div className="dash-stat-card" style={{ height: '100%' }}>
            <div className="dstat-icon" style={{ background: 'rgba(0,214,143,0.1)' }}>
              <Icon name="key" size={20} color="#00d68f" />
            </div>
            <div className="dstat-body">
              <span className="dstat-label">Active Seats</span>
              <span className="dstat-value" style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-primary)' }}>{accounts.length}<span className="dstat-dim" style={{ fontSize: '0.85em', opacity: 0.6, fontWeight: 400 }}> / {plan?.max_accounts} limits</span></span>
            </div>
          </div>


        </div>
      )}

      {/* ── Accounts & Quota Section ── */}
      {accounts.length > 0 && (
        <div className="dash-accounts-section">
          <div className="dash-section-head">
            <div className="section-title-group" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h3>AI Accounts</h3>
              <span className="section-count">{accounts.length}</span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {activateMsg && <span style={{ color: '#00d68f', fontSize: 12, fontWeight: 600 }}>{activateMsg}</span>}
              {success && <span style={{ color: '#00d68f', fontSize: 12, fontWeight: 600 }}>{success}</span>}
              {error && <span style={{ color: '#ff4d6a', fontSize: 12, fontWeight: 600 }}>{error}</span>}
              
              <button 
                onClick={() => {
                  setActionLoading('refreshAll');
                  loadQuota().then(() => setActionLoading(''));
                }}
                disabled={actionLoading === 'refreshAll'}
                className="btn" 
                style={{ 
                  background: 'transparent', 
                  border: '1px solid rgba(255,255,255,0.1)', 
                  color: 'rgba(255,255,255,0.7)', 
                  padding: '6px 12px', 
                  fontSize: 12, 
                  borderRadius: 6, 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 6,
                  cursor: actionLoading === 'refreshAll' ? 'progress' : 'pointer',
                  opacity: actionLoading === 'refreshAll' ? 0.7 : 1
                }}
              >
                <div style={{ transform: actionLoading === 'refreshAll' ? 'rotate(180deg)' : 'none', transition: 'transform 0.5s ease', display: 'flex' }}>
                  <Icon name="refresh" size={14} />
                </div>
                {actionLoading === 'refreshAll' ? 'Refreshing...' : 'Refresh Stats'}
              </button>
              
              <span className="section-live"><span className="live-dot"></span> Live</span>
            </div>
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
                      {acc.account_type || 'Free'}
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
                        const reset = formatResetTime(model.reset_time);
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
                            {reset && (
                              <div className="qv-reset" style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                                <Icon name="clock" size={9} /> {reset}
                              </div>
                            )}
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

                {/* Footer and Actions */}
                <div className="acc-card-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="acc-footer-stat">
                    {activeEmail === acc.email ? (
                      <><span className="ag-active-badge"><Icon name="zap" size={11} color="#00d68f" /> Active Pipeline</span></>
                    ) : (
                      <><Icon name="activity" size={12} color="rgba(255,255,255,0.3)" />
                      <span className={acc.status === 'active' ? 'ft-active' : 'ft-limited'}>
                        {acc.status === 'active' ? 'Ready' : 'Limited'}
                      </span></>
                    )}
                  </div>
                  <div className="acf-actions" style={{ display: 'flex', gap: 6 }}>
                    <button className="acf-btn" onClick={() => refreshQuota(acc.id)} disabled={refreshingId === acc.id} style={{ background: 'rgba(255,255,255,0.04)', border: 'none', color: 'rgba(255,255,255,0.5)', padding: 6, borderRadius: 6, cursor: 'pointer' }}>
                      {refreshingId === acc.id ? '...' : <Icon name="refresh" size={13} />}
                    </button>
                    <button className="acf-btn danger" onClick={() => releaseAccount(acc.id)} disabled={!!actionLoading} style={{ background: 'rgba(255,77,106,0.1)', border: 'none', color: '#ff4d6a', padding: 6, borderRadius: 6, cursor: 'pointer' }}>
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty Accounts State ── */}
      {accounts.length === 0 && sub && (
        <div className="dash-empty-accounts" style={{ textAlign: 'center', padding: '64px 20px', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '24px', marginTop: '24px' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '18px', background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <Icon name="package" size={28} color="rgba(255,255,255,0.25)" />
          </div>
          <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#fff', margin: '0 0 10px', letterSpacing: '-0.02em' }}>No AI Pipelines Assigned</h3>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: '0 auto 24px', maxWidth: '360px', lineHeight: 1.5 }}>
            Your dashboard is currently idle. You don't have any AI nodes connected to your workspace yet.
          </p>
          <button className="cta-btn" onClick={() => setPage && setPage('accounts')}>
            Open Accounts Portal
          </button>
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
          border-radius: 20px;
          padding: 24px 30px;
          margin-bottom: 16px;
          overflow: hidden;
        }
        .hero-glow {
          position: absolute; top: -30px; right: -30px;
          width: 150px; height: 150px;
          background: radial-gradient(circle, rgba(0,214,143,0.12) 0%, transparent 70%);
          pointer-events: none;
        }
        .hero-content { display: flex; align-items: center; justify-content: space-between; position: relative; z-index: 1; }
        .hero-greeting {
          font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.4);
          text-transform: uppercase; letter-spacing: 0.12em; display: block; margin-bottom: 4px;
        }
        .hero-name {
          font-size: 26px; font-weight: 800; margin: 0;
          background: linear-gradient(135deg, #fff 20%, rgba(255,255,255,0.5));
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          letter-spacing: -0.02em;
        }
        .hero-sub { font-size: 13px; color: rgba(255,255,255,0.4); margin-top: 6px; line-height: 1.4; }
        .hero-sub strong { color: var(--primary); font-weight: 700; }

        /* Ring */
        .hero-ring-wrap { position: relative; width: 85px; height: 85px; flex-shrink: 0; }
        .hero-ring { width: 100%; height: 100%; }
        .ring-label {
          position: absolute; inset: 0; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
        }
        .ring-number { font-size: 22px; font-weight: 800; color: #fff; line-height: 1; }
        .ring-unit { font-size: 9px; color: rgba(255,255,255,0.4); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 1px; }

        /* ── Stat Cards ── */
        .dash-stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
        .dash-stat-card {
          display: flex; align-items: center; gap: 12px;
          background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 14px; padding: 14px 18px;
          transition: all 0.3s ease;
        }
        .dash-stat-card:hover { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.1); transform: translateY(-2px); }
        .dstat-icon { width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .dstat-icon svg { width: 16px; height: 16px; }
        .dstat-label { font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.08em; display: block; margin-bottom: 1px; }
        .dstat-value { font-size: 17px; font-weight: 800; color: #fff; margin-top: 0px; display: block; }
        .dstat-dim { font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.25); }

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

function formatResetTime(resetTime) {
  if (!resetTime) return '';
  try {
    const reset = new Date(resetTime);
    const now = new Date();
    const diffMs = reset - now;
    if (diffMs <= 0) return '';
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return `${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    const remainMin = diffMin % 60;
    if (diffHr < 24) return `${diffHr}h ${remainMin}m`;
    const diffDays = Math.floor(diffHr / 24);
    return `${diffDays}d ${diffHr % 24}h`;
  } catch { return ''; }
}
