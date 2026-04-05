use axum::{
    body::Body,
    extract::{Request, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::get,
    Router,
};
use bytes::Bytes;
use futures::StreamExt;
use rcgen::{BasicConstraints, CertificateParams, IsCa, KeyPair};
use reqwest::{header, Client};
use rustls::ServerConfig;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{oneshot, Mutex, RwLock};
use tokio_rustls::TlsAcceptor;

// ─── Google domains to MITM (swap tokens) ────────────────────────
const MITM_DOMAINS: [&str; 3] = [
    "cloudcode-pa.googleapis.com",
    "daily-cloudcode-pa.sandbox.googleapis.com",
    "cloudaicompanion.googleapis.com",
];

fn should_mitm(host: &str) -> bool {
    let h = host.split(':').next().unwrap_or(host);
    MITM_DOMAINS.iter().any(|d| h == *d)
}

// ─── Active Account State ───────────────────────────────────────────
#[derive(Debug, Clone, Default)]
pub struct ActiveAccount {
    pub access_token: String,
    pub refresh_token: String,
    pub email: String,
    pub project_id: String,
    pub expires_at: i64,
}

// ─── Proxy Log Entry ────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyLogEntry {
    pub timestamp: String,
    pub model: String,
    pub method: String,
    pub account_email: String,
    pub status: String,
    pub detail: String,
}

// ─── CA Certificate Manager ─────────────────────────────────────────
pub struct CaManager {
    ca_cert: rcgen::Certificate,
    ca_key: KeyPair,
}

impl std::fmt::Debug for CaManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CaManager").finish()
    }
}

impl CaManager {
    /// Generate an ephemeral CA certificate (never hits disk)
    pub fn create_ephemeral() -> Result<Self, String> {
        let ca_key = KeyPair::generate().map_err(|e| format!("Generate CA key: {}", e))?;

        let mut params = CertificateParams::default();
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, "Antigravity Ephemeral CA");
        params
            .distinguished_name
            .push(rcgen::DnType::OrganizationName, "Antigravity Lab");

        let ca_cert = params
            .self_signed(&ca_key)
            .map_err(|e| format!("Self-sign CA: {}", e))?;

        tracing::info!("✓ Generated new ephemeral CA in memory");
        Ok(Self { ca_cert, ca_key })
    }

    /// Generate a TLS server config for a specific domain
    pub fn server_config_for_domain(
        &self,
        domain: &str,
    ) -> Result<Arc<ServerConfig>, String> {
        let san = vec![domain.to_string()];
        let key = KeyPair::generate()
            .map_err(|e| format!("Generate domain key: {}", e))?;

        let mut params = CertificateParams::new(san)
            .map_err(|e| format!("Cert params: {}", e))?;
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, domain);

        let cert = params
            .signed_by(&key, &self.ca_cert, &self.ca_key)
            .map_err(|e| format!("Sign domain cert: {}", e))?;

        // Build rustls ServerConfig
        let cert_der =
            rustls::pki_types::CertificateDer::from(cert.der().to_vec());
        let key_der =
            rustls::pki_types::PrivateKeyDer::try_from(key.serialize_der())
                .map_err(|e| format!("Key DER: {}", e))?;

        let config = ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![cert_der], key_der)
            .map_err(|e| format!("ServerConfig: {}", e))?;

        Ok(Arc::new(config))
    }

    /// Generate a CertifiedKey for SNI-based dynamic cert resolution
    pub fn certified_key_for_domain(
        &self,
        domain: &str,
    ) -> Result<Arc<rustls::sign::CertifiedKey>, String> {
        let san = vec![domain.to_string()];
        let key = KeyPair::generate()
            .map_err(|e| format!("Generate domain key: {}", e))?;
        let mut params = CertificateParams::new(san)
            .map_err(|e| format!("Cert params: {}", e))?;
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, domain);
        let cert = params
            .signed_by(&key, &self.ca_cert, &self.ca_key)
            .map_err(|e| format!("Sign domain cert: {}", e))?;
        let cert_der =
            rustls::pki_types::CertificateDer::from(cert.der().to_vec());
        let key_der =
            rustls::pki_types::PrivateKeyDer::try_from(key.serialize_der())
                .map_err(|e| format!("Key DER: {}", e))?;
        let signing_key =
            rustls::crypto::ring::sign::any_supported_type(&key_der)
                .map_err(|e| format!("Signing key: {:?}", e))?;
        Ok(Arc::new(rustls::sign::CertifiedKey::new(
            vec![cert_der],
            signing_key,
        )))
    }
}

// ─── Dynamic SNI-based Certificate Resolver ─────────────────────────

#[derive(Debug)]
struct DynamicCertResolver {
    ca_manager: Arc<CaManager>,
    cache: StdMutex<HashMap<String, Arc<rustls::sign::CertifiedKey>>>,
}

impl rustls::server::ResolvesServerCert for DynamicCertResolver {
    fn resolve(
        &self,
        client_hello: rustls::server::ClientHello<'_>,
    ) -> Option<Arc<rustls::sign::CertifiedKey>> {
        let sni = client_hello.server_name()?.to_string();
        {
            let cache = self.cache.lock().ok()?;
            if let Some(key) = cache.get(&sni) {
                return Some(key.clone());
            }
        }
        tracing::info!("🔏 Generating TLS cert for SNI: {}", sni);
        let key = self.ca_manager.certified_key_for_domain(&sni).ok()?;
        {
            let mut cache = self.cache.lock().ok()?;
            cache.insert(sni, key.clone());
        }
        Some(key)
    }
}

// ─── Proxy State ────────────────────────────────────────────────────
#[derive(Clone)]
pub struct ProxyState {
    pub active_account: Arc<RwLock<Option<ActiveAccount>>>,
    pub http_client: Client,
    pub logs: Arc<Mutex<Vec<ProxyLogEntry>>>,
    pub spoofed_version: Arc<RwLock<String>>,
    pub ca_manager: Arc<CaManager>,
    pub direct_tls_config: Arc<ServerConfig>,
    pub resolved_ips: Arc<HashMap<String, std::net::SocketAddr>>,
}

impl ProxyState {
    pub async fn push_log(
        &self,
        model: &str,
        method: &str,
        email: &str,
        status: &str,
        detail: &str,
    ) {
        let entry = ProxyLogEntry {
            timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
            model: model.to_string(),
            method: method.to_string(),
            account_email: email.to_string(),
            status: status.to_string(),
            detail: detail.to_string(),
        };
        let mut logs = self.logs.lock().await;
        logs.push(entry);
        if logs.len() > 200 {
            let excess = logs.len() - 200;
            logs.drain(..excess);
        }
    }
}

// ─── Proxy Server ───────────────────────────────────────────────────

pub struct ProxyServer {
    shutdown_tx: Option<oneshot::Sender<()>>,
    pub state: ProxyState,
}

impl ProxyServer {
    pub async fn start(
        port: u16,
    ) -> Result<(Self, tokio::task::JoinHandle<()>), String> {
        // Pre-resolve Google domain IPs BEFORE any DNS hijacking.
        // This prevents upstream loops when /etc/hosts points domains → 127.0.0.1
        let mut client_builder = Client::builder()
            .connect_timeout(std::time::Duration::from_secs(30))
            .pool_max_idle_per_host(8)
            .pool_idle_timeout(std::time::Duration::from_secs(90))
            .timeout(std::time::Duration::from_secs(600));

        let mut resolved_ips = HashMap::new();
        for domain in &MITM_DOMAINS {
            if let Ok(addr) = tokio::net::lookup_host(format!("{}:443", domain))
                .await
                .and_then(|mut addrs| addrs.next().ok_or_else(|| {
                    std::io::Error::new(std::io::ErrorKind::NotFound, "no addrs")
                }))
            {
                tracing::info!("📌 Pinned {} → {}", domain, addr);
                client_builder = client_builder.resolve(domain, addr);
                resolved_ips.insert(domain.to_string(), addr);
            }
        }

        let http_client = client_builder
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        let ca_manager = CaManager::create_ephemeral()?;
        let ca_manager = Arc::new(ca_manager);

        // Build TLS config with dynamic SNI cert resolver for direct TLS
        let resolver = Arc::new(DynamicCertResolver {
            ca_manager: ca_manager.clone(),
            cache: StdMutex::new(HashMap::new()),
        });
        let mut tls_cfg = ServerConfig::builder()
            .with_no_client_auth()
            .with_cert_resolver(resolver);
        tls_cfg.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];

        let state = ProxyState {
            active_account: Arc::new(RwLock::new(None)),
            http_client,
            logs: Arc::new(Mutex::new(Vec::new())),
            spoofed_version: Arc::new(RwLock::new("1.21.9".to_string())),
            ca_manager,
            direct_tls_config: Arc::new(tls_cfg),
            resolved_ips: Arc::new(resolved_ips),
        };

        // Axum router only handles non-CONNECT HTTP requests and healthz
        let app = Router::new()
            .route("/healthz", get(health_check))
            .fallback(handle_http_proxy)
            .layer(
                tower_http::cors::CorsLayer::new()
                    .allow_origin(tower_http::cors::Any)
                    .allow_methods(tower_http::cors::Any)
                    .allow_headers(tower_http::cors::Any),
            )
            .with_state(state.clone());

        let addr = format!("127.0.0.1:{}", port);
        let listener = tokio::net::TcpListener::bind(&addr)
            .await
            .map_err(|e| format!("Failed to bind {}: {}", addr, e))?;

        tracing::info!("🚀 MITM Proxy started on http://{}", addr);

        let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();

        let state_clone = state.clone();
        let handle = tokio::spawn(async move {
            use hyper::server::conn::http1;
            use hyper_util::rt::TokioIo;
            use hyper_util::service::TowerToHyperService;

            loop {
                tokio::select! {
                    res = listener.accept() => {
                        match res {
                            Ok((stream, addr)) => {
                                // Peek at first bytes to detect CONNECT
                                let app_clone = app.clone();
                                let state_for_conn = state_clone.clone();

                                tokio::spawn(async move {
                                    let mut peek_buf = [0u8; 8];
                                    match stream.peek(&mut peek_buf).await {
                                        Ok(n) if n >= 7 && &peek_buf[..7] == b"CONNECT" => {
                                            // Handle CONNECT at raw TCP level
                                            if let Err(e) = handle_connect_direct(state_for_conn, stream).await {
                                                tracing::error!("CONNECT handler error: {}", e);
                                            }
                                        }
                                        Ok(n) if n >= 1 && peek_buf[0] == 0x16 => {
                                            // Direct TLS (DNS-hijacked gRPC client)
                                            if let Err(e) = handle_direct_tls(state_for_conn, stream).await {
                                                tracing::error!("Direct TLS error: {}", e);
                                            }
                                        }
                                        _ => {
                                            // Regular HTTP — pass to axum
                                            let io = TokioIo::new(stream);
                                            let service = TowerToHyperService::new(app_clone);
                                            if let Err(e) = http1::Builder::new()
                                                .preserve_header_case(true)
                                                .serve_connection(io, service)
                                                .await
                                            {
                                                tracing::debug!("HTTP connection ended: {:?}", e);
                                            }
                                        }
                                    }
                                });
                            }
                            Err(e) => tracing::error!("Accept error: {:?}", e),
                        }
                    }
                    _ = &mut shutdown_rx => {
                        tracing::info!("Proxy server shutting down");
                        break;
                    }
                }
            }
        });

        Ok((
            Self {
                shutdown_tx: Some(shutdown_tx),
                state,
            },
            handle,
        ))
    }

    pub fn stop(mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

// ─── Route Handlers ─────────────────────────────────────────────────

async fn health_check() -> Json<Value> {
    Json(json!({"status": "ok", "mode": "mitm"}))
}

// ─── CONNECT Tunnel (Raw TCP) ───────────────────────────────────────

/// Handle CONNECT at raw TCP level — bypasses axum/hyper upgrade entirely
async fn handle_connect_direct(
    state: ProxyState,
    mut stream: tokio::net::TcpStream,
) -> Result<(), String> {
    // Read the full CONNECT request headers
    let mut header_buf = vec![0u8; 8192];
    let mut total_read = 0;

    loop {
        let n = stream
            .read(&mut header_buf[total_read..])
            .await
            .map_err(|e| format!("Read CONNECT headers: {}", e))?;
        if n == 0 {
            return Err("Connection closed before headers complete".into());
        }
        total_read += n;

        // Look for \r\n\r\n (end of headers)
        if total_read >= 4 {
            if header_buf[..total_read]
                .windows(4)
                .any(|w| w == b"\r\n\r\n")
            {
                break;
            }
        }

        if total_read >= 8192 {
            return Err("CONNECT headers too large".into());
        }
    }

    let request_str = String::from_utf8_lossy(&header_buf[..total_read]);
    let first_line = request_str.lines().next().unwrap_or("");

    // Parse "CONNECT host:port HTTP/1.1"
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    if parts.len() < 2 || parts[0] != "CONNECT" {
        return Err(format!("Invalid CONNECT line: {}", first_line));
    }

    let host = parts[1].to_string();
    let domain = host.split(':').next().unwrap_or(&host).to_string();
    let is_google = should_mitm(&domain);

    tracing::info!(
        "🔗 CONNECT {} → {}",
        host,
        if is_google { "MITM" } else { "PASSTHROUGH" }
    );

    // Send 200 Connection Established
    stream
        .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        .await
        .map_err(|e| format!("Write 200: {}", e))?;
    stream
        .flush()
        .await
        .map_err(|e| format!("Flush 200: {}", e))?;

    if is_google {
        handle_mitm_tunnel_direct(state, stream, &host, &domain).await
    } else {
        handle_passthrough_direct(stream, &host).await
    }
}

// ─── Direct TLS handler (DNS-hijacked connections) ──────────────────

/// Handle direct TLS from the DNS-hijacked language server.
/// The server thinks it's connecting to googleapis.com but DNS
/// resolved to 127.0.0.1, so we receive a raw TLS ClientHello.
async fn handle_direct_tls(
    state: ProxyState,
    stream: tokio::net::TcpStream,
) -> Result<(), String> {
    let acceptor = TlsAcceptor::from(state.direct_tls_config.clone());
    let tls_stream = acceptor
        .accept(stream)
        .await
        .map_err(|e| format!("Direct TLS accept failed: {}", e))?;

    let sni = tls_stream
        .get_ref()
        .1
        .server_name()
        .unwrap_or("daily-cloudcode-pa.googleapis.com")
        .to_string();

    tracing::info!("🔐 Direct TLS established — SNI: {} (DNS-hijacked)", sni);
    state
        .push_log("gRPC", &format!("TLS→{}", sni), "-", "🔗 CONNECTED", "DNS-hijacked direct TLS")
        .await;

    let io = hyper_util::rt::TokioIo::new(tls_stream);
    let state_clone = state.clone();
    let domain = sni.clone();

    let service =
        hyper::service::service_fn(
            move |req: hyper::Request<hyper::body::Incoming>| {
                let state = state_clone.clone();
                let domain = domain.clone();
                async move { 
                    match handle_mitm_request_h2(state, req, &domain).await {
                        Ok(res) => {
                            let mapped = res.map(|b| axum::body::Body::new(b));
                            Ok::<_, std::convert::Infallible>(mapped)
                        }
                        Err(e) => {
                            let mapped = hyper::Response::builder()
                                .status(502)
                                .body(axum::body::Body::from(e))
                                .unwrap();
                            Ok::<_, std::convert::Infallible>(mapped)
                        }
                    }
                }
            },
        );

    let result =
        hyper::server::conn::http2::Builder::new(hyper_util::rt::TokioExecutor::new())
            .serve_connection(io, service)
            .await;

    if let Err(e) = result {
        tracing::debug!("Direct TLS connection ended for {}: {:?}", sni, e);
    }
    Ok(())
}

/// Transparent TCP passthrough — pipe bytes between client and upstream
async fn handle_passthrough_direct(
    client_stream: tokio::net::TcpStream,
    host: &str,
) -> Result<(), String> {
    let upstream = tokio::net::TcpStream::connect(host)
        .await
        .map_err(|e| format!("Connect to {}: {}", host, e))?;

    let (mut client_read, mut client_write) = tokio::io::split(client_stream);
    let (mut upstream_read, mut upstream_write) = tokio::io::split(upstream);

    let client_to_upstream = async {
        let mut buf = vec![0u8; 8192];
        loop {
            let n = client_read.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            upstream_write.write_all(&buf[..n]).await?;
            upstream_write.flush().await?;
        }
        upstream_write.shutdown().await?;
        Ok::<(), std::io::Error>(())
    };

    let upstream_to_client = async {
        let mut buf = vec![0u8; 8192];
        loop {
            let n = upstream_read.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            client_write.write_all(&buf[..n]).await?;
            client_write.flush().await?;
        }
        Ok::<(), std::io::Error>(())
    };

    let _ = tokio::join!(client_to_upstream, upstream_to_client);
    Ok(())
}

/// MITM tunnel — terminate TLS on raw TCP, read requests, swap auth, forward
async fn handle_mitm_tunnel_direct(
    state: ProxyState,
    client_stream: tokio::net::TcpStream,
    host: &str,
    domain: &str,
) -> Result<(), String> {
    // Generate TLS config for this domain
    let tls_config = state.ca_manager.server_config_for_domain(domain)?;
    let acceptor = TlsAcceptor::from(tls_config);

    // Wrap the raw TCP stream in TLS (we are the TLS server)
    let tls_stream = acceptor
        .accept(client_stream)
        .await
        .map_err(|e| format!("TLS accept failed for {}: {}", domain, e))?;

    tracing::info!("🔐 TLS established for {} — serving MITM", domain);

    // Serve HTTP on the decrypted stream
    let io = hyper_util::rt::TokioIo::new(tls_stream);
    let state_clone = state.clone();
    let domain_owned = domain.to_string();

    let service =
        hyper::service::service_fn(
            move |req: hyper::Request<hyper::body::Incoming>| {
                let state = state_clone.clone();
                let domain = domain_owned.clone();
                async move { handle_mitm_request(state, req, &domain).await }
            },
        );

    // Try HTTP/2 first (gRPC uses HTTP/2), fall back to HTTP/1.1
    let result =
        hyper::server::conn::http2::Builder::new(hyper_util::rt::TokioExecutor::new())
            .serve_connection(io, service)
            .await;

    if let Err(e) = result {
        tracing::debug!(
            "MITM connection ended for {}: {:?}",
            domain,
            e
        );
    }

    Ok(())
}

// ─── HTTP/2 gRPC MITM Request Handler ──────────────────────────────────

async fn handle_mitm_request_h2(
    state: ProxyState,
    mut req: hyper::Request<hyper::body::Incoming>,
    domain: &str,
) -> Result<hyper::Response<hyper::body::Incoming>, String> {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let path = uri.path_and_query().map(|pq| pq.to_string()).unwrap_or_else(|| uri.path().to_string());

    tracing::info!("🔀 MITM HTTP/2: {} https://{}{}", method, domain, path);

    let account = state.active_account.read().await.clone();
    let (token, email) = match account {
        Some(acc) => (acc.access_token, acc.email),
        None => {
            tracing::error!("❌ NO ACCOUNT for {}", path);
            return Err("No active account in proxy".to_string());
        }
    };

    req.headers_mut().insert(hyper::header::AUTHORIZATION, format!("Bearer {}", token).parse().unwrap());
    
    let version = state.spoofed_version.read().await.clone();
    req.headers_mut().insert(hyper::header::USER_AGENT, format!("antigravity/{} macos/arm64", version).parse().unwrap());

    // Resolve upstream using pinned IP (to bypass /etc/hosts loop)
    let upstream_addr = state
        .resolved_ips
        .get(domain)
        .copied()
        .unwrap_or_else(|| std::net::SocketAddr::from(([142, 250, 190, 42], 443))); // fallback Google IP

    // Connect raw TCP to Google
    let tcp_stream = match tokio::net::TcpStream::connect(upstream_addr).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("❌ UPSTREAM TCP connect error: {}", e);
            return Err(format!("TCP connect error: {}", e));
        }
    };

    // Build rustls config to Google
    let mut root_store = rustls::RootCertStore::empty();
    for cert in rustls_native_certs::load_native_certs().expect("failed to load system certs") {
        root_store.add(cert).expect("failed to add root cert");
    }
    let mut config = rustls::ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];

    let connector = tokio_rustls::TlsConnector::from(Arc::new(config));
    let server_name = rustls::pki_types::ServerName::try_from(domain.to_string()).unwrap();
    let tls_stream = match connector.connect(server_name, tcp_stream).await {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("❌ UPSTREAM TLS connect error: {}", e);
            return Err(format!("TLS connect error: {}", e));
        }
    };

    let io = hyper_util::rt::TokioIo::new(tls_stream);
    
    // Attempt HTTP/2 Handshake
    let handshake_res = hyper::client::conn::http2::handshake(
        hyper_util::rt::TokioExecutor::new(),
        io,
    ).await;

    let (mut sender, conn) = match handshake_res {
        Ok(res) => res,
        Err(e) => {
            tracing::error!("❌ HTTP/2 handshake error: {}", e);
            return Err(format!("HTTP/2 handshake error: {}", e));
        }
    };

    // Poll the connection continuously
    tokio::spawn(async move {
        if let Err(e) = conn.await {
            tracing::debug!("HTTP/2 connection closed: {}", e);
        }
    });

    state.push_log("gRPC", &path, &email, "⏳ FORWARDING", "Token swap + HTTP/2 forward").await;

    // Send the modified original request
    let response = sender.send_request(req).await.map_err(|e| format!("Send request error: {}", e))?;

    state.push_log("gRPC", &path, &email, "✅ OK", "HTTP/2 Responded/Streaming").await;
    
    Ok(response)
}

// ─── MITM Request Handler ───────────────────────────────────────────

/// Handle a single MITM'd request — swap auth header and forward to Google
async fn handle_mitm_request(
    state: ProxyState,
    req: hyper::Request<hyper::body::Incoming>,
    domain: &str,
) -> Result<hyper::Response<Body>, hyper::Error> {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let path = uri
        .path_and_query()
        .map(|pq| pq.to_string())
        .unwrap_or_else(|| uri.path().to_string());
    let original_headers = req.headers().clone();

    tracing::info!("🔀 MITM: {} https://{}{}", method, domain, path);

    // Get the active pool account token
    let account = {
        let guard = state.active_account.read().await;
        guard.clone()
    };

    let (token, email) = match &account {
        Some(acc) => (acc.access_token.clone(), acc.email.clone()),
        None => {
            state
                .push_log("mitm", &path, "-", "❌ NO ACCOUNT", "No active account")
                .await;
            let resp = hyper::Response::builder()
                .status(503)
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"error":"No active account in proxy"}"#,
                ))
                .unwrap();
            return Ok(resp);
        }
    };

    state
        .push_log("mitm", &path, &email, "⏳ FORWARDING", "Token swap + forward")
        .await;

    // Read the incoming body
    let body_bytes =
        match axum::body::to_bytes(Body::new(req.into_body()), 10 * 1024 * 1024).await
        {
            Ok(b) => b,
            Err(e) => {
                let resp = hyper::Response::builder()
                    .status(400)
                    .body(Body::from(format!("Read body error: {}", e)))
                    .unwrap();
                return Ok(resp);
            }
        };

    // Build upstream URL
    let upstream_url = format!("https://{}{}", domain, path);

    // Build the upstream request, forwarding original headers with token swap
    let version = state.spoofed_version.read().await.clone();
    let user_agent = format!("antigravity/{} macos/arm64", version);

    let mut req_builder = state.http_client.request(method, &upstream_url);

    // Forward original headers, skipping ones we override
    for (name, value) in original_headers.iter() {
        if name == header::AUTHORIZATION
            || name == header::HOST
            || name == header::USER_AGENT
            || name == header::CONTENT_LENGTH
            || name == header::TRANSFER_ENCODING
        {
            continue;
        }
        if let Ok(val_str) = value.to_str() {
            req_builder = req_builder.header(name.as_str(), val_str);
        }
    }

    // Inject pool account token
    req_builder =
        req_builder.header(header::AUTHORIZATION, format!("Bearer {}", token));
    req_builder = req_builder.header(header::USER_AGENT, user_agent);

    // Send to Google
    let response = match req_builder.body(body_bytes.clone()).send().await {
        Ok(r) => r,
        Err(e) => {
            let msg = format!("Upstream error: {}", e);
            tracing::error!("{}", msg);
            state
                .push_log("mitm", &path, &email, "❌ UPSTREAM", &msg)
                .await;
            let resp = hyper::Response::builder()
                .status(502)
                .body(Body::from(msg))
                .unwrap();
            return Ok(resp);
        }
    };

    let status = response.status();
    let resp_headers = response.headers().clone();
    let is_stream = resp_headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|ct| {
            ct.contains("text/event-stream") || ct.contains("application/x-ndjson")
        })
        .unwrap_or(false);

    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        let snippet = error_text[..error_text.len().min(300)].to_string();
        state
            .push_log(
                "mitm",
                &path,
                &email,
                &format!("❌ {}", status.as_u16()),
                &snippet,
            )
            .await;
        tracing::warn!("❌ MITM {} {} → {}", status.as_u16(), path, snippet);

        let mut builder = hyper::Response::builder().status(status.as_u16());
        for (name, value) in resp_headers.iter() {
            builder = builder.header(name, value);
        }
        return Ok(builder.body(Body::from(error_text)).unwrap());
    }

    state
        .push_log(
            "mitm",
            &path,
            &email,
            "✅ OK",
            if is_stream { "Streaming" } else { "Single" },
        )
        .await;

    if is_stream {
        // Stream the response through
        let stream = response.bytes_stream();
        let mut builder = hyper::Response::builder();
        for (name, value) in resp_headers.iter() {
            builder = builder.header(name, value);
        }
        return Ok(builder.body(Body::from_stream(stream)).unwrap());
    }

    // Non-streaming: read and forward
    let resp_bytes = match response.bytes().await {
        Ok(b) => b,
        Err(e) => {
            let resp = hyper::Response::builder()
                .status(502)
                .body(Body::from(format!("Read error: {}", e)))
                .unwrap();
            return Ok(resp);
        }
    };

    let body_snippet =
        String::from_utf8_lossy(&resp_bytes[..resp_bytes.len().min(150)]).to_string();
    tracing::info!(
        "✅ MITM {} → {} bytes | {}",
        path,
        resp_bytes.len(),
        body_snippet
    );

    let mut builder = hyper::Response::builder().status(status.as_u16());
    for (name, value) in resp_headers.iter() {
        builder = builder.header(name, value);
    }
    Ok(builder.body(Body::from(resp_bytes)).unwrap())
}

// ─── HTTP Proxy (non-CONNECT) ───────────────────────────────────────

/// Handle non-CONNECT HTTP requests (direct proxy mode)
async fn handle_http_proxy(
    State(state): State<ProxyState>,
    request: Request,
) -> Result<Response<Body>, (StatusCode, String)> {
    let method = request.method().clone();
    let uri = request.uri().clone();
    let path = uri.to_string();

    tracing::info!("📨 HTTP proxy: {} {}", method, path);

    // For direct HTTP proxy requests, the full URL is in the request line
    let original_headers = request.headers().clone();
    let body_bytes = axum::body::to_bytes(request.into_body(), 10 * 1024 * 1024)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Read body: {}", e)))?;

    let account = {
        let guard = state.active_account.read().await;
        guard.clone()
    };

    let mut req_builder = state.http_client.request(method, &path);

    for (name, value) in original_headers.iter() {
        if name == header::HOST
            || name == header::CONTENT_LENGTH
            || name == header::TRANSFER_ENCODING
        {
            continue;
        }
        // Swap auth if it's a Google domain
        if name == header::AUTHORIZATION {
            if let Some(ref acc) = account {
                let host = uri.host().unwrap_or("");
                if should_mitm(host) {
                    req_builder = req_builder.header(
                        header::AUTHORIZATION,
                        format!("Bearer {}", acc.access_token),
                    );
                    continue;
                }
            }
        }
        if let Ok(val_str) = value.to_str() {
            req_builder = req_builder.header(name.as_str(), val_str);
        }
    }

    let response = req_builder
        .body(body_bytes)
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Upstream: {}", e)))?;

    let status = response.status();
    let resp_headers = response.headers().clone();
    let resp_bytes = response
        .bytes()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("Read: {}", e)))?;

    let mut builder = Response::builder().status(status);
    for (name, value) in resp_headers.iter() {
        builder = builder.header(name, value);
    }
    Ok(builder
        .body(Body::from(resp_bytes))
        .unwrap()
        .into_response())
}


// ─── Language Server Wrapper ────────────────────────────────────────
// The language_server binary (Go) ignores http.proxy in settings.json
// and connects directly to Google. We wrap it with a shell script that
// sets SSL_CERT_FILE and rewrites --cloud_code_endpoint port so gRPC
// connects to our local TLS proxy.

/// Get the language server binary path (platform-specific)
fn language_server_path() -> Result<std::path::PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let path = std::path::PathBuf::from(
            "/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm",
        );
        Ok(path)
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("LOCALAPPDATA")
            .map_err(|_| "LOCALAPPDATA not set".to_string())?;
        let path = std::path::PathBuf::from(appdata)
            .join("Programs")
            .join("Antigravity")
            .join("resources")
            .join("app")
            .join("extensions")
            .join("antigravity")
            .join("bin")
            .join("language_server_windows_amd64.exe");
        Ok(path)
    }
    #[cfg(target_os = "linux")]
    {
        let path = std::path::PathBuf::from("/usr/share/antigravity/resources/app/extensions/antigravity/bin/language_server_linux_amd64");
        Ok(path)
    }
}

/// Create a wrapper script that forces the language server through the proxy
pub fn wrap_language_server(app: &tauri::AppHandle, proxy_url: &str) -> Result<String, String> {
    let server_path = language_server_path()?;
    if !server_path.exists() {
        return Err(format!(
            "Language server not found at: {}",
            server_path.display()
        ));
    }

    // Compute path for the renamed real binary
    #[cfg(not(target_os = "windows"))]
    let real_path = {
        let mut p = server_path.clone().into_os_string();
        p.push(".real");
        std::path::PathBuf::from(p)
    };

    #[cfg(target_os = "windows")]
    let real_path = server_path.with_extension("real.exe");

    // UNLOCK directory first so we don't get permission denied on subsequent writes
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Some(bin_dir) = server_path.parent() {
            if let Ok(meta) = std::fs::metadata(bin_dir) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(bin_dir, perms);
            }
        }
    }

    // Check if the original binary is a real binary (not already a script)
    if !real_path.exists() {
        // Read first bytes to check if already a script or our rust wrapper
        let first_bytes = std::fs::read(&server_path)
            .map_err(|e| format!("Cannot read language server: {}", e))?;
            
        // Check for bash wrapper
        if first_bytes.starts_with(b"#!/") {
            return Err(
                "Language server appears to already be wrapped (starts with #!)".into(),
            );
        }
        
        // Check for rust wrapper signature inside the binary
        let sig = b"ANTIGRAVITY_RUST_WRAPPER_V1";
        if first_bytes.windows(sig.len()).any(|w| w == sig) {
            return Err(
                "Language server appears to already be securely wrapped (Rust signature detected)".into(),
            );
        }

        // Rename the real binary
        std::fs::rename(&server_path, &real_path)
            .map_err(|e| format!("Failed to rename binary: {}", e))?;

        tracing::info!(
            "✓ Renamed {} → {}",
            server_path.display(),
            real_path.display()
        );
    }

    // Write wrapper script
    #[cfg(not(target_os = "windows"))]
    {
        let wrapper = format!(
            r#"#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

ARGS=()
NEXT_IS_ENDPOINT=false
for arg in "$@"; do
  if [ "$NEXT_IS_ENDPOINT" = true ]; then
    URL="{url}"
    ARGS+=("$URL")
    NEXT_IS_ENDPOINT=false
  elif [ "$arg" = "--cloud_code_endpoint" ]; then
    ARGS+=("$arg")
    NEXT_IS_ENDPOINT=true
  else
    ARGS+=("$arg")
  fi
done

exec "$DIR/$(basename "$0").real" "${{ARGS[@]}}"
"#,
            url = proxy_url,
        );


        std::fs::write(&server_path, &wrapper)
            .map_err(|e| format!("Failed to write wrapper: {}", e))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&server_path)
                .map_err(|e| e.to_string())?
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&server_path, perms).map_err(|e| e.to_string())?;

            // Lock the directory to prevent IDE auto-healing from replacing the script
            let bin_dir = server_path.parent().unwrap();
            let mut dir_perms = std::fs::metadata(bin_dir)
                .map_err(|e| e.to_string())?
                .permissions();
            dir_perms.set_mode(0o555); // Read-only directory
            std::fs::set_permissions(bin_dir, dir_perms).map_err(|e| e.to_string())?;
        }
    }

    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        
        // On Windows, the bash script won't work, so we use the compiled sidecar.
        let mut sidecar_path = app
            .path()
            .resource_dir()
            .map(|p| p.join("binaries").join("wrapper-x86_64-pc-windows-msvc.exe"))
            .map_err(|e| format!("Failed to resolve resource dir: {}", e))?;
            
        if !sidecar_path.exists() {
            sidecar_path = app
                .path()
                .resource_dir()
                .unwrap()
                .join("binaries")
                .join("wrapper.exe");
        }
        
        if !sidecar_path.exists() {
             return Err(format!("Could not find wrapper resource identically on disk: {:?}", sidecar_path));
        }
            
        std::fs::copy(&sidecar_path, &server_path)
            .map_err(|e| format!("Failed to copy sidecar wrapper to bin: {}", e))?;
    }

    tracing::info!(
        "✓ Language server wrapped → proxy url {}",
        proxy_url
    );

    Ok(format!(
        "Language server wrapped — restart Antigravity to route gRPC through proxy ({})",
        proxy_url
    ))
}

/// Remove the wrapper and restore the original binary
pub fn unwrap_language_server() -> Result<String, String> {
    let server_path = language_server_path()?;

    #[cfg(not(target_os = "windows"))]
    let real_path = {
        let mut p = server_path.clone().into_os_string();
        p.push(".real");
        std::path::PathBuf::from(p)
    };

    #[cfg(target_os = "windows")]
    let real_path = server_path.with_extension("real.exe");

    #[cfg(unix)]
    {
        // Unlock the directory before attempting to remove or rename files
        use std::os::unix::fs::PermissionsExt;
        if let Some(bin_dir) = server_path.parent() {
            if let Ok(meta) = std::fs::metadata(bin_dir) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(bin_dir, perms);
            }
        }
    }

    if !real_path.exists() {
        return Ok("Language server is not wrapped — nothing to restore".into());
    }

    // Remove the wrapper script
    if server_path.exists() {
        std::fs::remove_file(&server_path)
            .map_err(|e| format!("Failed to remove wrapper: {}", e))?;
    }

    // Restore original binary
    std::fs::rename(&real_path, &server_path)
        .map_err(|e| format!("Failed to restore binary: {}", e))?;

    // Clean up combined certs
    let combined = dirs::home_dir()
        .ok_or("No home dir")?
        .join(".antigravity-lab")
        .join("combined-certs.pem");
    let _ = std::fs::remove_file(&combined);

    tracing::info!("✓ Language server unwrapped — restored original binary");

    Ok("Language server restored — restart Antigravity to use direct connection".into())
}

/// Check if the language server is currently wrapped
pub fn is_language_server_wrapped() -> bool {
    let server_path = match language_server_path() {
        Ok(p) => p,
        Err(_) => return false,
    };

    #[cfg(not(target_os = "windows"))]
    {
        let mut real = server_path.clone().into_os_string();
        real.push(".real");
        std::path::PathBuf::from(real).exists()
    }

    #[cfg(target_os = "windows")]
    {
        server_path.with_extension("real.exe").exists()
    }
}

/// Silent OK for telemetry
pub async fn silent_ok() -> StatusCode {
    StatusCode::OK
}
