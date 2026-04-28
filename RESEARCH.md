# Dynamic Repricing Tool — Research & Discovery

**Date:** 2026-03-27
**Last updated:** 2026-03-27
**Status:** Pre-build validation phase

---

## The Idea

A repricing automation for sellers on Mirakl-based marketplaces (Worten, Phone House, Fnac, etc.).

**The insight:** On these marketplaces, the lowest price always appears as the main seller. 95%+ of buyers never scroll to see other sellers. Being in 2nd place is almost the same as being invisible. Therefore, winning 1st place — even at a reduced margin — dramatically increases sales volume.

**The automation:** Monitor competitor prices via API, automatically reprice to just below the lowest competitor, but never below a configurable profit floor.

**The second insight — price ceiling:** When already in 1st place, automatically raise price to just below 2nd place. Maximizes margin per sale, not just sales volume. Both directions are equally valuable.

---

## Business Model — M$P Approach

**Not an MVP. A Minimum Profitable Product.**

- Build for one paying customer at high price point (~€5,000)
- Sell first, then build
- Target: established Worten/Phone House sellers doing meaningful volume (€10k+/month GMV)
- Future: expand to SaaS for all Mirakl-based marketplace sellers in Europe

**Value proposition:**
> "Are you losing first position on Worten to competitors by just a few cents? This tool monitors prices and automatically adjusts yours to stay in first place — without ever going below your profit floor. It runs itself."

**ROI framing for buyer:**
- Seller doing €20k/month GMV, losing first position on 40% of catalog
- Recovering 15% of those sales = ~€3k extra revenue/month
- Tool pays for itself in 6 weeks

---

## Repricing Logic — Both Directions

### Undercutting (win 1st place)

```
Default target margin:  10%
Floor margin:           6%  (minimum acceptable to win 1st place)

Decision logic:
  lowest_competitor = offers[0].price  (sorted by bestPrice)
  my_floor_price    = cost × 1.06 + shipping + commission + VAT

  if my_floor_price < lowest_competitor:
      new_price = lowest_competitor - €0.10  → take 1st place
  elif my_floor_price == lowest_competitor:
      new_price = my_floor_price             → tie (acceptable)
  else:
      hold current price                     → can't win profitably, don't race to bottom
```

**Key rule:** Never drop below 6% margin even if it means losing 1st place. Prevents race-to-the-bottom.

### Ceiling Optimization (maximize margin in 1st place)

```
If already in 1st place:
  second_lowest   = offers[1].price
  ceiling_price   = second_lowest - €0.01
  target_price    = cost × 1.10 + shipping + commission + VAT  (10% margin)
  new_price       = min(ceiling_price, target_price)

  if new_price > my_current_price → raise price
  else → hold (already at optimal)
```

**Key rule:** Never raise above the target margin ceiling — the tool optimizes within the band between floor (6%) and target (10%), and uses competitor prices as the upper bound.

---

## Technical Feasibility — GREEN LIGHT

### The Two API Calls Needed

**STEP 1 — Read competitor prices (P11)**
```
GET https://{marketplace-instance}/api/products/offers
    ?product_references=EAN|{ean_code}
    &channel_codes={channel_code}

Auth: Authorization: {shop_api_key}
```

Returns all active offers for that EAN, sorted by `bestPrice` (lowest first).
`offers[0].price` = current lowest competitor price.

Response includes: `all_prices.price` (required field — confirmed in API schema).

**STEP 2 — Update our price (PRI01 via MMP)**
```
POST https://{marketplace-instance}/api/offers/pricing/imports

Auth: Authorization: {shop_api_key}
Body: multipart/form-data, file = CSV with columns:
  "offer-sku";"price"

Returns import_id — poll PRI02 (GET /api/offers/pricing/imports?import_id=X) to confirm.
```

⚠️ Do NOT use OF24 (`POST /api/offers`) for price-only updates. OF24 resets ALL unspecified
offer fields (quantity, description, leadtime, etc.) to defaults. PRI01 is price-only and safe.

PRI02 (`GET /api/offers/pricing/imports`) — tracks import status: WAITING → RUNNING → COMPLETE/FAILED.

### Legality
**100% legal.** P11 is an official documented Mirakl endpoint. The docs explicitly state sellers can access competitor data by default. Mirakl even gives operators an opt-out if they want to disable it — meaning it's intentionally ON by default.

### Key Technical Finding: MMP API Only (No MiraklConnect)

All operations use the **Mirakl Marketplace Platform (MMP) API** directly — one shop API key per marketplace. MiraklConnect is a paid aggregation layer used by large connectors. 90% of sellers use the direct MMP API. We do not use MiraklConnect.

| Operation | Endpoint | Auth |
|-----------|----------|------|
| Read competitor prices | `GET /api/products/offers` (P11) | Shop API Key |
| Read own catalog | `GET /api/offers` (OF21) | Shop API Key |
| Update prices (safe) | `POST /api/offers/pricing/imports` (PRI01) | Shop API Key |
| Track price import | `GET /api/offers/pricing/imports` (PRI02) | Shop API Key |

**Single auth method: `Authorization: {shop_api_key}` header on all calls.**

### Critical: Shop API Key Has No Read-Only Mode

**Confirmed via Mirakl API docs:** The `shop_api_key` is a single flat key with no permission scopes or read-only tier. Whoever holds it has full write access to the seller's account, including:

- Change or delete all offers and prices
- Modify bank/IBAN payment details
- Read all financial data, transaction logs, customer addresses
- Accept/refuse orders on the seller's behalf

**There is no documented way to generate a scoped or read-only key.** Key revocation requires contacting the marketplace operator (Worten support), not a self-service action.

**Implication for sales:** Do not say "I only need read access." Instead frame it as industry-standard practice:
> "É a mesma forma que o Boardfy e outras ferramentas trabalham. A chave fica armazenada de forma segura — se quiserem revogar, contactam o suporte do Worten e a chave deixa de funcionar imediatamente."

**Implication for architecture:** API keys must be stored encrypted, never in plaintext. This is a trust-critical component.

### P11 Works on ALL Mirakl Marketplaces

P11 (`GET /api/products/offers`) is a **Mirakl platform standard endpoint** — not Worten-specific. It exists identically on every Mirakl-powered marketplace. Adding a new marketplace requires only:
1. The instance URL (findable via login page URL trick)
2. The seller's shop API key for that marketplace
3. One new config entry — zero new code

**All five marketplaces OTeuPrimo sells on are confirmed Mirakl.**

### Marketplace Instance URLs
| Marketplace | Instance URL | Status |
|-------------|-------------|--------|
| Worten PT | `https://marketplace.worten.pt` | ✅ Confirmed |
| Phone House ES | `https://phonehousespain-prod.mirakl.net` | ✅ Confirmed |
| Carrefour ES | `https://carrefoures-prod.mirakl.net` | ✅ Confirmed |
| PCComponentes ES | `https://pccomponentes-prod.mirakl.net` | ✅ Confirmed |
| Pixmania | `https://pixmania-prod.mirakl.net` | ⚠️ Pattern — verify via login page |
| Leroy Merlin (ADEO) | `https://adeo-prod.mirakl.net` | ⚠️ Pattern — single instance for FR/ES/PT/IT |
| MediaMarkt/Saturn | `https://mediamarktsaturn.mirakl.net` | ✅ Confirmed — Mirakl-based, same P11 endpoint |

### Channel IDs (from Gabriel's project)
| Marketplace | MiraklConnect Channel ID |
|-------------|--------------------------|
| Worten (PT+ES) | `15218` |
| Phone House Spain | `6343` |

### Multi-Marketplace Pricing Implication
Multi-marketplace sellers (e.g. OTeuPrimo on 5+ marketplaces) are higher-value clients:
- Setup: €1,000 (Worten as base)
- Each additional marketplace: €75/hour config (typically 1-2h = €75-150)
- Monthly: €100/month covers all active marketplaces (or negotiate per-marketplace rate)

---

## Reusable Code from Gabriel's Project

Gabriel's project (`D:\Plannae Project\Gabriel - Marketplace`) already has:

| Component | File | Reuse |
|-----------|------|-------|
| OAuth2 token management | `connectors/mirakl/auth.ts` | **Direct reuse** — same MiraklConnect auth |
| Pricing formula (floor calc) | `lib/pricing/engine.ts` | **Direct reuse** — `calculateSalePrice()` |
| Price submission | `worker/src/jobs/offer-sync.ts` | **Direct reuse** — `submitProductBatch()` |
| Exploration scripts | `scripts/mirakl-explore.js` etc. | **Adapt for P11 test** |

**P11 is NOT implemented in Gabriel's project** — it's documented as deferred to Phase 2. That's the missing piece this tool adds.

### Proof of Concept Script (Ready to Run)
Gabriel's account is suspended — use first client's API key (e.g. Servelec) after the intro call:

```javascript
const WORTEN_API_KEY = 'xxx'
const EAN = '3386460076265' // any product Gabriel sells on Worten

const response = await fetch(
  `https://marketplace.worten.pt/api/products/offers?product_references=EAN|${EAN}&all_offers=true`,
  { headers: { 'Authorization': WORTEN_API_KEY } }
)
const data = await response.json()
console.log(data.products[0].offers) // all competitor prices, sorted cheapest first
```

**Blocker:** Need Gabriel's Worten or Phone House shop API key (from seller portal → Account → API).

---

## System Workflow

### Phase 0 — Onboarding (runs once)

```
1. Client provides credentials:
   → MiraklConnect OAuth2 (client_id + client_secret)  — for writing prices
   → Marketplace shop API keys (one per marketplace)    — for reading P11

2. Fetch full product catalog via OF21
   → all EANs + current prices + stock

3. Pre-filter catalog (skip irrelevant products):
   → stock = 0          → skip
   → price > €300       → skip (optional block)
   → no EAN             → skip
   → ~40-60k active products remain

4. Initial P11 scan (phased):
   → batch 100 EANs per call
   → 10 concurrent calls at a time
   → ~400-600 total calls, completes in seconds

5. Populate database per product:
   → competitor landscape, my position, assign tier

6. First repricing pass → push updated prices to MiraklConnect
```

---

### Database Schema (per product per marketplace)

```
product_ean
marketplace_id
my_current_price
my_floor_price          ← cost × 1.06 + fees (minimum, never go below)
my_target_price         ← cost × 1.10 + fees (default margin goal)
competitor_lowest_price
competitor_second_price ← for ceiling calculation
my_position             ← 1, 2, 3... or "alone"
tier                    ← 1, 2, or 3
last_checked_at
last_repriced_at
```

---

### Tiered Ongoing Cycles

```
TIER 1 — every 15 min
  Condition: my_position > 1 (not in 1st place)
  → P11 check for current competitor prices
  → Can I undercut and stay above floor?
      Yes → new_price = competitor_lowest - €0.10 → push to MiraklConnect
      No  → hold, log "floor reached, can't compete"
  → On success: move product to Tier 2

TIER 2 — every 2 hours
  Condition: my_position = 1 (already winning)
  → P11 check
  → Is there room to raise price (ceiling optimization)?
      ceiling = competitor_second - €0.01
      new_price = min(ceiling, my_target_price)
      If new_price > my_current_price → raise price
  → If competitor now undercuts me → move product to Tier 1

TIER 3 — once daily
  Condition: no competitors found
  → Quick P11 check — has anyone entered this product?
      Yes → assign to Tier 1 or 2
      No  → stay Tier 3, no action
```

---

### Tier Transition Map

```
Tier 3 → Tier 1:  new competitor entered the product
Tier 2 → Tier 1:  competitor undercut us
Tier 1 → Tier 2:  we successfully took 1st place
Tier 1 → Tier 1:  floor reached, can't compete — retry next cycle
```

---

### Scale — Why This Works for 100k Products

- P11 batches 100 EANs per call → 100k products = 1,000 calls
- In steady state only ~20-30% of catalog is contested (Tier 1) = 200-300 calls per 15-min cycle
- At 10 concurrent calls × 200ms: entire Tier 1 cycle completes in ~5 seconds
- Scraping ruled out: too slow, fragile, expensive (€150-600/month in proxies)

### Credentials Required from Client

| Credential | Purpose | Where to find |
|------------|---------|---------------|
| MiraklConnect OAuth2 (client_id + client_secret) | Write updated prices | MiraklConnect account settings |
| Worten shop API key | Read competitor prices (P11) | `marketplace.worten.pt` seller portal |
| Phone House shop API key | Read competitor prices (P11) | `phonehousespain-prod.mirakl.net` seller portal |

Adding a new marketplace = one new API key + one new config entry. No new code needed.

---

## Competition Assessment

| Market | Status |
|--------|--------|
| Amazon repricing tools | Flooded — Repricer.com, Seller Snap, Feedvisor, 50+ tools |
| Mirakl enterprise repricing | Exists (Omnia Retail, Boomerang Commerce) — €10k+/year, SME-inaccessible |
| Mirakl SME repricing | **Almost nothing** |
| n8n automation for Mirakl repricing | **Effectively zero** |

**Known competitors:**
- **Boardfy** (Spanish) — €99+/month, supports Worten, has price ceiling. Likely uses web scraping for price reads.
- **Boostmyshop myPricing** (French) — €99+/month, 300+ marketplaces incl. Worten, has price ceiling. Connects via MiraklConnect.
- Both tools exist but neither has local Portuguese/Spanish presence, local support, or local sales effort.

**Key gap:** Awareness + implementation. INFOPAVON has 50k sales and is still losing to a €0.01 repricing bot. These tools exist — sellers just don't know or haven't set them up.

**Fnac update:** Fnac left Mirakl in June 2025. Portugal's main Mirakl marketplaces are now Worten + Phone House primarily.

---

## Go-to-Market — Cold Outreach

### Finding Sellers
1. Go to any electronics product on Worten
2. Click "+X sellers" section
3. Note every shop name
4. Google them → find website → find phone/email
5. Repeat across 10-15 products → 50-100 potential contacts

### Cold Call Script (Portuguese)
**Opening:**
> *"Olá, bom dia! O meu nome é Pedro, sou programador especializado em automações para marketplaces. Falo com a pessoa responsável pelas vendas no Worten?"*

**Pain hook:**
> *"Estou a desenvolver uma ferramenta que monitoriza automaticamente os preços dos concorrentes no Worten e ajusta o seu preço para garantir que fica sempre em primeiro lugar na listagem. Têm esse problema de perder a primeira posição para concorrentes?"*

**Then stop and listen.**

### Discovery Questions
1. *"Quando um concorrente baixa o preço €0.20 abaixo do vosso no Worten, o que fazem atualmente?"*
2. *"Quantos SKUs têm ativos no Worten? E qual é o vosso volume mensal aproximado?"*
3. *"Estou a fazer um piloto com 3 vendedores por €X. Seria interessante para vocês?"*

**Buying signal:** *"Sim, isso é um problema enorme / verificamos isso manualmente todos os dias"*
**Move on signal:** *"Não vendemos muito no Worten / já temos algo assim"*

**Target:** Call 20+ sellers. If 5+ confirm the pain strongly → price and close one.

---

## P11 — Confirmed Working (2026-04-07)

**Test:** `GET https://marketplace.worten.pt/api/products/offers?product_references=EAN|3386460076265&all_offers=true`
**Auth:** Shop API key from freelance project (suspended store — read-only use only)
**Result: ✅ FULL GREEN LIGHT**

### Confirmed Facts

| Finding | Detail |
|---------|--------|
| Correct parameter format | `product_references=EAN|{ean}` — comma-separate for batch (`EAN|111,EAN|222`) |
| `all_offers=true` returns ALL offers | **Ricardo was wrong** — full competitor list returned, not just best price |
| `total_count` field | Total number of offers (38 in test) — pagination needed if >10 |
| Default page size | 10 offers per response — use `max` param to increase (check Mirakl docs for limit) |
| `total_price` field | Includes shipping — use this for true competitive comparison |
| `active: true/false` | Inactive offers (zero stock, shop not open) returned but flagged — filter to `active: true` only |
| Per-channel pricing | `all_prices` array has per-channel breakdown (WRT_PT_ONLINE, WRT_ES_ONLINE) in one call |
| `shop_id` | Returns as `null` — shop IDs are hidden for privacy. `shop_name` IS visible |
| Competitor data visible | Yes — other sellers' names and prices visible from any valid key |
| Suspended account works | Read-only P11 works even from a suspended shop |

### Implications for 2nd Place Targeting
Ricardo's concern was unfounded — `all_offers=true` returns the full ranked list. The 2nd place targeting feature (future-ideas.md) is technically viable.

### Pagination Note
With 38 total offers and 10 returned by default, production code needs to handle pagination or use a `max` parameter. For repricing purposes, we only need offers[0] (1st place) and offers[1] (2nd place) — so default 10 is more than sufficient.

---

## Open Questions / Blockers

| Question | Status | Action |
|----------|--------|--------|
| Does P11 actually return competitor prices with a real seller key? | ✅ **CONFIRMED** | Tested 2026-04-07 — works perfectly |
| Has Worten disabled competitor data visibility for sellers? | ✅ **NO** — data visible | Confirmed: all competitor names and prices returned |
| `all_offers=true` returns full list or just best price? | ✅ **Full list confirmed** | Ricardo (WDMI) was wrong — all offers returned |
| Gabriel's API key | ✅ Irrelevant | Gabriel's account is suspended — freelance key used for testing |
| Is there willingness to pay among Worten sellers? | 🟡 In progress | Servelec + WDMI + You Get + MCGAD (today) all warm |

---

## Next Steps

1. **MCGAD meeting today 15h** — discovery call, propose free report, get API key
2. **Follow up Servelec + WDMI + You Get** — all warm, pending API keys
3. **With any client API key:** Run P11 scan across their catalog → generate opportunity report
4. **Report → close:** Show results, take €500 upfront, build the tool
5. **Parallel:** Continue cold calling (Multishop, NETNBUY, LojaWeb, etc.)
