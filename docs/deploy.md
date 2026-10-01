# Deploying a public demo

A public demo is a copy of this app anyone can open and move things in. There is
a blueprint for it, [`render.yaml`](../render.yaml), and this page is what to do
with it.

The service is a copy, not an installation. Ingest is refused, so nobody can
write readings into your room, and there is nowhere for their measurements to go.

> This page describes deploying your **own** copy. Where yours ends up is your
> business, and no live-demo URL appears anywhere in this repository: a link in a
> README that later stops working is worse than no link.

## Deploy from the blueprint

1. **Fork this repository** to your own GitHub account. The blueprint deploys
   from a repository Render can read, so it needs to be somewhere Render can
   clone it.

2. **Sign in** at [dashboard.render.com](https://dashboard.render.com/) and open
   **New → Blueprint**.

3. **Point it at your fork.** Render lists the repositories your account can
   read. Pick the fork, not the upstream.

4. **Check the name and branch.** Render proposes a service name and the branch
   to deploy. Either is fine; they only affect the service's own name.

5. **Apply.** Render builds the Docker image, sets the environment variables from
   the blueprint, and starts the service.

6. **Wait for the health check.** The blueprint points Render at `/healthz`.
   Render considers the service up once that path answers `200`. Until then the
   dashboard says the deploy is still in progress.

7. **Open it.** Render shows the service's URL once it is live.

## What the blueprint sets, and why

| Value          | Why                                                                 |
| -------------- | ------------------------------------------------------------------- |
| `DEMO_MODE=1`  | Every shared-room limit below is inert without it                   |
| `HOST=0.0.0.0` | The container must be reachable from outside itself                 |
| `PORT=3000`    | The port the app listens on                                         |
| `/healthz`     | Answers independently of the simulation loop, so the check is cheap |

`HOST` is the one that bites people. Run locally, this app binds `127.0.0.1`,
which is the right default for a laptop: nothing on your network can reach it.
Inside a container that same default means the app listens on loopback _within
the container_, and nothing can reach it from outside. The blueprint sets
`0.0.0.0` explicitly, and the local default stays as it is.

## What visitors get

With `DEMO_MODE=1`:

- **Ingest is closed.** `POST /api/readings` and `POST /api/import/*` answer
  `403`, and so does a request carrying a valid `READINGS_TOKEN`. The routes are
  disabled, not merely unauthenticated.
- **Commands are rate limited** to `DEMO_RATE_LIMIT` per second, per client, so
  one visitor dragging a slider cannot spend everyone else's budget.
- **At most `DEMO_MAX_CLIENTS` browsers** can be connected. The next one gets a
  `503` with a `Retry-After`, rather than a socket that opens and immediately
  closes.
- **The room resets** to its starting state after `DEMO_IDLE_RESET_MS` with no
  commands. A visitor who drags a transmitter into a corner and walks away does
  not hand the next visitor their corner.
- **A banner** at the top of the page says everyone shares the same room.
- **`GET /healthz`** answers `{"status":"ok", ...}`.

Measured readings are the part a demo cannot have, so the Measured panel and the
CSV import button stay in the UI and the requests come back `403`. On a local
install they work; that difference is the point of `DEMO_MODE`.

## Free tier, and what sleeping means

Render's free web service plan spins down a service after **15 minutes without
inbound traffic**, and spins it back up on the next request or new WebSocket
connection. Spinning back up takes **about a minute**, during which Render shows
a loading page.

So a first-time visitor to a demo that has been idle may wait roughly a minute
for the first screen. It is not a bug and there is nothing in this app to fix -
it is how the free plan works, and Render's own docs say not to use free
instances for production. Moving the service to any paid compute plan removes
the spin-down and the cold start.

Two consequences worth knowing before you point anyone at it:

- **Spun-down services do not consume Free instance hours.** Each workspace gets
  750 per calendar month. Exhaust them and Render suspends every Free service in
  the workspace until the month turns over.
- **The filesystem is ephemeral.** Anything written while running is lost on
  redeploy, restart, or spin-down. This app keeps state in memory — the room and
  the reading buffer — so a spin-down resets it, which is the same end state
  demo mode's idle reset produces. Nothing needs persisting.

Keeping the service awake with an external ping is a known workaround and is not
supported by Render; a real fix is a paid instance.

Render's terms and the details of the free plan are at
[render.com/docs/free](https://render.com/docs/free), and are worth re-reading
before relying on any of it - the limits above are as of writing and can change.

## Running a demo without Render

Any Docker host will do. The requirements are the two environment variables and
the health check:

```sh
docker build -t spectrum-mapper .
docker run -p 3000:3000 -e DEMO_MODE=1 spectrum-mapper
```

The Dockerfile already sets `HOST=0.0.0.0`, so no further host configuration is
needed. Locally, `npm start` with `DEMO_MODE=1` in `.env` gives the same
behaviour without a container.

## Checking a deploy

```sh
curl -fsS https://your-service/healthz          # {"status":"ok","demo":true,...}
curl -i -X POST https://your-service/api/readings \
  -H 'content-type: application/json' \
  -d '{"x":1,"y":1,"rssi":-50}'                # 403, ingest is disabled
```

`/healthz` reports `"demo": true` only when demo mode is actually on. If it says
`false`, the environment variable did not reach the container - check the
service's environment in the Render dashboard rather than the blueprint, since
someone can change it there and the blueprint will not show it.

## Turning it off

Set `DEMO_MODE=0` on the service and redeploy. Ingest comes back, the limits and
the banner go away, and the room becomes an ordinary shared installation with no
protection. If that is not what you want, delete the service instead.
