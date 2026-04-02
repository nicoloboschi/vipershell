# vipershell

Your machine, anywhere. Access and manage your tmux terminal sessions from any browser or phone.

![vipershell screenshot](screenshot.png)

## Quick Start

### 1. Install tmux

**macOS:**
```bash
brew install tmux
```

**Ubuntu/Debian:**
```bash
sudo apt install tmux
```

**Arch:**
```bash
sudo pacman -S tmux
```

### 2. Run vipershell

```bash
npx vipershell
```

Open [http://localhost:4445](http://localhost:4445) in your browser.

That's it. vipershell discovers your existing tmux sessions and lets you create new ones from the browser.

### Options

```
npx vipershell --port 8080        # custom port
npx vipershell --host 0.0.0.0     # listen on all interfaces (for remote access)
npx vipershell --log-level debug  # verbose logging
```

### Install globally

```bash
npm install -g vipershell
vipershell
```

## Features

- **Terminal in the browser** -- full xterm.js terminal with mouse, scroll, and color support
- **Split panes** -- horizontal, vertical, and 2x2 grid layouts
- **Session management** -- create, rename, close sessions from the sidebar
- **Git integration** -- branch status, PR links, diff viewer, worktree management
- **File browser** -- navigate, edit, and preview files with syntax highlighting
- **Search** -- grep across your project from the browser
- **AI session naming** -- sessions get auto-named based on terminal activity (requires `claude` or `codex` CLI)
- **Hindsight memory** -- optional long-term memory via [Hindsight](https://github.com/vectorize-io/hindsight) so coding agents recall context across sessions
- **Mobile-friendly** -- responsive UI with touch scrolling and mobile keyboard shortcuts
- **Drag & drop** -- drop files onto the terminal to upload and paste the path
- **Unseen output indicator** -- blue highlight on sessions with new output you haven't seen

## Requirements

- **Node.js** 18+
- **tmux** installed and in PATH

## License

MIT
