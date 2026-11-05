# NekoSune CloudPatron — Payment Bridge + Creator Studio (development)

A **standalone Node.js 20+ bridge** for the legacy Go CloudPatron fork. The Go website, Stripe billing and session system are **not yet integrated** with these new APIs. This is a draft feature branch, not a production-ready replacement.

## Features implemented in the bridge

- Heleket invoice creation using `@heleket-payment/sdk`, plus signed webhooks, order/amount/currency matching, and paid/refunded/declined/cancelled statuses. Live Heleket merchant testing is outstanding.
- Creator API read-only, scope-limited project tokens: `entitlements:read`, and `posts:read`.
- Shop catalog with one-time and monthly access modes, private digital file uploads (25MB max), signed five-minute download links, protected file delivery and public YouTube previews.
- Free, paid-tier-only, one-time-purchase and combined-access posts.
- Hash-stored gift membership codes with redemption limits and expiry; private administrator redemption only for now.
- Percentage discount codes for product checkout, scoped creator/project and expiry constraints.
- Audience metrics and supporter entitlement listing; consented VRChat username + paid-tier JSON listing.
- Responsive dark-theme standalone shop (`/shop?creatorId=nekosune`) and creator dashboard (`/creator-studio`).

**See [CREATOR_STUDIO.md](CREATOR_STUDIO.md) for API endpoints, examples, implementation status, security caveats and the full roadmap.**

## Local development

```bash
cd payment-bridge
npm install
export BRIDGE_API_TOKEN="$(openssl rand -hex 32)"
export DOWNLOAD_SIGNING_SECRET="$(openssl rand -hex 32)"
export HELEKET_MERCHANT_ID='your-merchant-id'
export HELEKET_PAYMENT_KEY='your-payment-api-key'
export HELEKET_CALLBACK_URL='https://your-domain.example/webhooks/heleket'
export BRIDGE_HOST='127.0.0.1'
export BRIDGE_PORT='8091'
export BRIDGE_DATA_FILE='./data/invoices.json'
npm test
npm start
```

The standalone shop is at `http://127.0.0.1:8091/shop?creatorId=nekosune` and developer Creator Studio is at `http://127.0.0.1:8091/creator-studio`.

- The creator dashboard takes a private administrator token. **Only run it locally or behind trusted private access controls.**
- Public shop checkout buttons are disabled until the Go account/login/checkout integration is built. The private `POST /v1/invoices` API can start Heleket payments for authenticated server-side callers.
- **Never treat a redirect or client screenshot as payment verification.** Only signed and reconciled settled payments unlock content.
- One-time purchases are durable (until refunded/revoked). Monthly access currently lasts a fixed 30 days **per paid invoice**, without automatic rebilling; not a complete subscription implementation.
- Creator gift code generation and administrator-assisted redemption work at API level; public `/redeem/:code` and user self-service are not implemented.
- The public VRChat list includes only opted-in linked usernames and active paid tiers; VRChat account ownership verification is not connected yet.
- No automatic Discord role syncing, game-server whitelist syncing, patron OAuth login, dashboard role scopes, transactional ledger, auto renewals, storage backend migration, or payout functionality yet.
- The platform uses **JSON file storage** for this prototype; do not deploy as a multi-process payment service or production creator platform before transaction-safe storage, backup, idempotency and concurrency protections are added.

## Payment provider status

Heleket: beta checkout + webhook integration. Legacy Stripe: existing Go implementation unchanged. PayPal, NOWPayments, ZBD, Cryptomus, BitPay, CoinGate, OxaPay, Plisio, OpenNode, Strike, Alby, Speed, Checkout.com, Revolut Pay, HIVE/HBD, STEEM/SBD, BLURT, TELOS, EOS, FIO, WAX, PIVX and FLS: **catalog / planned**, not yet implemented as working bridge checkouts.

### Example: private verified catalog checkout

```bash
curl -X POST http://127.0.0.1:8091/v1/invoices \
  -H "Authorization: Bearer $BRIDGE_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"provider":"heleket","creatorId":"nekosune","patronId":"patron1","tierId":"shop","productId":"hardstyle-fx","amount":"999.99","currency":"USD"}'
```

For a `productId` checkout, the bridge **overrides** submitted amount/currency with the configured catalog values. Caller must be your authenticated server-side application, not an untrusted browser.

## Run unit tests

```bash
cd payment-bridge
node --test
```
