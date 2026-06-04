# Vibe Interface (VI)

VI is a multi-agent coding operations dashboard. It gives you one place to launch AI coding sessions (Claude Code, Codex CLI), watch live terminals, handle approval requests, and manage many machines — from any browser.

- **Dashboard** — Next.js web UI. Shows machines, sessions, approvals.
- **vi-agent** — Python daemon. Runs on any machine. Launches agents, streams terminal, polls for jobs.
- **Relay** — Optional cloud control plane. Lets dashboard and agents connect across networks without a shared LAN.

---

## Architecture

### Local mode (same machine or LAN)

```
browser
  └─ dashboard :3000  ─── store.json  (source of truth)
                      ─── DirectTerminal WS :14801
                               └─ tmux ← vi-agent (same LAN)
```

vi-agent and dashboard must be reachable from each other. No external service needed.

### Cloud mode (across networks)

```
browser
  └─ dashboard :3000  ──→  VI Relay (Fly.io)  ←──  vi-agent (any machine)
                               └─ SQLite
                               └─ /vi-agent-relay WS  (terminal stream)
```

vi-agent connects outbound to the relay. The dashboard also connects outbound. Neither side needs a public IP or open inbound port.

---

## Requirements

| Tool | Version |
|------|---------|
| Node.js | ≥ 20 |
| npm | ≥ 10 |
| Python | ≥ 3.11 |
| tmux | any |

---

## Quickstart: Local Mode

### 1. Clone and install

```bash
git clone https://github.com/JozzyAI/Vibe_Interface.git
cd Vibe_Interface
```

Install dashboard dependencies:

```bash
cd packages/web
npm install
```

### 2. Configure

```bash
# packages/web/.env.local  (create this file — it is gitignored)
VI_PUBLIC_URL=http://192.168.1.83:3000   # your machine's LAN IP
```

### 3. Start the dashboard

```bash
cd packages/web
npm run dev
```

This starts two processes concurrently:
- Next.js dashboard on port `3000`
- DirectTerminal WebSocket server on port `14801`

Open `http://localhost:3000` (or your LAN IP if accessing from another device).

### 4. Install vi-agent

On the machine that will run AI sessions (can be the same machine):

```bash
pip install -e bridges/vi-agent
vi-agent --help   # verify install
```

### 5. Enroll a machine

In the dashboard, go to **Machines → Add machine**. Copy the generated pair command:

```
vi-agent pair --server http://192.168.1.83:3000 --code XXXX1234ABCD --start
```

Run it on the target machine. The `--start` flag starts the background daemon immediately after pairing.

### 6. Verify

- The machine should appear as **online** in the Machines page within a few seconds.
- Create a session: **+ New Session → Claude** (requires `claude` CLI installed on the agent machine).
- Open the session detail — the browser terminal should connect and show the Claude REPL.
- In the terminal, type `echo hello` — you should see `hello` in the output.

---

## Quickstart: Cloud Mode

Use this when vi-agent machines cannot reach the dashboard directly (different networks, no fixed IP).

### 1. Deploy the relay

See [packages/relay/README.md](packages/relay/README.md) for full deploy steps.

Short version (Fly.io):

```bash
cd packages/relay

# Create persistent volume FIRST (required — without it the SQLite DB is wiped on every deploy)
fly volumes create vi_relay_data --size 1 --region sin --app <your-app-name>

# Deploy
fly deploy --ha=false --app <your-app-name>

# Generate tokens (run each command once, keep the output secret)
openssl rand -hex 32   # → DAEMON_TOKEN
openssl rand -hex 32   # → VI_TOKEN

# Set secrets
fly secrets set \
  VI_RELAY_TOKENS="<DAEMON_TOKEN>:daemon:local-daemon,<VI_TOKEN>:vi:local-vi" \
  VI_RELAY_OWNER_TOKEN="<VI_TOKEN>" \
  VI_RELAY_PUBLIC_WS_URL="wss://your-app.fly.dev" \
  --app <your-app-name>
```

### 2. Configure the dashboard

```bash
# packages/web/.env.local  — DO NOT COMMIT THIS FILE
VI_RELAY_BASE_URL=https://your-app.fly.dev
VI_RELAY_VI_TOKEN=<VI_TOKEN>
VI_RELAY_DAEMON_TOKEN=<DAEMON_TOKEN>
VI_RELAY_PUBLIC_WS_URL=wss://your-app.fly.dev
```

Restart the dashboard. The mode indicator in the sidebar should show **Cloud · your-app.fly.dev · connected**.

### 3. Pair a machine

From the dashboard, **Machines → Add machine**. The generated pair command will automatically use the relay URL:

```
vi-agent pair --server https://your-app.fly.dev --code XXXX1234ABCD --start
```

Run it on any machine — it does not need to be on the same network as the dashboard.

### 4. Verify

- Machine appears online in dashboard.
- Create a Claude session — it dispatches via relay.
- Browser terminal connects and echoes output through the full relay chain.

---

## vi-agent

### Install

```bash
# From the VI repo (editable install — picks up local changes)
pip install -e bridges/vi-agent

# Verify
vi-agent --help
```

### Core commands

```bash
# Pair with a dashboard or relay (saves state file, optionally starts daemon)
vi-agent pair --server http://192.168.1.83:3000 --code XXXX --start
vi-agent pair --server https://relay.fly.dev --code XXXX --start

# Start daemon from saved state
vi-agent start-daemon --state-file ~/.config/vi-agent/my-project-agent-my-machine.json

# Check running status
vi-agent status

# Stop daemon
vi-agent stop-daemon --state-file ~/.config/vi-agent/my-project-agent-my-machine.json

# Clean up state files for a removed agent
vi-agent cleanup --state-file ~/.config/vi-agent/my-project-agent-my-machine.json
```

### State and log files

Pairing creates files under `~/.config/vi-agent/`:

```
~/.config/vi-agent/
  <project>-agent-<name>.json    # state: agentId, relay URL, token
  <project>-agent-<name>.pid     # daemon PID
  <project>-agent-<name>.log     # daemon log
  jobs/
    <jobId>.log                  # per-job log
```

### vi-agent environment variables

| Variable | Description |
|----------|-------------|
| `VI_AGENT_TOOL` | Default tool type if not set via `--tool` (`claude`, `codex`, `other`) |
| `VI_TERMINAL_RELAY_URL` | Override terminal relay WebSocket URL (normally set automatically from pairing) |
| `ANTHROPIC_AVI_KEY` | Required by Claude Code for non-interactive use |

---

## Dashboard

### Install

```bash
cd packages/web
npm install
```

### Start (dev)

```bash
npm run dev
```

Ports used:

| Port | Service |
|------|---------|
| `3000` | Next.js dashboard (UI + API routes) |
| `14801` | DirectTerminal WebSocket (local terminal relay) |

### WSL2 / LAN access

If the dashboard runs inside WSL2 and you want to access it from Windows, iPad, or other LAN devices:

1. Find the WSL2 IP:
   ```bash
   ip addr show eth0 | grep "inet " | awk '{print $2}' | cut -d/ -f1
   ```

2. Set up a Windows port proxy (run in PowerShell as admin):
   ```powershell
   netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0.0.0.0 connectport=3000 connectaddress=<WSL2-IP>
   netsh interface portproxy add v4tov4 listenport=14801 listenaddress=0.0.0.0 connectport=14801 connectaddress=<WSL2-IP>
   ```

3. Access via the Windows machine's LAN IP: `http://192.168.x.x:3000`

Set `VI_PUBLIC_URL=http://192.168.x.x:3000` in `.env.local` so pair commands show the correct address.

### Dashboard environment variables

| Variable | Mode | Description |
|----------|------|-------------|
| `VI_PUBLIC_URL` | Local | LAN URL used in pair commands, e.g. `http://192.168.1.83:3000` |
| `VI_ACCESS_TOKEN` | Both | If set, all dashboard pages require this token |
| `VI_RELAY_BASE_URL` | Cloud | Relay HTTP URL. Activates cloud mode when set with `VI_RELAY_VI_TOKEN` |
| `VI_RELAY_VI_TOKEN` | Cloud | Bearer token for dashboard → relay `/v1/vi/*` calls |
| `VI_RELAY_DAEMON_TOKEN` | Cloud | Daemon token embedded in generated pair commands |
| `VI_RELAY_PUBLIC_WS_URL` | Cloud | Public WS URL baked into enrollment pair commands |
| `VI_CLAUDE_DEFAULT_MODEL` | Both | Default model for new Claude sessions, e.g. `claude-sonnet-4-6` |
| `DIRECT_TERMINAL_PORT` | Both | Override terminal WS port (default `14801`) |

---

## Relay

See [packages/relay/README.md](packages/relay/README.md) and [docs/cloud-control-plane.md](docs/cloud-control-plane.md).

### Relay environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VI_RELAY_TOKENS` | Yes | `token:kind:label,...` — auth tokens. `kind` is `daemon` or `vi` |
| `VI_RELAY_OWNER_TOKEN` | Yes | Bootstrap token for default owner row (set to same value as VI_TOKEN) |
| `VI_RELAY_PUBLIC_WS_URL` | Yes | Public WebSocket URL baked into enrollment pair commands |
| `VI_RELAY_DB_PATH` | Optional | SQLite path (default `./vi-relay.db`; use `/data/vi-relay.db` on Fly) |
| `VI_RELAY_PORT` | Optional | HTTP listen port (default `8787`) |
| `VI_RELAY_HOST` | Optional | Bind host (default `0.0.0.0`) |

---

## Common Workflows

### Add a machine
1. Dashboard → Machines → Add machine
2. Copy the pair command
3. Run on target machine: `vi-agent pair --server <url> --code <code> --start`

### Reconnect a machine
1. Dashboard → Machines → select machine → Reconnect
2. Copy new pair command, run on target machine

### Restart the vi-agent daemon
```bash
vi-agent stop-daemon --state-file ~/.config/vi-agent/<state>.json
vi-agent start-daemon --state-file ~/.config/vi-agent/<state>.json --tool claude
```

### Start a Claude session
Dashboard → Machines → select machine → New Session → Claude → Start

### Start a Codex session
Dashboard → Machines → select machine → New Session → Codex → Start

### Archive or delete a session
Session detail → kebab menu (⋯) → Archive / Delete

### Rotate relay tokens
See [Token rotation](docs/cloud-control-plane.md#token-rotation) in cloud-control-plane.md.
After rotation, re-pair all vi-agents — their stored daemon token is now invalid.

### Switch local ↔ cloud mode
- **Activate cloud mode:** set `VI_RELAY_BASE_URL` + `VI_RELAY_VI_TOKEN` in `.env.local`, restart dashboard
- **Return to local mode:** remove or comment out those two vars, restart dashboard

---

## Troubleshooting

**Dashboard shows 0 machines but API has agents**  
Check `VI_RELAY_BASE_URL` and `VI_RELAY_VI_TOKEN` in `.env.local`. The sidebar shows **Cloud · connected** when cloud mode is active. If it shows **auth failed**, the VI token is wrong or the relay hasn't restarted yet after a secrets change.

**Pair command points to wrong URL**  
Local mode: set `VI_PUBLIC_URL=http://<your-lan-ip>:3000` in `.env.local`.  
Cloud mode: confirm `VI_RELAY_PUBLIC_WS_URL` is set in Fly secrets (`fly secrets list --app <app>`).

**vi-agent says "Unknown enrollment code"**  
Enrollment codes expire (default 60 minutes) and are single-use. Generate a new one in the dashboard.

**Terminal stuck on "Connecting…"**  
- Local mode: confirm port 14801 is accessible and the DirectTerminal WS server is running.
- Cloud mode: confirm vi-agent logged `terminal_relay_connected`. Check relay logs: `fly logs --app <app>`.
- WSL2: confirm the port proxy covers port 14801.

**Browser terminal has no output**  
Check the tmux session exists: `tmux list-sessions`. If the job exited, check `~/.config/vi-agent/jobs/<jobId>.log`.

**Text selection / copy does not work in terminal**  
Do not enable `tmux set-option mouse on` for VI sessions. With mouse on, drag events route to the PTY and selection disappears on mouseup. VI sets `mouse off` by default — do not override it.

**Claude model "deployment not found"**  
Set `VI_CLAUDE_DEFAULT_MODEL=claude-sonnet-4-6` in `.env.local`. Do not use shell aliases — vi-agent launches Claude via subprocess and aliases are never expanded.

**WSL2 dashboard not accessible from iPad or other LAN devices**  
1. Confirm `npm run dev` starts Next.js with `-H 0.0.0.0`.
2. Set up the Windows port proxy for ports 3000 and 14801.
3. Check Windows Firewall allows inbound on those ports.

**Fly `/presence` returns 401 after token rotation**  
Update `VI_RELAY_VI_TOKEN` in `.env.local` and restart the dashboard. Also re-pair all vi-agents.

**SQLite DB lost after Fly deploy**  
Create a persistent volume before the first deploy — the Fly filesystem is ephemeral:
```bash
fly volumes create vi_relay_data --size 1 --region sin --app <app>
```
Confirm: `fly volumes list --app <app>`.

---

## Security Notes

- **Phase 1 uses token auth, not user accounts.** `VI_ACCESS_TOKEN` is a single shared secret. Fine for personal use; not suitable for multi-user deployments.
- **No E2EE yet.** The relay can see plaintext terminal frames and session payloads. E2EE is planned for Phase 4.
- **Treat tokens as secrets.** Never commit `.env.local`. Never paste tokens in chat, logs, or code review. If a token is exposed, rotate immediately — see [Token rotation](docs/cloud-control-plane.md#token-rotation).
- **Enrollment codes are one-time and expire.** After a code is consumed or expires, it cannot be reused.

---

## Status and Roadmap

### Phase 1 — complete (2026-05-18)
- Public Fly relay deployed and E2E verified
- Token rotation verified (old token rejected, new token accepted)
- Browser terminal through relay works
- Dashboard mode indicator shows Local/Cloud status

### Phase 2 — Cloud Mode Stabilization (current)
- Dashboard mode indicator ✓
- Machine lifecycle hardening (reconnect, remove, restart daemon)
- Session lifecycle dropdown (resume, archive, delete)

### Phase 3 — Accounts (planned)
- Replace single `VI_ACCESS_TOKEN` with invite-based or OAuth login

### Phase 4 — E2EE (planned)
- End-to-end encrypted terminal frames and session payloads
- Relay sees routing metadata only

---

## Repo structure

```
Vibe_Interface/
├── bridges/
│   └── vi-agent/          Python daemon — runs on agent machines
├── docs/
│   ├── HANDOFF.md          Full developer handoff + architecture details
│   └── cloud-control-plane.md  Cloud relay setup and token rotation runbook
├── packages/
│   ├── core/               Shared TypeScript types
│   ├── relay/              VI Cloud relay (SQLite control plane + WebSocket)
│   └── web/                Next.js dashboard
├── AGENT_LAUNCH.md         How agent sessions are launched
├── ROADMAP.md              Product roadmap
└── package.json
```

For deeper technical details see [docs/HANDOFF.md](docs/HANDOFF.md).
