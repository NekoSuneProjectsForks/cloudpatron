# Creator Studio, Shop and Audience — implementation notes

This development branch extends the `payment-bridge` alongside the original CloudPatron Go server. It does **not** yet replace the legacy site's templates or authentication.

## New screens

- `GET /shop?creatorId=nekosune` — responsive dark creator shop with search, public products and allowlisted YouTube previews. Checkout buttons are **disabled** until secure patron login / checkout wiring is complete.
- `GET /creator-studio` — dark creator management interface for posts, gift codes, discount codes, audience counts and member entitlements. Development-only: use on trusted private ingress, not a public shared origin. It currently takes a BRIDGE_API_TOKEN typed by the administrator and never saves it to browser storage.

The UI is original NekoSune styling, not a copy of Patreon's assets. UI inspiration is based on creator-provided Patreon screenshots. A future Go template redesign will add shared navigation, mobile layouts, authentic sessions and feature parity.

## Shop API

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/v1/public/shop?creatorId=...` | Public | Published catalog, no private asset IDs |
| POST | `/v1/admin/shop/products` | Private bridge admin | Create/update digital products |
| POST | `/v1/admin/shop/assets` | Private bridge admin | Raw upload (Content-Type and Content-Length required, max 25 MB) |
| POST | `/v1/invoices` | Private bridge admin | Create checkout with `productId`; price is always read from server catalog |
| POST | `/v1/admin/shop/download-tickets` | Private bridge admin | Create a five-minute signed link only for verified purchaser |
| GET | `/v1/downloads/:token` | Signed token | Rechecks original paid invoice on each request; refunded, expired or unpaid denied |

Products support `billing=one_time` or `monthly`; monthly currently means **one verified payment gives 30 days of access**, not real automatic recurring charge. Automatic subscription billing and renewal API remain outstanding. This is an integration foundation, not production payment checkout.

### Example product

```json
{
  "id": "hardstyle-fx",
  "creatorId": "nekosune",
  "title": "Hardstyle FX Animation Pack",
  "description": "VRChat-ready digital animation download",
  "kind": "download",
  "billing": "one_time",
  "price": "6.00",
  "currency": "GBP",
  "assetId": "asset_uploaded_by_admin",
  "youtubeUrl": "https://youtu.be/dQw4w9WgXcQ",
  "published": true
}
```

Uploaded files live outside the public web directory. Streaming/partial-range/HLS export is not implemented. Video uploads are limited to 25MB in this initial bridge; larger files, transcoding, thumbnails, S3 and resumable uploads require dedicated work. YouTube embeds are **previews only**: a publicly accessible video on YouTube cannot become private merely by placing its iframe behind a paywall.

## Posts

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/v1/public/posts?creatorId=...` | Public | Public excerpts, free published content only |
| GET | `/v1/public/posts/:id` | Public | Unlocked free post or locked post excerpt |
| POST | `/v1/admin/creator/posts` | Private bridge admin | Upsert draft or published post |
| GET | `/v1/creator/posts/:id?patronId=...` | Project token with `posts:read` | Read full post only when verified entitlement matches |

Post `access`: `free`, `members`, `one_time`, `members_or_purchase`. Membership-locked posts require `tierId`. One-time posts are also registered as shop products with IDs `post_<postid>`, so purchasers can use the same signed-payment checkout. Access is checked server-side; never rely on hiding frontend elements.

## Gifts

| Method | Endpoint | Auth |
|---|---|---|
| POST | `/v1/admin/creator/gifts` | Private bridge admin |
| POST | `/v1/admin/creator/gifts/redeem` | Private bridge admin |

Gift codes are random, case-insensitive, stored as SHA256 hashes only, and carry tier, number of days, expiry and redemption limit. Gift grants are read through the normal scoped Creator API; they don't require a paid transaction. Manual redemption requires **trusted administrator authentication** in this phase. The returned `redeemPath` is a *planned* user-facing route, not yet a working self-service link. Automated email invites, user login and self-service gift redemption are on the roadmap.

## Discounts

| Method | Endpoint | Auth |
|---|---|---|
| POST | `/v1/admin/creator/discounts` | Private bridge admin |
| POST | `/v1/admin/creator/discounts/quote` | Private bridge admin |

The `POST /v1/invoices` shop checkout can take an optional `discountCode`. The bridge validates creator/product, expiry and maximum paid uses; it performs integer-cent discount arithmetic and stores the original catalog price in the invoice snapshot. This is a **beta discount implementation**. Reservation locking for concurrent checkouts, single-use-per-patron, refunds, public discount landing pages, subscription-first-month discounts and tax calculations are still outstanding.

## Audience & insights

| Method | Endpoint | Auth |
|---|---|---|
| GET | `/v1/admin/creator/audience?creatorId=...` | Private bridge admin |
| GET | `/v1/admin/creator/members?creatorId=...` | Private bridge admin |

Insights return total supporters, active members, verified paid invoice count, payment status breakdown and generated timestamp. The member view returns up to 500 patron IDs and their tier grants. No email export or personal details are included yet. Full analytics dashboards (shop revenue by currency, traffic, posts, member retention, creator payout fees, audience acquisition, downloads, cancellation reasons, tier conversions and CSV exports) require transactional data and aggregation.

## VRChat

- `GET /v1/public/vrchat/tiers?creatorId=nekosune` returns JSON `{creatorId,updatedAt,supporters:[{username,tiers}]}`.
- A private admin can record a supporter ↔ VRChat name mapping with `POST /v1/admin/vrchat/link`, provided consent is recorded and `publicOptIn=true`.
- Only currently paid **membership** tiers appear in the public list; purchased shop products are excluded.
- VRChat name ownership isn't automatically verified yet. Add VRChat OAuth or another supported identity-verification flow before public launch; do not assume typing a name proves ownership.

### Security and deployment blockers

1. Connect the legacy Go user accounts and creator roles to this bridge. Right now only the private admin token can perform writes or start checkouts.
2. Create scoped creator-project OAuth apps, independent project keys, patron consent and verified user identity mapping. Do not expose privileged project bearer tokens inside VRChat worlds.
3. Replace single JSON storage with transactional database and atomic gift/discount redemptions and payment callback deduplication.
4. Add upload scanning, quotas, storage settings, streaming/media transcoding, optional S3/MinIO, backup strategy and tier access revocation.
5. Verify Heleket webhook signing/field handling in live sandbox, reconcile missed callbacks with the provider and add refunds/chargebacks.
6. Properly integrate recurring billing and test that paid subscribers, gift grants and one-time customers receive precisely the right perks.
7. Add creator-facing pages for post creation, all media types, tier management, purchase receipts, discounts and audience export without exposing bridge admin tokens.

### 2026 Patreon-like roadmap

Based on Patreon public help information (Insights, Gift Memberships, Discounts and Shop as of November 2026), phase-next priorities: audience tabs for free/paid/ex-members; post drafts/scheduling/polls; attachments and collections; subscriber messages and notifications; member profile history, joins, cancellations and retries; earnings and shop trends; paid content previews and bundles; gift-link self redemption; discounts per tier and first renewal period; campaigns and promotions; integrations for Discord/Minecraft/FiveM/VRChat; custom domains and privacy tools.

References:
- https://support.patreon.com/hc/en-gb/articles/207346316-Insights-dashboards
- https://support.patreon.com/hc/en-gb/articles/31345065123597-Gifting-memberships-to-your-fans-creator-to-fan-gifts
- https://support.patreon.com/hc/en-gb/articles/16303719836813-Selling-one-time-purchases-on-Patreon
- https://support.patreon.com/hc/en-gb/articles/27479665547917-Managing-discounts
