import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import Icon from './Icon';
import { invoke } from '@tauri-apps/api/core';

const HEARTBEAT_INTERVAL = 5 * 60 * 1000;     // 5 minutes — security check

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
  const [refreshStatus, setRefreshStatus] = useState(''); // '' | 'refreshing'
  const heartbeatRef = useRef(null);
  const tokenRefreshRef = useRef(null);
  const activeAccountsRef = useRef([]); // Track accounts from heartbeat
  const allowRefreshTokenRef = useRef(false); // Tier flag from server

  // Refs for stable interval callbacks (fixes stale closure bug)
  const checkHeartbeatRef = useRef(null);

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

      // Only overwrite accounts if we got real data (protects against bad heartbeats)
      if (data.active_accounts?.length) {
        activeAccountsRef.current = data.active_accounts;
      }

      // Track tier flag from server
      if (data.allow_refresh_token !== undefined) {
        allowRefreshTokenRef.current = data.allow_refresh_token;
      }
    } catch (e) {
      // Network error — don't wipe, don't overwrite accounts, just skip
      console.warn('[SessionGuard] Heartbeat failed:', e.message);
    }
  }

  // ─── Token Auto-Refresh Removed (Handled by Proxy Architecture) ───
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
  }

  // ─── Keep refs pointing to latest function versions ────────────
  useEffect(() => { checkHeartbeatRef.current = checkHeartbeat; });

  // ─── Start Timers ──────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    // Initial heartbeat after 10 seconds
    const initTimeout = setTimeout(() => {
      checkHeartbeatRef.current?.();

      // Security heartbeat: every 5 minutes
      heartbeatRef.current = setInterval(() => checkHeartbeatRef.current?.(), HEARTBEAT_INTERVAL);
    }, 10000);

    return () => {
      clearTimeout(initTimeout);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
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
