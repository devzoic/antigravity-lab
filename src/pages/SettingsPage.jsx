import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import Icon from '../components/Icon';
import api from '../services/api';
import { APP_VERSION } from '../components/UpdateBanner';

export default function SettingsPage() {
  const { user, hardwareInfo, logout } = useAuth();
  const [updateStatus, setUpdateStatus] = useState(null); // null | 'checking' | { data }
  const [updateError, setUpdateError] = useState(null);

  const checkForUpdates = async () => {
    setUpdateStatus('checking');
    setUpdateError(null);
    try {
      const data = await api.checkUpdate(APP_VERSION);
      setUpdateStatus(data);
    } catch (err) {
      setUpdateError('Could not check for updates.');
      setUpdateStatus(null);
    }
  };

  const openDownload = async (url) => {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
    } catch {
      window.open(url, '_blank');
    }
  };

  return (
    <>
      <div className="page-header">
        <h2>Settings</h2>
        <p>Device information and account details</p>
      </div>

      {/* About / Version */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h3><Icon name="zap" size={16} style={{marginRight: 8, opacity: 0.6}} /> About</h3></div>
        <div className="card-body">
          <div className="settings-row">
            <span className="settings-label">App Version</span>
            <span className="settings-value" style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 15, letterSpacing: 1 }}>v{APP_VERSION}</span>
          </div>
          <div className="settings-row" style={{ borderBottom: 'none', paddingBottom: 0 }}>
            <span className="settings-label">Updates</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {updateStatus === 'checking' ? (
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span className="spinner" style={{ width: 14, height: 14, marginRight: 6, display: 'inline-block', verticalAlign: 'middle' }} />
                  Checking...
                </span>
              ) : updateStatus && updateStatus.update_available ? (
                <span style={{ fontSize: 12 }}>
                  <span style={{ color: 'var(--primary)', fontWeight: 700 }}>v{updateStatus.latest_version}</span>
                  <span style={{ color: 'var(--text-secondary)', margin: '0 4px' }}>available</span>
                  {updateStatus.download_url && (
                    <button
                      onClick={() => openDownload(updateStatus.download_url)}
                      className="btn btn-sm"
                      style={{ background: 'var(--primary)', color: '#fff', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', marginLeft: 6 }}
                    >
                      <Icon name="download" size={12} /> Download
                    </button>
                  )}
                </span>
              ) : updateStatus && !updateStatus.update_available ? (
                <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>
                  ✓ You're up to date
                </span>
              ) : null}
              {updateError && (
                <span style={{ fontSize: 12, color: 'var(--danger)' }}>{updateError}</span>
              )}
              <button
                onClick={checkForUpdates}
                className="btn btn-sm"
                style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border)', padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                disabled={updateStatus === 'checking'}
              >
                Check for Updates
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Device Info */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h3><Icon name="monitor" size={16} style={{marginRight: 8, opacity: 0.6}} /> Device Information</h3></div>
        <div className="card-body">
          <div className="settings-row">
            <span className="settings-label">Hardware ID</span>
            <span className="settings-value">{hardwareInfo?.hardware_id || '—'}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Device Name</span>
            <span className="settings-value">{hardwareInfo?.device_name || '—'}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Operating System</span>
            <span className="settings-value">{hardwareInfo?.os || '—'}</span>
          </div>
        </div>
      </div>

      {/* Account */}
      <div className="card">
        <div className="card-header"><h3><Icon name="user" size={16} style={{marginRight: 8, opacity: 0.6}} /> Account</h3></div>
        <div className="card-body">
          <div className="settings-row">
            <span className="settings-label">Name</span>
            <span className="settings-value">{user?.name || '—'}</span>
          </div>
          <div className="settings-row">
            <span className="settings-label">Email</span>
            <span className="settings-value">{user?.email || '—'}</span>
          </div>
          <div className="settings-row" style={{ borderBottom: 'none', paddingBottom: 0 }}>
            <span className="settings-label">Session</span>
            <button className="btn btn-danger btn-sm" onClick={logout}>Sign Out</button>
          </div>
        </div>
      </div>
    </>
  );
}
