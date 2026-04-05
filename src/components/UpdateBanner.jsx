import { useState, useEffect } from 'react';
import Icon from './Icon';

const APP_VERSION = '1.0.10';

export default function UpdateBanner() {
  const [update, setUpdate] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    checkForUpdate();
  }, []);

  async function checkForUpdate() {
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const result = await check();
      if (result?.available) {
        setUpdate(result);
      }
    } catch {
      // Silently fail — updater not available in dev mode
    }
  }

  async function downloadAndInstall() {
    if (!update) return;
    setDownloading(true);
    try {
      let totalBytes = 0;
      let downloadedBytes = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalBytes = event.data.contentLength || 0;
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            setProgress(Math.round((downloadedBytes / totalBytes) * 100));
          }
        } else if (event.event === 'Finished') {
          setProgress(100);
        }
      });
      // Restart the app after install
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err) {
      console.error('Update failed:', err);
      setDownloading(false);
    }
  }

  if (!update || dismissed) return null;

  // Optional update — top banner
  return (
    <div className="update-banner">
      <div className="update-banner-content">
        <Icon name="zap" size={16} color="#4ade80" />
        <span>
          <strong>v{update.version}</strong> is available
        </span>
      </div>
      <div className="update-banner-actions">
        {downloading ? (
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {progress > 0 ? `${progress}%` : 'Downloading...'}
          </span>
        ) : (
          <button className="update-btn small" onClick={downloadAndInstall}>
            <Icon name="download" size={14} />
            Update
          </button>
        )}
        {!downloading && (
          <button className="update-dismiss" onClick={() => setDismissed(true)}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

export { APP_VERSION };
