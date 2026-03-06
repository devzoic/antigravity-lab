import { useState, useEffect } from 'react';
import api from '../services/api';
import Icon from './Icon';

const APP_VERSION = '1.0.0';

export default function UpdateBanner() {
  const [update, setUpdate] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    api.checkUpdate(APP_VERSION)
      .then(data => {
        if (data.update_available) setUpdate(data);
      })
      .catch(() => {}); // Silently fail
  }, []);

  if (!update || dismissed) return null;

  const handleDownload = async () => {
    if (update.download_url) {
      try {
        // Try Tauri's opener for desktop
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(update.download_url);
      } catch {
        // Fallback to browser
        window.open(update.download_url, '_blank');
      }
    }
  };

  // Mandatory update — full screen blocker
  if (update.force_update) {
    return (
      <div className="update-overlay">
        <div className="update-modal">
          <div className="update-icon-ring">
            <Icon name="download" size={32} color="#f87171" />
          </div>
          <h2>Update Required</h2>
          <p className="update-version">
            v{APP_VERSION} → v{update.latest_version}
          </p>
          {update.changelog && (
            <div className="update-changelog">{update.changelog}</div>
          )}
          <p className="update-desc">
            A mandatory update is required to continue using this app.
          </p>
          {update.download_url ? (
            <button className="update-btn primary" onClick={handleDownload}>
              <Icon name="download" size={16} />
              Download v{update.latest_version}
            </button>
          ) : (
            <p className="update-desc">Contact support for the download link.</p>
          )}
        </div>
      </div>
    );
  }

  // Optional update — top banner
  return (
    <div className="update-banner">
      <div className="update-banner-content">
        <Icon name="zap" size={16} color="#4ade80" />
        <span>
          <strong>v{update.latest_version}</strong> is available
          {update.changelog && <span className="update-changelog-inline"> — {update.changelog}</span>}
        </span>
      </div>
      <div className="update-banner-actions">
        {update.download_url && (
          <button className="update-btn small" onClick={handleDownload}>
            <Icon name="download" size={14} />
            Update
          </button>
        )}
        <button className="update-dismiss" onClick={() => setDismissed(true)}>
          ✕
        </button>
      </div>
    </div>
  );
}

export { APP_VERSION };
