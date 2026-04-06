import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "../context/AuthContext";
import Icon from "../components/Icon";
import api, { PROXY_URL } from "../services/api";

export default function ConnectionPage() {
  const { user, hardwareInfo } = useAuth();
  
  // Status states
  const [isProxyEnabled, setIsProxyEnabled] = useState(false);
  
  // Loading & Message states
  const [proxyLoading, setProxyLoading] = useState("");
  const [proxyMsg, setProxyMsg] = useState("");

  const refreshStatus = async () => {
    try {
      // Status check: look for any URL that starts with our PROXY_URL + /s/ prefix
      const status = await invoke("get_gemini_sync_status", { proxyUrl: PROXY_URL });
      setIsProxyEnabled(status.is_synced);
    } catch {}
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  const connectIDE = async () => {
    setProxyLoading("connect");
    setProxyMsg("");
    try {
      // Step 1: Prepare SSL bundle for proxy TLS (creates ~/.config/antigravity/ca-bundle.pem)
      setProxyMsg("Preparing secure connection...");
      try { await invoke('prepare_ssl_bundle'); } catch (e) { console.warn('SSL bundle:', e); }

      // Step 2: Get route token + pool access token from backend
      setProxyMsg("Fetching account details...");
      const res = await api.getRouteToken();
      const route_token = res.route_token;

      if (!res.access_token) {
        throw new Error("No active account found. Please activate an account from the Dashboard first.");
      }

      // Step 2: Inject the real pool token into IDE's SQLite
      setProxyMsg("Linking account to IDE...");
      await invoke('inject_real_token', { accessToken: res.access_token });

      // Step 3: Restart IDE — it boots with real token, loads models/profile directly from Google
      setProxyMsg("Restarting IDE (loading account)...");
      await invoke("restart_antigravity");

      // Step 4: Poll until IDE process is running (up to 20 seconds)
      let ideDetected = false;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          ideDetected = await invoke("is_antigravity_running");
          if (ideDetected) {
            setProxyMsg("IDE detected, waiting for initialization...");
            break;
          }
        } catch {}
        setProxyMsg(`Waiting for IDE to start... (${i + 1}s)`);
      }

      // Step 5: Give the IDE time to make its initial Google requests (models, profile, etc.)
      if (ideDetected) {
        for (let i = 5; i > 0; i--) {
          setProxyMsg(`Initializing IDE... (${i}s)`);
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      // Step 5: Silently inject the proxy URL into settings.json
      // IDE hot-reads settings changes — code generation will route through our proxy
      const fullProxyUrl = `${PROXY_URL}/s/${route_token}`;
      setProxyMsg("Enabling code generation...");
      await invoke("sync_gemini_config", { proxyUrl: fullProxyUrl });

      setProxyMsg("✓ IDE linked! Models loaded, account active.");
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
      // Step 1: Notify backend to deactivate proxy + drop token from proxy server
      setProxyMsg("Disconnecting account...");
      try { await api.deactivateProxy(); } catch (e) { console.warn('Deactivate:', e); }

      // Step 2: Wipe the access token from IDE's SQLite DB
      setProxyMsg("Removing account credentials...");
      try { await invoke("wipe_antigravity_tokens"); } catch (e) { console.warn('Wipe tokens:', e); }

      // Step 3: Remove proxy settings (removes jetski.cloudCodeUrl)
      setProxyMsg("Removing account configuration...");
      await invoke("restore_gemini_config");

      // Step 4: Restart IDE
      setProxyMsg("Restarting Antigravity IDE...");
      await invoke("restart_antigravity");

      setProxyMsg("✓ Account removed, credentials wiped, IDE disconnected!");
      await refreshStatus();
    } catch (e) {
      setProxyMsg(`Disconnection Error: ${e}`);
    }
    setProxyLoading("");
  };

  const isConnected = isProxyEnabled;

  return (
    <div className="page connection-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">IDE Account Link</h1>
          <p className="page-subtitle">Bind the IDE specifically to your generated cloud caching accounts.</p>
        </div>
      </header>

      <div className="scroll-content">
        <div style={{ maxWidth: 800, margin: '0 auto', paddingBottom: 40 }}>
          
          <div style={{
            background: 'var(--bg-card)',
            border: isConnected ? '1px solid rgba(0, 214, 143, 0.2)' : '1px solid rgba(255,255,255,0.06)',
            borderRadius: '16px',
            padding: '32px',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            boxShadow: isConnected ? '0 8px 32px rgba(0, 214, 143, 0.04)' : 'none'
          }}>
            {/* Subtle top glow indicator */}
            {isConnected && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, rgba(0,214,143,0.8), transparent)', opacity: 0.6 }}></div>}

             <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24 }}>
                {/* Left Side: Icon & Copy */}
                <div style={{ display: 'flex', gap: 20 }}>
                   <div style={{
                     width: 54, height: 54, borderRadius: '14px',
                     background: isConnected ? 'rgba(0, 214, 143, 0.1)' : 'rgba(255,255,255,0.03)',
                     display: 'flex', alignItems: 'center', justifyContent: 'center',
                     border: isConnected ? '1px solid rgba(0, 214, 143, 0.2)' : '1px solid rgba(255,255,255,0.05)',
                     boxShadow: isConnected ? 'inset 0 0 20px rgba(0,214,143,0.05)' : 'none'
                   }}>
                     <Icon name="cpu" size={26} color={isConnected ? '#00d68f' : 'var(--text-muted)'} />
                   </div>
                   
                   <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 2 }}>
                     <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <h2 style={{ fontSize: '1.15rem', margin: 0, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.2px' }}>Account Link Server</h2>
                        <span style={{ 
                          padding: '4px 10px', borderRadius: '100px', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px',
                          background: isConnected ? 'rgba(0, 214, 143, 0.1)' : 'rgba(255,255,255,0.05)',
                          color: isConnected ? '#00d68f' : 'var(--text-muted)',
                          border: isConnected ? '1px solid rgba(0, 214, 143, 0.15)' : '1px solid rgba(255,255,255,0.05)',
                          display: 'flex', alignItems: 'center', gap: 6
                        }}>
                          {isConnected && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00d68f', boxShadow: '0 0 8px #00d68f' }}></span>}
                          {isConnected ? 'IDE Securely Linked' : 'Offline'}
                        </span>
                     </div>
                     <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 460 }}>
                       Route your IDE securely to access any of your permitted Google accounts. Once linked, you can instantly swap active accounts from the dashboard.
                     </p>
                   </div>
                </div>

                {/* Right Side: Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 160 }}>
                  <button 
                    className={`btn ${isConnected ? 'btn-secondary' : 'btn-primary'}`}
                    onClick={connectIDE} 
                    disabled={proxyLoading !== ""}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontSize: '0.9rem', borderRadius: '8px', width: '100%', justifyContent: 'center' }}
                  >
                    <Icon name={proxyLoading === 'connect' ? "loader" : (isConnected ? "refresh-cw" : "link")} size={16} className={proxyLoading === 'connect' ? 'spin' : ''} />
                    {proxyLoading === "connect" ? "Linking..." : (isConnected ? "Refresh Link" : "Link IDE Accounts")}
                  </button>
                  
                  {isConnected && (
                    <button 
                      className="btn" 
                      onClick={disconnectIDE} 
                      disabled={proxyLoading !== ""}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontSize: '0.9rem', borderRadius: '8px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)', width: '100%', justifyContent: 'center' }}
                    >
                      <Icon name="x-circle" size={16} />
                      {proxyLoading === "disconnect" ? "Disconnecting..." : "Disconnect IDE"}
                    </button>
                  )}
                </div>
             </div>
            
            {/* Success/Error Messaging */}
            {proxyMsg && (
              <div 
                style={{
                  marginTop: 8,
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: proxyMsg.includes('Error') ? 'rgba(255,80,100,0.08)' : 'rgba(0,214,143,0.08)',
                  color: proxyMsg.includes('Error') ? '#ff5064' : '#00d68f',
                  border: proxyMsg.includes('Error') ? '1px solid rgba(255,80,100,0.2)' : '1px solid rgba(0,214,143,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  fontSize: '0.85rem',
                  fontWeight: 500
                }}
              >
                <Icon name={proxyMsg.includes('Error') ? "alert-circle" : "check-circle"} size={16} />
                <span>{proxyMsg}</span>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
