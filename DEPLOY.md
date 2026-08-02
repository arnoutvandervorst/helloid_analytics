# Deploying a hosted copy

The app is entirely client-side: no back end, no database, no calls out of the page. A
visitor arrives at an empty screen and drops their own exports in, so there is nothing to
authenticate and nothing of anyone's on the host. The image contains `index.html`, `css/`,
`js/`, `assets/` and — if you generated one — `demo/`.

> Real exports never enter the image: `.dockerignore` excludes `*.csv` and `vault*.json`,
> and nginx returns 403 for `.csv`/`.json` outside `/assets/` and `/demo/`, in case a file
> ever lands on the host by mistake.

```
browser → HTTPS reverse proxy / tunnel → http://127.0.0.1:$PORT → nginx → static app
```

## Any static host

There is no build step. Copy `index.html`, `css/`, `js/`, `assets/` (and `demo/`) to any
web server. `python3 build.py` also writes a single-file bundle to `dist/` if you would
rather hand someone one HTML file.

## With Docker

```sh
docker compose up -d --build
curl -s http://127.0.0.1:$PORT/healthz    # ok
```

`docker-compose.yml` binds to loopback only, so the container is reachable through
whatever proxy or tunnel you put in front of it and not from the network directly. Set the
port there.

The healthcheck uses `127.0.0.1` rather than `localhost`: inside the container `localhost`
resolves to `::1` first, and nginx listens on IPv4, which reports a healthy service as
unhealthy.

## Behind a Cloudflare tunnel

Add an ingress entry for the hostname pointing at `http://localhost:$PORT`, create the DNS
route, and reload cloudflared:

```sh
cloudflared tunnel route dns $TUNNEL $HOSTNAME
```

cloudflared does not always pick up an edited config on SIGHUP; restarting the process
does. If the tunnel serves other hostnames, they drop for the few seconds it takes to
re-register its connections.

## Logs

`nginx.conf` defines deliberately narrow log formats: timestamp, status, method and path,
with no client address and no user agent. The usage beacon at `/u` logs its query string
only. `usage-report.py` summarises those files.

## Ops

```sh
docker compose logs -f app
docker compose restart app
```

No volumes and nothing to back up: every piece of state — snapshots, settings, branding —
lives in the visitor's browser, not on the server.
