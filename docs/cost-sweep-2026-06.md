# Cost Sweep, June 2026

How Petdex went from a projected $404/month on Vercel to ~$60/month, with the June 5 outage class (Error 1027) structurally closed. Companion to the executable audit plans in [`plans/`](../plans/README.md).

## Baseline

Billing API, 24h window on 2026-06-04:

| Line | $/day | Consumed |
|---|---:|---|
| Edge Requests | $4.95 | 1.9M requests |
| Fast Origin Transfer | $2.63 | 16.6 GB |
| Fluid Active CPU | $1.55 | 10.2 h |
| Function Invocations | $1.50 | 2.4M |
| Speed Insights + Web Analytics | $2.06 | 14k points + 25k events |
| **Total petdex** | **$13.47** | ~$404/mo run-rate |

Root causes found by the audit (full evidence in `plans/README.md`):

1. **HTML never edge-cached.** next-intl emitted a `NEXT_LOCALE` Set-Cookie on every response; Cloudflare never caches responses carrying Set-Cookie. No `Cloudflare-CDN-Cache-Control` was emitted either. Every anonymous page view hit Vercel.
2. **Assets never edge-cached.** `assets.petdex.dev` served every sprite/manifest from origin (`cf-cache-status: DYNAMIC`). This is the same failure shape as the June 5 outage: the asset host hit a request cap under viral traffic and Cloudflare cut it off (Error 1027).
3. **Per-request middleware overhead.** Two Upstash Redis round-trips on every public page view, plus Clerk middleware wrapping all traffic, plus bot-blocking and legacy-host redirects paying Vercel invocations for traffic Cloudflare could reject for free.
4. **A global client floor.** Every anonymous page hydrated ClerkProvider + header-state + feedback machinery (~146KB gzip JS minimum, 247KB on home).

## What landed

| Change | Where |
|---|---|
| Public HTML cache contract (kill NEXT_LOCALE cookie, `Cloudflare-CDN-Cache-Control`) | PR #450 |
| `/requests`, `/leaderboard`, `/download` static/ISR | PR #451 |
| Middleware diet (no Upstash on page views, Clerk bypass for public paths) | PR #452 |
| Lazy public auth shell (no Clerk JS for anonymous visitors) | PR #453 |
| `assets.petdex.dev` as R2 custom domain + Cache Rules + hotlink WAF | Cloudflare ops |
| Cache Rules for HTML/details/APIs with Clerk-cookie bypass | Cloudflare ops |
| Known-abuser blocking moved to WAF (blocked before reaching Vercel) | Cloudflare ops |
| Ignored Build Step: commits touching only `packages/`, `docs/`, `*.md` no longer deploy the app | Project setting |
| Vercel cost report script: closed-bucket window + per-day table | `scripts/vercel-cost-report.ts` |

Verified in production (2026-06-11): anonymous `/en` serves `cf-cache-status: HIT` with no Set-Cookie; requests carrying Clerk session cookies bypass the cache; sprites serve `HIT` with `cache-control: public, max-age=31536000, immutable`; manifests serve `HIT` within a 300s TTL; foreign-referer hotlinking gets a WAF 403 that never reaches origin; anonymous HTML contains zero Clerk script references.

Note for future probes: on R2 custom domains, verify caching with GET requests. HEAD requests report `cf-cache-status: DYNAMIC` even when GETs are served from cache.

## Results

Daily billed cost for the petdex project (Billing API, closed 07:00Z buckets):

```
2026-06-01  $13.22   pre-sweep
2026-06-02  $12.42
2026-06-03  $13.41
2026-06-04  $ 6.07   request-volume mitigations age in
2026-06-05  $ 2.01
2026-06-06  $ 2.40
2026-06-07  $ 1.56
2026-06-08  $ 1.92
2026-06-09  $ 2.01
2026-06-10  $ 2.27   PRs #450-453 + cache rules land June 10-11;
                     their effect shows from June 11 buckets onward
```

~85% reduction before the edge-cache work even ages in. Remaining residuals: ISR writes (~$0.4/day, dominated by full-cache invalidation on every deploy — addressed by the Ignored Build Step), Fluid CPU (~$0.3/day, falls with cache; OG image generation is the next target if it plateaus), and signed-in traffic.

Team-level cleanup in the same sweep: two unused projects/stores deleted with their owners' sign-off (including a 277GB orphan blob store), 19 dead blob stores emptied and removed, and an orphaned Speed Insights subscription confirmed canceled (ends June 18).

## ISR writes: findings

50-160k writes/day. The driver is not `revalidate` values: every production deploy invalidates the full ISR cache, and ~8,400 static pages (2,800 pets x 3 locales) plus OG images re-render and re-write on subsequent traffic. Spikes correlate exactly with deploy-heavy days (156k writes on June 4, ~20 deploys). The project had no Ignored Build Step, so CLI/desktop/bot/docs-only commits also triggered full deploys. Fixed via:

```bash
git diff --quiet HEAD^ HEAD -- ':!packages' ':!docs' ':!*.md'
```

If a legitimate app change ever skips its build, remove the setting from the project dashboard (Settings -> Git -> Ignored Build Step).

## What's deliberately not done

- `/u/[handle]` stays force-dynamic (public-profile vs owner-dashboard split deferred until route-cost buckets prove it hot).
- The R2 snapshot publish pipeline is still manual; automating it is the gate to removing the remaining public read APIs from Vercel Node.
- The endgame architecture (static public catalog + R2 artifacts + small Workers, Vercel removed for the public app, ~$5-10/mo flat) is a separate decision tracked in the migration handoff. Its value is resilience and cost sublinear in traffic, not the dollar delta.

## Measurement

```bash
bun run cost:report            # last 7 closed daily buckets, per-day table
bun run cost:report --days 30  # longer window
```

Charges materialize with ~24h lag after each 07:00Z bucket close; the script warns when the newest bucket is still empty.
