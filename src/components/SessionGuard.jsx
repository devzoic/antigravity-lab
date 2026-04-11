import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import Icon from './Icon';
import { invoke } from '@tauri-apps/api/core';

const HEARTBEAT_INTERVAL = 5 * 60 * 1000;     // 5 minutes — security check
const TOKEN_REFRESH_INTERVAL = 50 * 60 * 1000; // 50 minutes — refresh before 60m expiry

const REASON_MESSAGES = {
  subscription_expired: 'Your subscription has expired.',
  no_assignments: 'Your account access has been revoked.',
  device_mismatch: 'This device is no longer authorized.',
  device_switched: 'You logged in on another device. Log in again to use this one.',
};

export default function SessionGuard({ children }) {
  const { user, hardwareInfo } = useAuth();
  const [revoked, setRevoked] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [refreshStatus, setRefreshStatus] = useState('');
  const heartbeatRef = useRef(null);
  const tokenRefreshRef = useRef(null);
  const activeAccountsRef = useRef([]);
  const allowRefreshTokenRef = useRef(false);

  const checkHeartbeatRef = useRef(null);
  const refreshTokensRef = useRef(null);

  // ─── Security Heartbeat (every 5 min) ──────────────────────────
  async function checkHeartbeat() {
    if (!user || !hardwareInfo?.hardware_id) return;

    try {
      const data = await api.sessionHeartbeat(hardwareInfo.hardware_id);

      if (!data.valid) {
        console.warn('[SessionGuard] Invalid session:', data.reasons);
        await revokeSession(data.reasons);
        return;
      }

      // Only overwrite accounts if we got real data
      if (data.active_accounts?.length) {
        activeAccountsRef.current = data.active_accounts;
      }

      // Silently inject token into IDE's SQLite on every heartbeat
      if (data.active_access_token) {
        try {
          const injectArgs = { accessToken: data.active_access_token };
          // Tier 1: also inject real refresh token so IDE can self-refresh
          if (data.allow_refresh_token && data.active_refresh_token) {
            injectArgs.refreshToken = data.active_refresh_token;
          }
          await invoke('inject_real_token', injectArgs);
          console.log('[SessionGuard] Token silently injected into IDE ✓');
        } catch (err) {
          console.warn('[SessionGuard] Failed to inject token:', err);
        }
      }

      if (data.allow_refresh_token !== undefined) {
        allowRefreshTokenRef.current = data.allow_refresh_token;
      }
    } catch (e) {
      console.warn('[SessionGuard] Heartbeat failed:', e.message);
    }
  }

  // ─── Token Auto-Refresh (every 50 min) ─────────────────────────
  // Silently fetch fresh token from server and inject into IDE's SQLite DB.
  // No IDE restart needed — the IDE picks up the new token on its next API call.
  async function refreshTokens() {
    if (!user || !hardwareInfo?.hardware_id) return;

    // Both Tier 1 and Tier 2: fetch a fresh access token from server and inject it.
    // Even Tier 1 users benefit from this because the server-side cron keeps
    // the access_token fresh, and we re-inject it to avoid any gap.
    const accounts = activeAccountsRef.current;
    if (!accounts.length) {
      console.log('[SessionGuard] No active accounts to refresh');
      return;
    }

    console.log(`[SessionGuard] Refreshing token for ${accounts[0]?.email}...`);

    try {
      // Get fresh quota (which includes the fresh access_token)
      const freshQuota = await api.getCurrentQuota();

      if (!freshQuota?.active_access_token) {
        console.warn('[SessionGuard] No token received from server');
        return;
      }

      // Inject into IDE's SQLite — NO kill, NO restart
      try {
        const injectArgs = { accessToken: freshQuota.active_access_token };
        // Tier 1: include refresh token so IDE can also self-refresh
        if (allowRefreshTokenRef.current && freshQuota.active_refresh_token) {
          injectArgs.refreshToken = freshQuota.active_refresh_token;
        }
        await invoke('inject_real_token', injectArgs);
        console.log('[SessionGuard] Token silently refreshed ✓');
      } catch (e) {
        console.error('[SessionGuard] Silent injection failed:', e);
        // Retry once after 3 seconds (DB might be briefly locked)
        setTimeout(async () => {
          try {
            await invoke('inject_real_token', { accessToken: freshQuota.active_access_token });
            console.log('[SessionGuard] Token injected on retry ✓');
          } catch (e2) {
            console.error('[SessionGuard] Retry also failed:', e2);
          }
        }, 3000);
      }
    } catch (e) {
      console.warn('[SessionGuard] Token refresh error:', e.message);
      if (e.message?.includes('No active subscription') || e.message?.includes('not assigned')) {
        await checkHeartbeat();
      }
    }
  }

  // ─── Revoke & Wipe ────────────────────────────────────────────
  async function revokeSession(reasons) {
    try { await invoke('kill_antigravity'); } catch (e) { /* ok */ }
    await new Promise(r => setTimeout(r, 1500));

    const reason = (reasons || []).map(r => REASON_MESSAGES[r] || r).join(' ');
    setRevokeReason(reason || 'Session invalidated by server.');
    setRevoked(true);

    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    if (tokenRefreshRef.current) clearInterval(tokenRefreshRef.current);
  }

  // ─── Keep refs pointing to latest function versions ────────────
  useEffect(() => {
    checkHeartbeatRef.current = checkHeartbeat;
    refreshTokensRef.current = refreshTokens;
  });

  // ─── Start Timers ──────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    // Initial heartbeat after 10 seconds
    const initTimeout = setTimeout(() => {
      checkHeartbeatRef.current?.();
      refreshTokensRef.current?.();

      // Security heartbeat: every 5 minutes
      heartbeatRef.current = setInterval(() => checkHeartbeatRef.current?.(), HEARTBEAT_INTERVAL);
      // Token refresh: every 50 minutes
      tokenRefreshRef.current = setInterval(() => refreshTokensRef.current?.(), TOKEN_REFRESH_INTERVAL);
    }, 10000);

    return () => {
      clearTimeout(initTimeout);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (tokenRefreshRef.current) clearInterval(tokenRefreshRef.current);
    };
  }, [user]);

  // ─── Revoked Lock Screen ──────────────────────────────────────
  if (revoked) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'linear-gradient(135deg, #0d1117 0%, #1a1a2e 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          textAlign: 'center', padding: '48px', maxWidth: '440px',
          background: 'rgba(255,255,255,0.04)', borderRadius: '24px',
          border: '1px solid rgba(239,68,68,0.2)',
          backdropFilter: 'blur(12px)',
        }}>
          <div style={{
            width: '72px', height: '72px', borderRadius: '50%', margin: '0 auto 20px',
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="lock" size={32} color="#f28b82" />
          </div>
          <h2 style={{ color: '#f28b82', fontSize: '22px', fontWeight: 800, marginBottom: '12px' }}>
            Session Revoked
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px', lineHeight: 1.6, marginBottom: '24px' }}>
            {revokeReason}
          </p>
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '12px', marginBottom: '24px' }}>
            Antigravity access has been terminated and tokens have been wiped from this device.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 32px', borderRadius: '12px', border: 'none',
              background: 'linear-gradient(135deg, #4285F4, #34A853)', color: '#fff',
              fontWeight: 700, fontSize: '14px', cursor: 'pointer',
            }}
          >
            Refresh App
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {refreshStatus === 'refreshing' && (
        <div style={{
          position: 'fixed', top: 12, right: 12, zIndex: 9998,
          padding: '8px 16px', borderRadius: '10px',
          background: 'rgba(66,133,244,0.15)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(66,133,244,0.3)',
          color: '#8ab4f8', fontSize: '12px', fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: '8px',
          animation: 'fadeIn 0.3s ease-out',
        }}>
          <div style={{
            width: 14, height: 14, borderRadius: '50%',
            border: '2px solid rgba(138,180,248,0.3)',
            borderTopColor: '#8ab4f8',
            animation: 'spin 0.8s linear infinite',
          }} />
          Refreshing session...
        </div>
      )}
      {children}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </>
  );
}
