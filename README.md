<div align="center">

# ⚡ AI Account Manager

**Professional desktop client for seamless AI account management & switching**

Built with **Tauri v2** + **React** (Rust backend)

[![Release](https://img.shields.io/github/v/release/devzoic/antigravity-lab?style=flat-square&color=blue)](https://github.com/devzoic/antigravity-lab/releases)
[![License](https://img.shields.io/github/license/devzoic/antigravity-lab?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-brightgreen?style=flat-square)]()

</div>

---

## ✨ Features

- 🔀 **One-Click Account Switching** — Seamlessly switch between AI accounts
- 🔐 **Secure Token Injection** — Compiled Rust backend, no source code exposure
- 📌 **System Tray** — Runs in background, always accessible from menu bar/taskbar
- 🔄 **Auto-Update** — Automatically checks for updates on launch
- 🚀 **Auto-Start** — Launches on system boot
- 🖥️ **Cross-Platform** — macOS (Intel + Apple Silicon), Windows, Linux

---

## 📦 Installation

### macOS / Linux — One Command

```bash
curl -fsSL https://raw.githubusercontent.com/devzoic/antigravity-lab/main/install.sh | bash
```

> **Note:** On macOS, the installer automatically removes quarantine flags (`xattr -cr`), so you won't see "unidentified developer" warnings.

#### Advanced Options

```bash
# Install a specific version
curl -fsSL https://raw.githubusercontent.com/devzoic/antigravity-lab/main/install.sh | bash -s -- --version 1.0.0

# Preview what would happen (no changes made)
curl -fsSL https://raw.githubusercontent.com/devzoic/antigravity-lab/main/install.sh | bash -s -- --dry-run
```

### Windows — PowerShell

```powershell
irm https://raw.githubusercontent.com/devzoic/antigravity-lab/main/install.ps1 | iex
```

### Manual Download

Go to [**Releases**](https://github.com/devzoic/antigravity-lab/releases) and download:

| Platform              | File                    |
| --------------------- | ----------------------- |
| macOS (Apple Silicon) | `.dmg` (aarch64)        |
| macOS (Intel)         | `.dmg` (x64)            |
| Windows               | `.exe` (NSIS installer) |
| Linux (Debian/Ubuntu) | `.deb`                  |
| Linux (Other)         | `.AppImage`             |

---

## 🔄 Updates

The app **auto-updates on launch** — no manual action needed.

If auto-update fails, run the manual update:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/devzoic/antigravity-lab/main/update.sh | bash
```

```powershell
# Windows
irm https://raw.githubusercontent.com/devzoic/antigravity-lab/main/install.ps1 | iex
```

---

## 🔽 System Tray Behavior

| Action                      | Result                                   |
| --------------------------- | ---------------------------------------- |
| **Close window** (X button) | App hides to system tray — keeps running |
| **Click tray icon**         | Window reappears                         |
| **Right-click tray icon**   | Show / Hide / Quit menu                  |
| **System boot**             | App starts automatically in background   |

---

## 🏗️ Architecture

```
┌─────────────────────────────────┐
│         React Frontend          │  ← UI layer (bundled, not exposed)
├─────────────────────────────────┤
│       Tauri v2 Bridge           │  ← IPC between frontend & backend
├─────────────────────────────────┤
│        Rust Backend             │  ← Compiled binary, secure
│  • Token injection              │
│  • Hardware fingerprint (HWID)  │
│  • Process management           │
│  • System tray                  │
│  • Auto-updater                 │
└─────────────────────────────────┘
```

---

## 🔒 Security

- **Compiled Rust binary** — source code is not readable by end users
- **No secrets in client** — API keys live server-side only
- **Hardware fingerprint** — device-based session tracking
- **Signed updates** — updates verified via public key signature

---

## 🛠️ Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (latest stable)
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/)

### Setup

```bash
# Install dependencies
npm install

# Run in development mode
npx tauri dev

# Build for production
npx tauri build
```

---

## 📝 License

MIT © [devzoic](https://github.com/devzoic)
