import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import Icon from '../components/Icon';
import { invoke } from '@tauri-apps/api/core';

export default function AccountsPage() {
  const { hardwareInfo } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [refreshingId, setRefreshingId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeEmail, setActiveEmail] = useState('');
  const [activating, setActivating] = useState(null);

  async function activateAccount(acc) {
    if (!acc?.id || !acc?.email) return;
    setActivating(acc.id); setError(''); setSuccess('');
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
        setSuccess(result.success
          ? `✓ ${acc.email} activated — Antigravity restarted`
          : `✓ ${acc.email} activated. ${result.message || 'Restart Antigravity manually.'}`);
      } catch {
        await invoke('inject_antigravity_token', { request: tokenRequest });
        setActiveEmail(acc.email);
        setSuccess(`✓ ${acc.email} token injected — restart Antigravity manually`);
      }
    } catch (e) {
      setError(`Failed to activate: ${e.message || e}`);
    }
    setActivating(null);
  }

  async function loadAccounts() {
    try {
      const data = await api.getCurrentQuota();
      setAccounts(data?.accounts || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  useEffect(() => { loadAccounts(); }, []);

  useEffect(() => {
    if (success || error) {
      const t = setTimeout(() => { setSuccess(''); setError(''); }, 4000);
      return () => clearTimeout(t);
    }
  }, [success, error]);

  async function injectToAntigravity(account) {
    if (!account?.id || !account?.email) return '⚠ No account to inject';
    try {
      const tokenData = await api.getAccountToken(account.id, hardwareInfo?.hardware_id);
      const result = await invoke('inject_antigravity_token', {
        request: {
          access_token: tokenData.access_token,
          refresh_token: 'proxy-managed',
          expiry: tokenData.expires_at || Math.floor(Date.now() / 1000) + 3600,
          email: account.email,
        }
      });
      return result.message;
    } catch (e) { return `⚠ Injection failed: ${e}`; }
  }

  async function requestAccount() {
    setActionLoading('request'); setError(''); setSuccess('');
    try {
      const data = await api.requestAccount(hardwareInfo?.hardware_id);
      const account = data.account;
      const injectMsg = await injectToAntigravity(account);
      setSuccess(`Account assigned: ${account?.email || 'Success'}. ${injectMsg}`);
      loadAccounts();
    } catch (e) { setError(e.message); }
    setActionLoading('');
  }

  async function switchAccount(accountId) {
    setActionLoading('switch'); setError(''); setSuccess('');
    try {
      const data = await api.switchAccount(accountId, hardwareInfo?.hardware_id);
      const account = data.account;
      setSuccess(`Switching to ${account?.email}...`);
      try {
        const tokenData = await api.getAccountToken(account.id, hardwareInfo?.hardware_id);
        const result = await invoke('switch_and_restart_antigravity', {
          request: {
            access_token: tokenData.access_token,
            refresh_token: 'proxy-managed',
            expiry: tokenData.expires_at || Math.floor(Date.now() / 1000) + 3600,
            email: account.email,
          }
        });
        setSuccess(result.success ? `Switched to ${account?.email} — Antigravity restarted ✓` : `Switched to ${account?.email}. ${result.message}`);
      } catch {
        const injectMsg = await injectToAntigravity(account);
        setSuccess(`Switched to ${account?.email}. ${injectMsg} — Restart Antigravity manually.`);
      }
      loadAccounts();
    } catch (e) { setError(e.message); }
    setActionLoading('');
  }

  async function releaseAccount(accountId) {
    setActionLoading('release'); setError(''); setSuccess('');
    try {
      await api.releaseAccount(accountId);
      setSuccess('Account released.');
      loadAccounts();
    } catch (e) { setError(e.message); }
    setActionLoading('');
  }

  async function refreshQuota(accountId) {
    setRefreshingId(accountId); setError('');
    try {
      const data = await api.refreshQuota(accountId);
      setAccounts(prev => prev.map(acc =>
        acc.id === accountId
          ? { ...acc, subscription_tier: data.subscription_tier, quota_models: data.quota_models, quota_refreshed_at: data.quota_refreshed_at, is_forbidden: data.is_forbidden }
          : acc
      ));
      setSuccess(`Quota refreshed.`);
    } catch (e) { setError(e.message); }
    setRefreshingId(null);
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
      </div>
    );
  }

  return (
    <div className="acpg animate-fade-in">

      {/* ── Header ── */}
      <div className="acpg-header">
        <div className="acpg-header-bg"></div>
        <div className="acpg-header-inner">
          <div>
            <h1 className="acpg-title">My Accounts</h1>
            <p className="acpg-subtitle">Manage your Google AI access, switch accounts, and monitor live quotas</p>
          </div>
          <button className="acpg-add-btn" onClick={requestAccount} disabled={!!actionLoading}>
            {actionLoading === 'request' ? <div className="spinner" style={{width:16,height:16,borderWidth:2}} /> : (
              <><Icon name="plus" size={16} /> Add Account</>
            )}
          </button>
        </div>
      </div>

      {/* ── Alerts ── */}
      {success && (
        <div className="acpg-alert success">
          <Icon name="check" size={15} /> <span>{success}</span>
        </div>
      )}
      {error && (
        <div className="acpg-alert error">
          <Icon name="alertTriangle" size={15} /> <span>{error}</span>
        </div>
      )}

      {/* ── Account Cards ── */}
      {accounts.length > 0 ? (
        <div className="acpg-grid">
          {accounts.map(acc => {
            const type = (acc.account_type || 'free').toLowerCase();
            const quotaModels = acc.quota_models || [];
            const avgQuota = quotaModels.length > 0
              ? Math.round(quotaModels.reduce((s, m) => s + m.percentage, 0) / quotaModels.length)
              : null;
            const avgColor = avgQuota === null ? 'rgba(255,255,255,0.2)'
              : avgQuota < 20 ? '#ff4d6a' : avgQuota < 50 ? '#ffb020' : avgQuota < 80 ? '#4285F4' : '#00d68f';

            return (
              <div className={`ac-card ${acc.is_forbidden ? 'forbidden' : ''}`} key={acc.id}>
                {/* Accent stripe */}
                <div className={`ac-stripe ${acc.status}`}></div>

                {/* ─ Header ─ */}
                <div className="ac-head">
                  <div className="ac-avatar">
                    <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                  </div>
                  <div className="ac-identity">
                    <div className="ac-email">{acc.email}</div>
                    <div className="ac-badges">
                      <span className={`ac-type-chip ${type}`}>
                        {type === 'ultra' && <Icon name="star" size={9} color="#fff" />}
                        {acc.subscription_tier || type}
                      </span>
                      <span className={`ac-status-chip ${acc.status}`}>
                        <span className="asc-dot"></span>{acc.status?.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* ─ Overall Health Bar ─ */}
                {avgQuota !== null && (
                  <div className="ac-health">
                    <div className="ach-label">
                      <span>Overall Quota Health</span>
                      <span style={{ color: avgColor, fontWeight: 800 }}>{avgQuota}%</span>
                    </div>
                    <div className="ach-track">
                      <div className="ach-fill" style={{ width: `${avgQuota}%`, background: `linear-gradient(90deg, ${avgColor}, ${avgColor}88)` }}></div>
                    </div>
                  </div>
                )}

                {/* ─ Quota Models ─ */}
                <div className="ac-quota-section">
                  {quotaModels.length > 0 ? (
                    <div className="ac-quota-grid">
                      {quotaModels.map((model, idx) => {
                        const pct = model.percentage;
                        const name = shortModelName(model.name, model.display_name);
                        const reset = formatResetTime(model.reset_time);
                        const color = pct < 20 ? '#ff4d6a' : pct < 50 ? '#ffb020' : pct < 80 ? '#4285F4' : '#00d68f';
                        return (
                          <div key={idx} className="aq-item" title={`${model.name} — ${pct}% remaining`}>
                            <div className="aq-top">
                              <span className="aq-name">{name}</span>
                              <span className="aq-pct" style={{ color }}>{pct}%</span>
                            </div>
                            <div className="aq-bar">
                              <div className="aq-fill" style={{ width: `${pct}%`, background: color }}></div>
                            </div>
                            {reset && (
                              <div className="aq-reset"><Icon name="clock" size={9} /> {reset}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : acc.is_forbidden ? (
                    <div className="ac-empty-quota">
                      <Icon name="shield" size={20} color="rgba(255,77,106,0.5)" />
                      <span>Access Restricted (403)</span>
                    </div>
                  ) : (
                    <div className="ac-empty-quota">
                      <Icon name="cloud" size={20} color="rgba(255,255,255,0.15)" />
                      <span>Quota not synced yet</span>
                      <button className="ac-sync-link" onClick={() => refreshQuota(acc.id)}>
                        Initialize Sync →
                      </button>
                    </div>
                  )}
                </div>

                {/* ─ Use in Antigravity ─ */}
                {acc.status === 'active' && (
                  <div className="ac-activate-section">
                    <button
                      className={`ac-use-btn ${activeEmail === acc.email ? 'is-active' : ''}`}
                      onClick={() => activateAccount(acc)}
                      disabled={activating === acc.id}
                    >
                      {activating === acc.id ? (
                        <><div className="ac-btn-spinner" /> Activating...</>
                      ) : activeEmail === acc.email ? (
                        <><Icon name="check" size={15} /> Active in Antigravity</>
                      ) : (
                        <><Icon name="zap" size={15} /> Use in Antigravity</>
                      )}
                    </button>
                  </div>
                )}

                {/* ─ Footer ─ */}
                <div className="ac-footer">
                  <div className="acf-sync">
                    {activeEmail === acc.email ? (
                      <span className="acf-active-tag"><Icon name="zap" size={10} color="#00d68f" /> Active in AG</span>
                    ) : (
                      <>
                        <Icon name="refresh" size={11} color="rgba(255,255,255,0.25)" />
                        {acc.quota_refreshed_at
                          ? <span>{new Date(acc.quota_refreshed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          : <span>Never synced</span>
                        }
                      </>
                    )}
                  </div>
                  <div className="acf-actions">
                    <button className="acf-btn" onClick={() => refreshQuota(acc.id)} disabled={refreshingId === acc.id} title="Refresh Quota">
                      {refreshingId === acc.id ? <div className="spinner" style={{width:12,height:12,borderWidth:2}} /> : <Icon name="refresh" size={13} />}
                    </button>
                    <button className="acf-btn danger" onClick={() => releaseAccount(acc.id)} disabled={!!actionLoading} title="Release Account">
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ac-empty-state">
          <div className="ace-bg"><Icon name="zap" size={100} color="rgba(0,214,143,0.04)" /></div>
          <div className="ace-inner">
            <div className="ace-icon"><Icon name="key" size={28} color="#00d68f" /></div>
            <h3>Access Your Workspace</h3>
            <p>You don't have any Google AI accounts assigned yet.</p>
            <button className="acpg-add-btn" onClick={requestAccount} disabled={!!actionLoading}>
              {actionLoading === 'request' ? <div className="spinner" style={{width:16,height:16,borderWidth:2}} /> : 'Request Account'}
            </button>
          </div>
        </div>
      )}

      <style>{`
        .acpg { max-width: 1100px; margin: 0 auto; }

        /* ══ Header ══ */
        .acpg-header {
          position: relative; margin-bottom: 28px; padding: 32px 36px;
          background: linear-gradient(135deg, rgba(66,133,244,0.06), rgba(0,214,143,0.04));
          border: 1px solid rgba(255,255,255,0.06); border-radius: 22px; overflow: hidden;
        }
        .acpg-header-bg {
          position: absolute; top: -60px; right: -60px; width: 220px; height: 220px;
          background: radial-gradient(circle, rgba(66,133,244,0.1) 0%, transparent 70%);
          pointer-events: none;
        }
        .acpg-header-inner { display: flex; justify-content: space-between; align-items: center; position: relative; z-index: 1; }
        .acpg-title {
          font-size: 28px; font-weight: 800; margin: 0;
          background: linear-gradient(135deg, #fff 20%, rgba(255,255,255,0.5));
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          letter-spacing: -0.02em;
        }
        .acpg-subtitle { font-size: 13px; color: rgba(255,255,255,0.35); margin-top: 6px; }
        .acpg-add-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 10px 20px; border-radius: 10px; font-size: 13px; font-weight: 700;
          background: linear-gradient(135deg, #4285F4, #00d68f); color: #fff;
          border: none; cursor: pointer; transition: all 0.25s;
          box-shadow: 0 4px 16px rgba(66,133,244,0.25);
          white-space: nowrap; flex-shrink: 0;
        }
        .acpg-add-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(66,133,244,0.35); }
        .acpg-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ══ Alerts ══ */
        .acpg-alert {
          display: flex; align-items: center; gap: 10px; padding: 12px 16px;
          border-radius: 12px; margin-bottom: 20px; font-size: 13px; font-weight: 600;
          animation: slideDown 0.3s ease;
        }
        .acpg-alert.success { background: rgba(0,214,143,0.08); border: 1px solid rgba(0,214,143,0.15); color: #00d68f; }
        .acpg-alert.error { background: rgba(255,77,106,0.08); border: 1px solid rgba(255,77,106,0.15); color: #ff4d6a; }

        /* ══ Card Grid ══ */
        .acpg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 18px; }

        /* ══ Account Card ══ */
        .ac-card {
          background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 18px; overflow: hidden;
          transition: all 0.35s cubic-bezier(0.165, 0.84, 0.44, 1);
          display: flex; flex-direction: column;
        }
        .ac-card:hover {
          background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.12);
          transform: translateY(-4px); box-shadow: 0 16px 48px rgba(0,0,0,0.25);
        }
        .ac-stripe { height: 3px; }
        .ac-stripe.active { background: linear-gradient(90deg, #00d68f, #4285F4); }
        .ac-stripe.rate_limited { background: linear-gradient(90deg, #ffb020, #ff4d6a); }
        .ac-stripe:not(.active):not(.rate_limited) { background: rgba(255,255,255,0.06); }

        /* Card Header */
        .ac-head { display: flex; align-items: center; gap: 12px; padding: 18px 20px 14px; }
        .ac-avatar {
          width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0;
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
          display: flex; align-items: center; justify-content: center;
        }
        .ac-identity { flex: 1; min-width: 0; }
        .ac-email {
          font-size: 13px; font-weight: 700; color: #fff;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .ac-badges { display: flex; gap: 6px; margin-top: 5px; flex-wrap: wrap; }
        .ac-type-chip {
          font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em;
          padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 3px;
        }
        .ac-type-chip.ultra { background: linear-gradient(135deg, #9333ea, #db2777); color: #fff; }
        .ac-type-chip.pro { background: linear-gradient(135deg, #2563eb, #4f46e5); color: #fff; }
        .ac-type-chip.free, .ac-type-chip { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.5); }
        .ac-status-chip {
          font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
          padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;
        }
        .asc-dot { width: 5px; height: 5px; border-radius: 50%; }
        .ac-status-chip.active { background: rgba(0,214,143,0.1); color: #00d68f; }
        .ac-status-chip.active .asc-dot { background: #00d68f; box-shadow: 0 0 6px rgba(0,214,143,0.5); }
        .ac-status-chip.rate_limited { background: rgba(255,176,32,0.1); color: #ffb020; }
        .ac-status-chip.rate_limited .asc-dot { background: #ffb020; }

        .ac-switch-btn {
          width: 38px; height: 38px; border-radius: 12px; flex-shrink: 0;
          background: rgba(66,133,244,0.08); border: 1px solid rgba(66,133,244,0.15);
          color: #4285F4; cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: all 0.2s;
        }
        .ac-switch-btn:hover:not(:disabled) { background: rgba(66,133,244,0.2); border-color: rgba(66,133,244,0.35); transform: scale(1.08); }

        /* Health Bar */
        .ac-health { padding: 0 20px 14px; }
        .ach-label { display: flex; justify-content: space-between; font-size: 10px; color: rgba(255,255,255,0.3); font-weight: 600; margin-bottom: 6px; }
        .ach-track { height: 5px; background: rgba(255,255,255,0.04); border-radius: 10px; overflow: hidden; }
        .ach-fill { height: 100%; border-radius: 10px; transition: width 0.8s ease; }

        /* Quota Grid */
        .ac-quota-section { padding: 0 20px 16px; flex: 1; }
        .ac-quota-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .aq-item {
          padding: 9px 11px; background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.04); border-radius: 10px;
          transition: background 0.2s;
        }
        .aq-item:hover { background: rgba(255,255,255,0.04); }
        .aq-top { display: flex; justify-content: space-between; margin-bottom: 5px; }
        .aq-name { font-size: 10px; color: rgba(255,255,255,0.4); font-weight: 600; }
        .aq-pct { font-size: 10px; font-weight: 800; }
        .aq-bar { height: 3px; background: rgba(255,255,255,0.04); border-radius: 10px; overflow: hidden; }
        .aq-fill { height: 100%; border-radius: 10px; transition: width 0.8s ease; }
        .aq-reset { font-size: 9px; color: rgba(255,255,255,0.25); margin-top: 4px; display: flex; align-items: center; gap: 3px; }

        .ac-empty-quota {
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
          padding: 24px; background: rgba(255,255,255,0.01); border: 1px dashed rgba(255,255,255,0.06);
          border-radius: 12px; color: rgba(255,255,255,0.25); font-size: 11px;
        }
        .ac-sync-link {
          font-size: 11px; color: #4285F4; background: none; border: none;
          cursor: pointer; font-weight: 600; padding: 0; margin-top: 2px;
        }
        .ac-sync-link:hover { text-decoration: underline; }

        /* Activate Section */
        .ac-activate-section {
          padding: 0 20px 16px;
        }
        .ac-use-btn {
          position: relative; overflow: hidden;
          width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
          padding: 10px 24px; border-radius: 12px;
          background: transparent;
          border: 1.5px solid rgba(0,214,143,0.4);
          font-size: 12.5px; font-weight: 700; letter-spacing: 0.03em; cursor: pointer;
          color: #00d68f;
          transition: all 0.3s ease;
        }
        .ac-use-btn::before {
          content: ''; position: absolute; top: 0; left: -100%; width: 60%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(0,214,143,0.06), transparent);
          animation: acShimmer 4s ease-in-out infinite;
        }
        .ac-use-btn:hover:not(:disabled) {
          background: rgba(0,214,143,0.08);
          border-color: rgba(0,214,143,0.6);
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(0,214,143,0.15);
        }
        .ac-use-btn:active:not(:disabled) { transform: translateY(0); }
        .ac-use-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .ac-use-btn:disabled::before { animation: none; }
        .ac-use-btn.is-active {
          background: rgba(0,214,143,0.06);
          border-color: rgba(0,214,143,0.25);
          color: rgba(0,214,143,0.7);
        }
        .ac-use-btn.is-active::before { animation: none; opacity: 0; }
        .ac-use-btn.is-active:hover:not(:disabled) {
          background: rgba(0,214,143,0.08); transform: none; box-shadow: none;
        }
        @keyframes acShimmer { 0%,100% { left: -100%; } 50% { left: 150%; } }
        .ac-btn-spinner {
          width: 13px; height: 13px; border-radius: 50%;
          border: 2px solid rgba(0,214,143,0.2); border-top-color: #00d68f;
          animation: acSpin 0.6s linear infinite;
        }
        @keyframes acSpin { to { transform: rotate(360deg); } }

        .acf-active-tag {
          display: flex; align-items: center; gap: 4px;
          color: #00d68f; font-weight: 700;
        }

        /* Footer */
        .ac-footer {
          display: flex; justify-content: space-between; align-items: center;
          padding: 12px 20px; border-top: 1px solid rgba(255,255,255,0.04);
        }
        .acf-sync { display: flex; align-items: center; gap: 5px; font-size: 10px; color: rgba(255,255,255,0.25); }
        .acf-actions { display: flex; gap: 6px; }
        .acf-btn {
          width: 32px; height: 32px; border-radius: 9px;
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);
          color: rgba(255,255,255,0.5); cursor: pointer;
          display: flex; align-items: center; justify-content: center; transition: all 0.2s;
        }
        .acf-btn:hover:not(:disabled) { background: rgba(255,255,255,0.08); color: #fff; border-color: rgba(255,255,255,0.15); }
        .acf-btn.danger:hover:not(:disabled) { background: rgba(255,77,106,0.1); color: #ff4d6a; border-color: rgba(255,77,106,0.2); }
        .acf-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* Empty State */
        .ac-empty-state {
          position: relative; text-align: center;
          background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 24px; padding: 64px 40px; overflow: hidden;
        }
        .ace-bg { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none; }
        .ace-inner { position: relative; z-index: 1; }
        .ace-icon {
          width: 56px; height: 56px; border-radius: 16px;
          background: rgba(0,214,143,0.1); border: 1px solid rgba(0,214,143,0.15);
          display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;
        }
        .ace-inner h3 { font-size: 22px; font-weight: 800; color: #fff; margin: 0 0 8px; }
        .ace-inner p { font-size: 14px; color: rgba(255,255,255,0.4); margin: 0 0 24px; }

        /* Animations */
        .animate-fade-in { animation: fadeIn 0.5s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

        .spinner.xs { width: 14px; height: 14px; border-width: 2px; }

        @media (max-width: 768px) {
          .acpg-grid { grid-template-columns: 1fr; }
          .acpg-header-inner { flex-direction: column; gap: 16px; text-align: center; }
          .acpg-title { font-size: 22px; }
        }
      `}</style>
    </div>
  );
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
  if (label.length > 22) label = label.substring(0, 20) + '…';
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
