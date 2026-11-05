# NekoSune CloudPatron payments — phase 1

This is an **opt-in, separate Node.js 20+ bridge**, built on CloudPatron's existing Go `master` branch without altering legacy billing. It is NOT yet connected to the Go UI, database or billing paymaster.

## Implemented

- `GET /health`: process health (no secret)
- `GET /v1/providers`: catalog and honest readiness indicators
- `POST /v1/invoices`: create a **Heleket-only** hosted redirect invoice via `@heleket-payment/sdk`, with unique server-side order ID; bearer token required
- `GET /v1/invoices/:id`: stored invoice status (currently **pending only**); bearer token required
- `GET /v1/entitlements/:patronId`: **always denies** access until verified payment reconciliation and Discord account linking are implemented; bearer token required
- Data persisted to a local JSON file, permissions restricted where supported.

### Run (behind your reverse proxy / private network)

```bash
cd payment-bridge
npm install
BRIDGE_API_TOKEN="$(openssl rand -hex 32)" # save this into your secret manager; do not print it publicly
export BRIDGE_API_TOKEN
export HELEKET_MERCHANT_ID='your-merchant-id'
export HELEKET_PAYMENT_KEY='your-payment-key'
export BRIDGE_HOST=127.0.0.1
export BRIDGE_PORT=8091
export BRIDGE_DATA_FILE=./data/invoices.json
npm start
```

**Never expose the bridge publicly without TLS, authentication, rate limits and trusted ingress controls.** Token grants invoice creation and metadata reads. CloudPatron's Go user/session authentication is not connected yet. The invoice endpoint must be invoked by an authenticated server-side integration, not directly from browser JavaScript.

### Example request

```bash
curl -X POST http://127.0.0.1:8091/v1/invoices \
  -H "Authorization: Bearer $BRIDGE_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"provider":"heleket","patronId":"pa_example","amount":"15.00","currency":"USD"}'
```

The returned `checkoutUrl` is a real Heleket-hosted page only when merchant credentials and API succeed. Invoice status remains `pending`. Do **not** interpret a browser redirect as proof of payment.

## Reference projects

- CloudPatron: legacy Go app, JSON storage, monthly Stripe charges and `Patron.IsActive()` checks.
- NekoPay: `src/config/gateways.js`, `src/services/hosted-gateways.js`, and `src/services/zbd.js`. Some NekoPay gateways are explicitly *beta/unverified*, so **no unsupported generic adapter is presented as operational here**.
- Heleket SDK: `@heleket-payment/sdk`. Example:
```js
import { HeleketPayment } from '@heleket-payment/sdk';
const client = new HeleketPayment(merchantId, paymentKey);
const invoice = await client.createInvoice({ amount: '15.00', currency: 'USD', order_id: 'order-42' });
console.log(invoice.url);
```

## Planned next phases (NOT implemented)

1. Verified provider callbacks with **raw-body signature validation**, replay/idempotency protections, amount/currency/order matching, provider-status allowlist, and paid/refunded/revoked transitions.
2. Connect payment-ledger records and patron tier entitlements to the Go app. Review the legacy `IsActive` / `listActivePatrons` logic and Stripe paymaster to avoid double-charging or granting unpaid access. Build an authenticated supporter checkout UI.
3. Add real connectors for PayPal, NOWPayments, ZBD, Cryptomus, BitPay, CoinGate, OxaPay, Plisio, OpenNode, Strike, Alby, Speed, Checkout.com and Revolut Pay, with their respective official payment status APIs and webhook verification. Existing Stripe remains untouched.
4. Add chain-specific on-chain verification for HIVE/HBD, STEEM/SBD, BLURT, TELOS, EOS, FIO, WAX, PIVX and FLS with token precision, memo/payment identity, confirmation thresholds, double-spend/reorg handling, and rate conversion.
5. Discord OAuth2 account linking and Bot API role-sync jobs: signed internal entitlements API, guild-specific tier→role mappings, scoped bot token, queue/retry, revocation on lapse/refund, and manual reconciliation. Do not add roles directly from unverified callbacks.

## Safety

This phase is intentionally **not production-ready for granting membership**. No webhooks are exposed and no pending payment can be marked paid. Please do not add Stripe or crypto tokens into Git history or commit `.env` files. Restrict the invoice bridge to a private interface; the public catalog is informational only.

## Payment verification and creator integration (phase 1.1)

Heleket provides signed JSON callbacks. This bridge implements POST `/webhooks/heleket`, verifies the signature against `HELEKET_PAYMENT_KEY`, and validates invoice UUID (if supplied at creation), server-generated order ID, amount, currency and final status before updating the stored payment. See https://doc.heleket.com/methods/payments/webhook and https://doc.heleket.com/host-to-host.

Required env in addition to the above:

```bash
export HELEKET_CALLBACK_URL='https://patron.example.com/webhooks/heleket'
```

Route that HTTPS callback from your reverse proxy to the bridge. **Do not** expose admin or creator API routes without separate authentication, TLS and rate limiting. The callback is authenticated by its cryptographic Heleket signature. Verify deployment with Heleket's test-webhook endpoint before accepting real payments. The SDK's `url_callback` parameter still needs an integration smoke test. Reconcile missed callbacks with Heleket's `/v1/payment/info` in a later phase.

Supported lifecycle: `pending`, `confirming`, `paid`, `declined`, `underpaid`, `cancelled`, `refund_pending`, `refunded`. Statuses are derived from verified Heleket messages; unpaid, underpaid and refunded invoices never provide new access. This is a single-provider MVP, not yet a general payment abstraction.

### Create an invoice for a supporter and tier

The **private administrator** bearer token can create an invoice. `creatorId` and `tierId` must be supplied by the authenticated server-side application, not blindly accepted from an end-user browser.

```bash
curl -X POST http://127.0.0.1:8091/v1/invoices \
  -H "Authorization: Bearer $BRIDGE_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"provider":"heleket","creatorId":"creator1","patronId":"patron1","tierId":"vip","amount":"15.00","currency":"USD"}'
```

### Read-only Patreon-like Creator API

To configure a project integration, generate a unique random project token. Store **only its SHA256 hash** in creator key configuration. For example, run locally with your selected token:

```bash
node -e "console.log(require('node:crypto').createHash('sha256').update(process.env.PROJECT_TOKEN).digest('hex'))"
```

Set `CREATOR_API_KEYS_JSON` to a JSON array such as:

```json
[
  {
    "keyHash": "REPLACE_WITH_64_CHARACTER_SHA256_HASH",
    "creatorId": "creator1",
    "projectId": "minecraft1",
    "scopes": ["entitlements:read"]
  }
]
```

Each game server, Discord integration or website should have its **own project token** (never reuse the payment admin token). The caller sends:

```bash
curl -H "Authorization: Bearer $PROJECT_TOKEN" \
  http://127.0.0.1:8091/v1/creator/patrons/patron1/entitlements
```

Example *shape* (illustrative, not a paid transaction):

```json
{"creatorId":"creator1","patronId":"patron1","active":true,"tiers":["vip"],"expiresAt":"2026-12-01T00:00:00.000Z"}
```

**Important:** tier grants currently expire after a fixed 30 days from a verified payment, as a temporary design placeholder; recurring subscriptions, grace periods, tier upgrades, linked user IDs, creator enrollment, project key management UI, per-project perk mapping, event webhooks and role/game-server delivery are **not implemented**. Bots must use this API server-side and independently map `tiers` to allowed permissions and roles. Project token revocation currently requires editing `CREATOR_API_KEYS_JSON` and restarting the bridge.

`GET /v1/entitlements/:patronId` remains legacy fail-closed; use `/v1/creator/patrons/:patronId/entitlements` with an authenticated scoped creator project key.

### Next Creator API improvements

- `GET /v1/creator/me`, project administration/key rotation, project-specific subscriber IDs and scoped OAuth consent
- `GET /v1/creator/tiers`, `GET /v1/creator/patrons` with pagination and privacy-scoped identity
- Signed entitlement change webhooks, retries/idempotency, audit log and access revocation
- Discord OAuth2 linking and guild role mapping; Minecraft/FiveM game account linking and allow-list/permission reconciliation
- Subscription lifecycle and verified settlement reconciliation with CloudPatron Go records (JSON storage should be replaced with transactional storage before high volume)
