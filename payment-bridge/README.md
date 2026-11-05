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
