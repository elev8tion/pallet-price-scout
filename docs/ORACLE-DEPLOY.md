# Oracle deployment

Pallet Price Scout follows the shared osoance/Oracle topology used by insurGate:

```text
browser → Caddy :80/:443 → 127.0.0.1:<assigned port> → npm start
                                      ↓
                         shared Pi + /var/lib/pi/agent
```

The Node app owns its SQLite database, uploads, lock, and run artifacts under `data/`. It never binds a public interface.

## Preconditions

On this Mac:

```bash
ssh osoance 'sudo systemctl is-active pi-app@pallet-price-scout || true'
```

The host must have the shared Pi install and agent directory used by the other apps:

- Pi package: `/usr/local/lib/node_modules/@earendil-works/pi-coding-agent`
- Agent directory: `/var/lib/pi/agent`
- Node/npm available to `systemd`
- Caddy already serving the host

## Deploy or refresh

The host ops kit chooses the next free port, syncs the project, installs dependencies, creates the environment file, starts systemd, and adds a Caddy hostname:

```bash
/Users/kcdacre8tor/osoance-host/add-app.sh \
  pallet-price-scout \
  /Users/kcdacre8tor/pallet-price-scout
```

The generated environment is equivalent to:

```dotenv
SCOUT_OPEN=1
SCOUT_HOSTS=132.226.53.158,pallet-price-scout.132.226.53.158.nip.io
PI_AGENT_DIR=/var/lib/pi/agent
PI_CODING_AGENT_PACKAGE=/usr/local/lib/node_modules/@earendil-works/pi-coding-agent
```

Do not copy `auth.json`, provider keys, `data/`, or `node_modules` from the Mac. The deployment script excludes them and uses the shared server-side Pi credentials.

## Verify

```bash
ssh osoance 'sudo systemctl is-active pi-app@pallet-price-scout'
ssh osoance 'sudo systemctl status --no-pager pi-app@pallet-price-scout'
ssh osoance 'curl -fsS http://127.0.0.1:<assigned-port>/api/health'
curl -fsS http://pallet-price-scout.132.226.53.158.nip.io/api/health
```

Open:

```text
http://pallet-price-scout.132.226.53.158.nip.io/
```

`SCOUT_OPEN=1` makes the shared demo accessible through the Caddy hostname while the application itself remains loopback-only. All scan history and uploaded assets are shared by users of that deployment; stop the unit when the demo is over if that is not desired.

## Contract checks

Before deployment:

```bash
npm install
npm run typecheck
npm test
```

The required production contract is:

1. `npm start` serves HTTP.
2. Fastify listens on `127.0.0.1` only.
3. `PORT` controls the listener.
4. Each app uses its own `data/` directory.
5. Pi paths come from `PI_AGENT_DIR` and `PI_CODING_AGENT_PACKAGE`.
6. `SCOUT_HOSTS` and `SCOUT_OPEN=1` are supplied by the host environment.
