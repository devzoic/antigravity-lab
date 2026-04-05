import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import Icon from "../components/Icon";
import { APP_VERSION } from "../components/UpdateBanner";

export default function SettingsPage() {
  const { user, hardwareInfo, logout } = useAuth();
  const [updateStatus, setUpdateStatus] = useState(null);
  const [updateError, setUpdateError] = useState(null);
  const [progress, setProgress] = useState(0);

  const checkForUpdates = async () => {
    setUpdateStatus("checking");
    setUpdateError(null);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const result = await check();
      if (result?.available) {
        setUpdateStatus(result);
      } else {
        setUpdateStatus("uptodate");
      }
    } catch (err) {
      setUpdateError("Could not check for updates.");
      setUpdateStatus(null);
    }
  };

  const downloadAndInstall = async (update) => {
    setUpdateStatus("downloading");
    try {
      let totalBytes = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            totalBytes = event.data.contentLength;
            break;
          case 'Progress':
            if (totalBytes > 0) {
              setProgress((event.data.chunkLength / totalBytes) * 100);
            }
            break;
        }
      });
      setUpdateStatus("done");
    } catch (err) {
      setUpdateError("Failed to update.");
      setUpdateStatus(null);
    }
  };

  return (
    <div className="page settings-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure application settings and view system information.</p>
        </div>
      </header>

      <div className="scroll-content">
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          
          {/* App Updates */}
          <div className="card settings-update-card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3><Icon name="download" size={18} /> App Updates</h3>
                <p className="card-desc">Check for the latest features and security patches</p>
              </div>
              <div className={`status-badge ${updateStatus === 'uptodate' ? 'status-active' : 'status-inactive'}`}>
                v{APP_VERSION}
              </div>
            </div>
            
            <div className="card-body">
              {updateError && <div className="error-text" style={{ marginBottom: 12 }}>{updateError}</div>}
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {!updateStatus || updateStatus === 'uptodate' || updateStatus === 'checking' ? (
                  <button 
                    className="btn btn-primary" 
                    onClick={checkForUpdates}
                    disabled={updateStatus === 'checking'}
                  >
                    {updateStatus === 'checking' ? 'Checking...' : (updateStatus === 'uptodate' ? 'Up to date' : 'Check for Updates')}
                  </button>
                ) : updateStatus === 'downloading' ? (
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.85rem' }}>
                      <span>Downloading update...</span>
                      <span>{Math.round(progress)}%</span>
                    </div>
                    <div style={{ width: '100%', height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${progress}%`, height: '100%', background: 'var(--color-primary)', transition: 'width 0.2s' }} />
                    </div>
                  </div>
                ) : updateStatus === 'done' ? (
                  <div style={{ color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="check-circle" size={18} /> Update installed. Restart app to apply.
                  </div>
                ) : (
                  <div>
                    <div style={{ marginBottom: 12, fontSize: '0.9rem' }}>
                      <strong>v{updateStatus.version}</strong> is available!
                      <p style={{ marginTop: 4, color: 'var(--text-secondary)' }}>{updateStatus.body}</p>
                    </div>
                    <button className="btn btn-primary" onClick={() => downloadAndInstall(updateStatus)}>
                      Download & Install
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 24, marginTop: 24 }}>
            {/* System Info */}
            <div className="card admin-info" style={{ flex: 1.5 }}>
              <div className="card-header">
                <h3>System Identity</h3>
              </div>
              <div className="card-body">
                <div className="settings-row">
                  <span className="settings-label">Hardware ID</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className="settings-value" style={{ fontFamily: 'monospace' }}>
                      {hardwareInfo?.hardware_id || "Calculating..."}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Identifies your machine for security quotas.</span>
                  </div>
                </div>
                <div className="settings-row">
                  <span className="settings-label">Device Name</span>
                  <span className="settings-value">{hardwareInfo?.device_name || "—"}</span>
                </div>
                <div className="settings-row" style={{ borderBottom: 'none' }}>
                  <span className="settings-label">OS Platform</span>
                  <span className="settings-value">{hardwareInfo?.os || "—"}</span>
                </div>
              </div>
            </div>

            {/* Account Info */}
            <div className="card admin-info" style={{ flex: 1 }}>
              <div className="card-header">
                <h3>Account</h3>
              </div>
              <div className="card-body">
                <div className="settings-row">
                  <span className="settings-label">Name</span>
                  <span className="settings-value">{user?.name || "—"}</span>
                </div>
                <div className="settings-row">
                  <span className="settings-label">Email</span>
                  <span className="settings-value">{user?.email || "—"}</span>
                </div>
                <div className="settings-row" style={{ borderBottom: "none", paddingBottom: 0, marginTop: 12 }}>
                  <button className="btn btn-danger" onClick={logout} style={{ width: '100%' }}>
                    <Icon name="logout" size={16} /> Sign Out
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
