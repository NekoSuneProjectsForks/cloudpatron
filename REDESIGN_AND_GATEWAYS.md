# NekoSune Patron — 2026 site redesign and gateway settings

This branch, `feature/creator-platform-redesign-gateway-settings`, is based on the **merged** CloudPatron `master` branch and is tracked in draft pull request #3. It is not merged automatically.

## New consistent website design

The original Go-rendered pages now share the new responsive dark layout, sidebar, top actions, footer, card/table/form styles and unified navigation. This changes the presentation of admin dashboards, audience pages, legacy post/level/goal forms, patron account and payment screens, and the public site.

Specifically rebuilt pages:
- Public creator homepage: hero, published posts, tier cards and shop.
- Sign-in and supporter registration screens.
- Patron profile/security settings and support tier selector.
- Admin overview quick actions and project settings organization.
- Payments settings page with credential forms for multiple providers.

Existing legacy Go handlers, post management, legacy Stripe subscription logic and databases have **not** been replaced. Some old page internals still use Semantic UI markup under the modern design.

## Manage payment credentials without storing gateway keys in .env

Sign in as the CloudPatron **administrator**, then visit:

```
https://YOUR_HOST/payment-settings
```

The page lists:

- Stripe: publishable key, secret key, webhook signing secret
- PayPal: client ID, client secret, webhook ID
- NOWPayments: API key, IPN secret
- ZBD: API key, webhook secret
- Heleket: merchant ID, payment key, HTTPS callback URL
- Cryptomus, BitPay, CoinGate, OxaPay, Plisio
- OpenNode, Strike, Alby, Speed
- Checkout.com and Revolut Pay

Credentials are saved through the existing administrator session to the private bridge, not directly from an anonymous browser. The Go proxy checks the signed administrator session and requires an origin and per-session CSRF token for changes.

### Storage and security

Website-entered credentials are encrypted using **AES-256-GCM** and stored under the persistent data volume:

```
/data/payments/gateways.enc.json
/data/payments/gateways.enc.json.key
```

The bridge creates the encryption key on first use. It is stored as a private file (mode 0600) alongside encrypted data. Back up **both** files securely: losing the key permanently prevents recovery of stored credentials. Backups containing both files must be access controlled; this design protects against casual plaintext access, not a compromised host.

- Secret values are **never returned** to the browser, not even after saving.
- Leaving a field blank preserves any existing value.
- The admin can clear a saved provider configuration or replace individual keys.
- The backend does not write new gateway credentials into `.env`.
- HTTPS, secure cookie transport, server backups, operator access restriction and session security remain essential.

**Service-level secrets:** `BRIDGE_API_TOKEN` and `DOWNLOAD_SIGNING_SECRET` still use private deployment environment values; they authenticate the internal Go/Node channel and sign protected downloads. These are infrastructure secrets, separate from merchant gateway credentials.

### Which providers work right now?

- **Heleket:** Node checkout and signature verification use credentials from this vault; saved website values take precedence over `HELEKET_*` deployment env fallback. Enter `https://YOUR_HOST/webhooks/heleket` as the callback URL.
- **Stripe:** The original Go recurring billing engine still uses the old Stripe fields from `/admin`, **not** the new vault's Stripe record. The legacy form now hides saved secrets instead of pre-filling them. Move the billing engine to the vault in a later change.
- **Other provider forms:** The credentials can be stored, but do **not** imply the respective gateway adapters are operational. Provider-specific webhook signature validation and settlement verification must be completed before enabling those options at checkout.

This avoids claiming merchant payment support that does not actually exist.

## Docker images

The redesigned branch is built using `Dockerfile.nekosune` and `compose.yaml`. It publishes a separate staging tag:

```
ghcr.io/nekosuneprojectsforks/cloudpatron:redesign
```

To build directly from source:

```bash
git clone https://github.com/NekoSuneProjectsForks/cloudpatron.git
cd cloudpatron
git switch feature/creator-platform-redesign-gateway-settings
cp .env.example .env
# Set CLOUDPATRON_HTTP_HOST and the two service-level secrets
docker compose build
docker compose up -d
```

To pull the staging tag, set `CLOUDPATRON_IMAGE=ghcr.io/nekosuneprojectsforks/cloudpatron:redesign` in your `.env` before `docker compose pull`.

The Go website runs on 8080; the bridge is private on 127.0.0.1:8091 **inside** the container. Place the Go website behind HTTPS. Data persists under `/data`.

## Verification

```bash
cd payment-bridge
node --test
```

The GitHub Actions Docker workflow builds the complete app and smoke-tests sign-in/signup, session metadata, shop access, and denial of anonymous administrator gateway API/page requests. These tests do **not** replace interactive visual review or a real merchant sandbox checkout.

## Next architecture milestones

1. Replace the JSON payment ledger and discount/gift handling with transactional storage.
2. Migrate legacy Stripe and SMTP secrets to the encrypted vault without breaking existing subscriptions.
3. Centralize all creator identity, tiers, posts, shop orders, gifts, payouts and entitlement records.
4. Add per-creator access controls instead of only a single legacy Go administrator.
5. Build dedicated fully-native pages for audience CRM, analytics charts, posts and media library, tier designer, promotions, gift redemption and creator developer apps.
6. Add verified payment settlement adapters before marking other gateways operational.
