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
};

export default function SessionGuard({ children }) {
  const { user, hardwareInfo } = useAuth();
  const [revoked, setRevoked] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [refreshStatus, setRefreshStatus] = useState(''); // '' | 'refreshing'
  const heartbeatRef = useRef(null);
  const tokenRefreshRef = useRef(null);
  const activeAccountsRef = useRef([]); // Track accounts from heartbeat

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

      // Store active accounts for token refresh cycle
      activeAccountsRef.current = data.active_accounts || [];
    } catch (e) {
      // Network error — don't wipe, just skip
      console.warn('[SessionGuard] Heartbeat failed:', e.message);
    }
  }

  // ─── Token Auto-Refresh (every 50 min) ─────────────────────────
  async function refreshTokens() {
    if (!user || !hardwareInfo?.hardware_id) return;

    const accounts = activeAccountsRef.current;
    if (!accounts.length) {
      console.log('[SessionGuard] No active accounts to refresh');
      return;
    }

    console.log(`[SessionGuard] Refreshing tokens for ${accounts.length} account(s)...`);
    setRefreshStatus('refreshing');

    try {
      // 1. Get fresh tokens for all accounts FIRST (before killing AG)
      const freshTokens = [];
      for (const acc of accounts) {
        try {
          const tokenData = await api.getAccountToken(acc.id, hardwareInfo.hardware_id);
          freshTokens.push({ ...acc, ...tokenData });
        } catch (e) {
          console.warn(`[SessionGuard] Token refresh failed for ${acc.email}:`, e.message);
          // If token proxy rejects, session may be invalid — check heartbeat
          if (e.message?.includes('No active subscription') || e.message?.includes('not assigned')) {
            await checkHeartbeat();
            return;
          }
        }
      }

      if (freshTokens.length === 0) {
        setRefreshStatus('');
        return;
      }

      // 2. Kill Antigravity
      try { await invoke('kill_antigravity'); } catch (e) { /* may not be running */ }
      await new Promise(r => setTimeout(r, 2500));

      // 3. Inject the latest token (use the first/primary account)
      const primary = freshTokens[0];
      try {
        await invoke('inject_antigravity_token', {
          request: {
            access_token: primary.access_token,
            refresh_token: 'proxy-managed',
            expiry: primary.expires_at || Math.floor(Date.now() / 1000) + 3600,
            email: primary.email,
          }
        });
      } catch (e) {
        console.warn('[SessionGuard] Injection failed:', e);
      }

      // 4. Relaunch Antigravity
      try {
        await invoke('switch_and_restart_antigravity', {
          request: {
            access_token: primary.access_token,
            refresh_token: 'proxy-managed',
            expiry: primary.expires_at || Math.floor(Date.now() / 1000) + 3600,
            email: primary.email,
          }
        });
      } catch (e) {
        console.warn('[SessionGuard] Relaunch failed:', e);
      }

      console.log('[SessionGuard] Token refresh complete ✓');
    } catch (e) {
      console.warn('[SessionGuard] Token refresh error:', e.message);
    }

    setRefreshStatus('');
  }

  // ─── Revoke & Wipe ────────────────────────────────────────────
  async function revokeSession(reasons) {
    // 1. Kill Antigravity
    try { await invoke('kill_antigravity'); } catch (e) { /* ok */ }
    await new Promise(r => setTimeout(r, 1500));

    // 2. Wipe tokens
    try { await invoke('wipe_antigravity_tokens'); } catch (e) { /* ok */ }

    // 3. Show lock screen
    const reason = (reasons || []).map(r => REASON_MESSAGES[r] || r).join(' ');
    setRevokeReason(reason || 'Session invalidated by server.');
    setRevoked(true);

    // Stop all polling
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    if (tokenRefreshRef.current) clearInterval(tokenRefreshRef.current);
  }

  // ─── Start Timers ──────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    // Initial heartbeat after 10 seconds
    const initTimeout = setTimeout(() => {
      checkHeartbeat();

      // Security heartbeat: every 5 minutes
      heartbeatRef.current = setInterval(checkHeartbeat, HEARTBEAT_INTERVAL);

      // Token refresh: every 50 minutes
      tokenRefreshRef.current = setInterval(refreshTokens, TOKEN_REFRESH_INTERVAL);
    }, 10000);

    return () => {
      clearTimeout(initTimeout);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (tokenRefreshRef.current) clearInterval(tokenRefreshRef.current);
    };
  }, [user, hardwareInfo]);

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

  // ─── Refresh Indicator (subtle, non-blocking) ─────────────────
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
