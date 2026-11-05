# NekoSune CloudPatron — one Docker image

This is the Docker setup for the **feature branch**. It compiles the modified Go CloudPatron site and runs the Node payment/creator bridge in a **single container**. The Go server listens on port `8080`; the Node bridge binds **127.0.0.1:8091 inside the container**. A persistent Docker volume stores both Go data and bridge payments/assets.

## Build from GitHub

```bash
git clone https://github.com/NekoSuneProjectsForks/cloudpatron.git
cd cloudpatron
git switch feature/nekosune-payments-discord-api
cp .env.example .env
```

Edit `.env` and replace the host and secret placeholders. Generate **different** secrets for each variable:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Set `BRIDGE_API_TOKEN` and `DOWNLOAD_SIGNING_SECRET` to those values; keep `.env` private. Set `CLOUDPATRON_HTTP_HOST` to your creator site's real hostname. Add Heleket credentials when you are ready to test payments.

```bash
docker compose build
docker compose up -d
docker compose logs -f cloudpatron
```

A built development image is tagged `ghcr.io/nekosuneprojectsforks/cloudpatron:dev` by Compose. GitHub Actions also **publishes the :dev tag on successful feature-branch pushes**; the `:latest` tag is reserved for merged `master`. If the package is private, use `docker login ghcr.io` with your own GitHub access before pulling. To pull instead of building locally, use:

```bash
docker compose pull
docker compose up -d --no-build
```

You can also build directly:

```bash
docker build -f Dockerfile.nekosune -t nekosune-cloudpatron:dev .
```

### Reverse proxy / HTTPS

Proxy **HTTPS** traffic for `patron.example.com` to the container's HTTP port `8080` (or use your Cloudflare Tunnel). Preserve the original `Host` header. Do not publicly expose port `8091`, bypass the Go session gateway or put a provider secret into frontend JavaScript. Legacy CloudPatron uses `Secure` login cookies; logins/gift redemption require HTTPS in production.

Do not use the original upstream `Dockerfile`, which copies an old prebuilt binary without these integration routes. This fork's integration uses **Dockerfile.nekosune**.

### Pages

- `/admin` — legacy CloudPatron administrator pages
- `/creator-studio` — new dashboard (requires signed-in legacy admin session)
- `/shop?creatorId=nekosune` — public digital storefront
- `/redeem/CODE` — public gift preview; patrons must sign in to claim
- `/patron-session` — current session/CSRF metadata (never includes bearer secrets)
- `/v1/public/shop?creatorId=nekosune` — creator catalog JSON
- `/v1/public/vrchat/tiers?creatorId=nekosune` — opt-in VRChat supporter tiers

Create a gift from Creator Studio. It returns a `/redeem/CODE` link. A user who is signed into CloudPatron can redeem it with their own verified Go session. The Go app sends the claim to the private Node bridge; the supporter never sees `BRIDGE_API_TOKEN`. Claims are limited by code expiry, tier grant duration, maximum redemptions and one redemption per user.

### Checkout

A signed-in patron can select a published shop product. The Go server uses the current account ID and a session-bound CSRF token to request a Heleket checkout from the private bridge. The bridge uses the **server-controlled price** and only grants access after a verified payment callback. The public callback is routed by Go to the Node bridge at `/webhooks/heleket`. `HELEKET_CALLBACK_URL` should use your public HTTPS domain.

### Important limitations

- This is an **early integration**. Existing Go Stripe recurring billing and old membership/post tables are not migrated into the new Node ledger; legacy posts and legacy billing remain separate.
- Real one-time purchases and gift claims still require end-to-end staging tests with real user sessions and payment-provider callbacks.
- A gift grants access to the **new Creator API entitlement system**; it does **not** automatically modify the old Stripe customer record or unlock unrelated legacy Go post restrictions.
- New shop checkout currently supports Heleket only. Creator API, discount limits and payment reconciliation need transactional storage, advanced security and rate limits before production.
- The bridge stores private uploaded assets in the same `/data` volume. Back up that volume, do not run multiple simultaneous replicas against the JSON database, and limit who can administer the app.
- Docker CI builds amd64 and smoke-tests both Go and Node. Arm64 can be added after native cross-platform smoke tests; the old Go executable has been replaced with a fresh source build.

## Verify

```bash
docker compose ps
curl -i http://127.0.0.1:8080/patron-session
curl -i 'http://127.0.0.1:8080/v1/public/shop?creatorId=nekosune'
```

For secure sign-in and purchases, use your public HTTPS domain rather than the plain HTTP address.
