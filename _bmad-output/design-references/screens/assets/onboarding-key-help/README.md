# Screenshots — Worten Seller Center walkthrough

Drop two PNG screenshots here, captured from the Worten Seller Center, before customer #1 onboards.

> **⚠ Redact the API key before saving.** The Worten `shop_api_key` has full account access (bank/IBAN, sales, prices). Replace the visible key with `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (matches UUID shape) before saving the PNG to disk. Do NOT commit screenshots showing a live key.

## Files needed

| File | What it shows | Source |
|------|----------------|--------|
| `step-2.png` | Avatar dropdown (upper right) with **Definições pessoais** menu item visible | After login at `marketplace.worten.pt`, click avatar |
| `step-3.png` | **Chave de API** tab inside Definições pessoais — showing the key (REDACTED), the **Copiar chave API** button, and the **Ações** dropdown | Definições pessoais → Chave de API tab |

Login (step 1) is text-only in the walkthrough — no screenshot needed for that step.

## Recommended capture

- Resolution: **1280 × 720** (16:9), PNG
- Crop tightly — avoid full-screen captures with chrome
- Redact: API key, any visible NIF, shop email if shown, IBAN if shown
- Keep: shop name (public on the marketplace anyway), shop ID, generic UI labels

## Verified Worten Seller Center flow (confirmed 2026-04-30)

1. Go to `marketplace.worten.pt` and log in
2. Click avatar in upper-right corner
3. Click **Definições pessoais** (NOT "Definições" — full label is "Definições pessoais")
4. The first tab inside is **Chave de API**
5. If a key exists → click **Copiar chave API**
6. If no key exists → click **Ações** (upper-right of the Chave de API card) → **Gerar nova chave de API**
7. Regenerating invalidates the previous key

Once images land here, the modal at [`../../16-onboarding-key-help.html`](../../16-onboarding-key-help.html) renders them in place of the dashed "image-placeholder" boxes.
