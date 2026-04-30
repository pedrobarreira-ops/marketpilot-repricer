# Screenshots — Worten Seller Center walkthrough

Drop three PNG screenshots here, captured from the Worten Seller Center, before customer #1 onboards:

| File | What it shows |
|------|----------------|
| `step-1.png` | Login page of `sellercenter.worten.pt` (or whichever the actual URL is — verify) |
| `step-2.png` | Navigation from account menu → **Definições** → **API** (verify menu labels) |
| `step-3.png` | The "Gerar nova chave API" button + the generated-key display (verify button label and one-time-shown behavior) |

Recommended capture: **1280 × 720** (16:9), PNG, with personal data redacted.

When images land here, the modal at [`../16-onboarding-key-help.html`](../../16-onboarding-key-help.html) renders them in place of the dashed "image-placeholder" boxes.

The HTML stub at `../../16-onboarding-key-help.html` already includes:
- The full PT walkthrough copy (3 numbered steps + trust-echo)
- A stub-banner at the top listing the four Seller-Center specifics Pedro should verify before publishing
- `<img>` references at the matching paths (currently rendering as dashed placeholders since the PNGs don't exist yet)
