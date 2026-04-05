import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "../context/AuthContext";
import Icon from "../components/Icon";
import { PROXY_URL } from "../services/api";

export default function ConnectionPage() {
  const { user, hardwareInfo } = useAuth();
  
  // Status states
  const [wrapperStatus, setWrapperStatus] = useState({ wrapped: false });
  const [isProxyEnabled, setIsProxyEnabled] = useState(false);
  
  // Loading & Message states
  const [proxyLoading, setProxyLoading] = useState("");
  const [proxyMsg, setProxyMsg] = useState("");

  const refreshStatus = async () => {
    try {
      const status = await invoke("get_gemini_sync_status", { proxyUrl: PROXY_URL });
      setIsProxyEnabled(status.is_synced);
    } catch {}

    try {
      const ws = await invoke("get_wrapper_status");
      setWrapperStatus(ws);
    } catch {}
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  const connectIDE = async () => {
    setProxyLoading("connect");
    setProxyMsg("");
    try {
      // Step 1: Kill Antigravity FIRST so the language server binary is unlocked
      setProxyMsg("Stopping Antigravity...");
      try {
        await invoke("kill_antigravity");
      } catch {}
      await new Promise(r => setTimeout(r, 2500)); // Wait for full process exit

      // Step 2: Inject settings into Antigravity's settings.json
      await invoke("sync_gemini_config", { proxyUrl: PROXY_URL });

      // Step 3: Wrap the language server binary (safely overwrites previous script because we unlocked the directory)
      try {
        await invoke("wrap_lang_server", { proxyUrl: PROXY_URL });
      } catch (e) {
        console.warn("Wrapper failed:", e);
      }

      // No token wipe because we keep user's actual token

      // Step 5: Relaunch Antigravity with new config
      await new Promise(r => setTimeout(r, 500));
      try {
        await invoke("restart_antigravity");
      } catch {}

      setProxyMsg("✓ App connected! Traffic is now routing securely to Antigravity Central.");
      await refreshStatus();
    } catch (e) {
      setProxyMsg(`Connection Error: ${e}`);
    }
    setProxyLoading("");
  };

  const disconnectIDE = async () => {
    setProxyLoading("disconnect");
    setProxyMsg("");
    try {
      // Step 1: Kill Antigravity first so binary is unlocked
      setProxyMsg("Stopping Antigravity...");
      try {
        await invoke("kill_antigravity");
      } catch {}
      await new Promise(r => setTimeout(r, 2500));

      // Step 2: Restore settings & unwrap binary
      await invoke("restore_gemini_config");
      try {
        await invoke("unwrap_lang_server");
      } catch (e) {}

      // Step 3: Relaunch
      await new Promise(r => setTimeout(r, 500));
      try {
        await invoke("restart_antigravity");
      } catch {}

      setProxyMsg("✓ Network bridge disconnected. IDE restored to direct connection.");
      await refreshStatus();
    } catch (e) {
      setProxyMsg(`Disconnection Error: ${e}`);
    }
    setProxyLoading("");
  };

  const isConnected = isProxyEnabled && wrapperStatus.wrapped;

  return (
    <div className="page connection-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">IDE Connection</h1>
          <p className="page-subtitle">Configure the secure network bridge between your IDE and the dashboard.</p>
        </div>
      </header>

      <div className="scroll-content">
        <div style={{ maxWidth: 800, margin: '0 auto', paddingBottom: 40 }}>
          
          <div className="card connection-wizard">
            <div className="wizard-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--primary-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
                  <Icon name="monitor" size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: '1.2rem', marginBottom: 2 }}>Secure Setup</h2>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Complete these steps to bridge your IDE</p>
                </div>
              </div>
              <div className={`status-badge ${isConnected ? 'status-active' : 'status-inactive'}`} style={{ padding: '6px 12px', fontSize: '0.85rem' }}>
                <Icon name={isConnected ? "check-circle" : "x-circle"} size={14} style={{ marginRight: 6 }} />
                {isConnected ? 'Bridge Active' : 'Offline'}
              </div>
            </div>

            <div className="wizard-steps-container">
              {/* Step 1 */}
              <div className={`wizard-row ${isConnected ? 'completed' : 'active'}`}>
                <div className="wizard-indicator">
                  <div className="step-circle">1</div>
                </div>
                
                <div className="wizard-card">
                  <div className="wizard-card-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div className="wizard-icon-box bg-green">
                        <Icon name="cpu" size={18} />
                      </div>
                      <div>
                        <h3>Network Bridge</h3>
                        <p>Bind the IDE's core processes to our high-performance network bridge.</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="wizard-card-body">
                    <ul className="wizard-checklist">
                      <li className={isProxyEnabled ? 'checked' : 'pending'}>
                        <Icon name={isProxyEnabled ? "check" : "minus"} size={14} />
                        <span>IDE settings mapped to localhost</span>
                      </li>
                      <li className={wrapperStatus.wrapped ? 'checked' : 'pending'}>
                        <Icon name={wrapperStatus.wrapped ? "check" : "minus"} size={14} />
                        <span>Language Server networking wrapped</span>
                      </li>
                    </ul>

                    <div className="wizard-action-row mt-16">
                        <button 
                        className={`btn ${isConnected ? 'btn-secondary' : 'btn-primary'}`}
                        onClick={connectIDE} 
                        disabled={proxyLoading !== ""}
                        style={{ minWidth: 160 }}
                      >
                        <Icon name={isConnected ? "refresh-cw" : "zap"} size={16} />
                        {proxyLoading === "connect" ? "Bridging..." : (isConnected ? "Force Re-Sync" : "Enable Bridge")}
                      </button>
                      
                      {isConnected && (
                        <button 
                          className="btn btn-danger" 
                          onClick={disconnectIDE} 
                          disabled={proxyLoading !== ""}
                        >
                          <Icon name="x-circle" size={16} />
                          {proxyLoading === "disconnect" ? "Disconnecting..." : "Disconnect IDE"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {proxyMsg && (
              <div className={`card-footer-msg ${proxyMsg.includes('Error') ? 'msg-error' : 'msg-success'}`}>
                <Icon name={proxyMsg.includes('Error') ? "alert-circle" : "check-circle"} size={18} />
                <span>{proxyMsg}</span>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
