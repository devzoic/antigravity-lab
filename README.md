<div align="center">

<img src="https://fivpilot.com/images/logo.svg" alt="Antigravity Lab" width="200" />

# Antigravity Lab

**Google Antigravity Accounts Management — Desktop Client**

🌐 [**Get Premium Accounts → fivpilot.com**](https://fivpilot.com)

[![Release](https://img.shields.io/github/v/release/devzoic/antigravity-lab?style=flat-square&color=blue)](https://github.com/devzoic/antigravity-lab/releases)
[![License](https://img.shields.io/github/license/devzoic/antigravity-lab?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-brightgreen?style=flat-square)]()

</div>

---

## ✨ What is Antigravity Lab?

<p align="center">
  <img src="https://fivpilot.com/images/antigravity-logo.png" alt="Antigravity" width="120" />
</p>

Antigravity Lab is a professional desktop client for managing and switching between **Google Antigravity** accounts. It provides secure token injection, seamless one-click account switching, and always-on background access via the system tray.

---

## 📸 Screenshots

<p align="center">
  <img src="https://fivpilot.com/images/screenshot-web.png" alt="Web Dashboard" width="700" />
</p>
<p align="center"><em>Web Dashboard — Manage your accounts & subscriptions</em></p>

<br />

<p align="center">
  <img src="https://fivpilot.com/images/screenshot-client.png" alt="Desktop Client" width="700" />
</p>
<p align="center"><em>Desktop Client — One-click account switching & token injection</em></p>

---

## 🚀 Features

- 🔀 **One-Click Account Switching** — Seamlessly switch between Antigravity accounts
- 🔐 **Secure Token Injection** — Compiled backend, no source code exposure
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
