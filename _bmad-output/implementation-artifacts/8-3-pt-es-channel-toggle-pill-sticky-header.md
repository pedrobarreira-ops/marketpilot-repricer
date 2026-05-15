# Story 8.3: PT/ES Channel Toggle Pill in Sticky Header

**Sprint-status key:** `8-3-pt-es-channel-toggle-pill-in-sticky-header`
**Status:** ready-for-dev
**Size:** S
**Epic:** Epic 8 — Customer Dashboard & Surfaces
**Atomicity:** None — standalone story, no atomicity bundle
**Depends on:** Story 8.1 (dashboard chrome + `default.eta` channel toggle slot), Story 8.2 (KPI cards re-render on toggle change)
**Enables:** Story 8.4 (margin editor's worked-example SKU pool re-evaluates on toggle), Story 9.3 (audit feeds filter by channel)

---

## Narrative

**As a** customer on the dashboard,
**I want** a PT / ES pill toggle in the sticky header,
**So that** I can switch between the Worten Portugal and Worten Spain channel views and have the KPI cards, margin editor worked-example, and audit preview update accordingly.

---

## Trace

- **FRs:** FR25 (per-channel repricing), FR35 (PT/ES channel toggle)
- **NFRs:** NFR-L1 (PT default), NFR-A1 (WCAG 2.1 AA), NFR-A2 (keyboard accessible)
- **UX-DRs:** UX-DR14 (single-select MVP; "Both" is Phase 2)
- **Architecture decisions:** AD6 (per-channel pricing — Worten PT vs ES), Architectural Constraint #10 (no ES UI translation at MVP — toggle labels are `PT` / `ES`, not full translations)
- **Pattern A/B/C contract:**
  - Behavior: FR35; UX-DR14
  - Structure: UX skeleton §4.2.2 (channel toggle behavior), §10.1 (visual DNA — PT/ES toggle pill identical to free-report `MarketPilot.html`)
  - Visual: Pattern A — toggle pill appears within the already-rendered `screens/03-dashboard-live.html` (live state) and other dashboard state stubs as part of the sticky header

---

## Acceptance Criteria

### AC#1 — Toggle renders `PT | ES` segmented pill in sticky header; correct scope

**Given** `app/src/views/components/channel-toggle.eta` included in `default.eta` via the `<%~ it.channelToggle || '' %>` slot (Story 8.1)
**When** the dashboard route passes the toggle HTML to the layout
**Then** the sticky header shows a segmented pill with exactly two buttons: `PT` and `ES` (no third "Both"/"Ambos" button per UX-DR14)
**And** the active channel button has `aria-selected="true"` and a highlighted CSS class (`mp-toggle-btn--active`)
**And** the toggle scope (controlled by `data-toggle-scope` attribute on the scoped container or by JS reading the toggle value and updating relevant sections) covers:
- KPI cards section (Story 8.2 — re-reads `channel_code` from toggle state)
- Margin editor worked-example SKU candidate pool (Story 8.4 — re-evaluates on toggle)
- "Hoje" audit-log preview row (future Stories 8.x) — wired via `data-channel-scope` attribute
- Recent Atenção items preview (future Stories 8.x) — wired via `data-channel-scope` attribute
**And** the banner zone (`mp-banner-zone`) is NOT inside the scoped container — banners are system-level, not channel-level (exception: anomaly-count banner §9.7 specifies per-channel split copy at render time, but it renders regardless of toggle state)

### AC#2 — Toggle persists per-session via localStorage; default is PT

**Given** a customer's first dashboard load (no localStorage entry for `mp_channel`)
**When** the page initializes (`public/js/dashboard.js`)
**Then** `PT` is the active channel (stored to `localStorage.setItem('mp_channel', 'pt')`)
**And** when the customer toggles to `ES` and navigates to `/audit`, then returns to `/`, the toggle restores to `ES` via `localStorage.getItem('mp_channel')`
**And** the channel value in localStorage is lowercase `'pt'` or `'es'` (matches `WRT_PT_ONLINE` / `WRT_ES_ONLINE` suffix convention without the prefix)

### AC#3 — No "Both" merged view; strictly PT XOR ES

**Given** the toggle component
**When** the HTML is inspected
**Then** there are exactly 2 toggle buttons (PT and ES) — no third button for "Both", "Ambos", or any merged view
**And** a code comment in `channel-toggle.eta` documents: `<!-- Phase 2: 'Both' merged view requires cross-channel EAN deduplication — deferred per UX-DR14 -->`

### AC#4 — Single-channel customer: toggle hidden or shown disabled with tooltip

**Given** a customer whose `customer_marketplaces` row has only 1 distinct active channel (e.g., only Worten PT, no Worten ES entry)
**When** the dashboard route queries the channel count and passes `channelCount` to the view
**Then** if `channelCount === 1`: the toggle is either hidden entirely OR rendered disabled with `aria-disabled="true"` and a tooltip `title="Apenas PT ativo neste marketplace"` (choose hidden; document in Dev Notes)
**And** if `channelCount >= 2`: the toggle renders normally as per AC#1

---

## Tasks / Subtasks

- [ ] Task 1: Create `app/src/views/components/channel-toggle.eta` (AC#1, AC#3, AC#4)
  - [ ] Subtask 1.1: Segmented pill with PT and ES buttons + active class from `it.activeChannel`
  - [ ] Subtask 1.2: `aria-selected`, `aria-label`, `data-channel` attributes on each button
  - [ ] Subtask 1.3: Phase 2 "Both" comment per AC#3
  - [ ] Subtask 1.4: Single-channel guard (hide when `it.channelCount === 1` per AC#4)

- [ ] Task 2: Extend dashboard route to query channel count and default channel (AC#1, AC#4)
  - [ ] Subtask 2.1: Add channel count query to `app/src/routes/dashboard/index.js` (count distinct `channel_code` values for this `customer_marketplace_id`)
  - [ ] Subtask 2.2: Pass `channelToggle` (rendered HTML from channel-toggle.eta) and `activeChannel` to `reply.view()` payload
  - [ ] Note: `req.db` is the RLS-aware client — RLS scopes the query to the authenticated customer automatically

- [ ] Task 3: Extend `public/js/dashboard.js` with toggle state management (AC#2)
  - [ ] Subtask 3.1: Fill the "Channel toggle slot (Story 8.3)" placeholder in `dashboard.js`
  - [ ] Subtask 3.2: On DOMContentLoaded: read `localStorage.getItem('mp_channel')` (default `'pt'`)
  - [ ] Subtask 3.3: Set active class on the correct button from localStorage
  - [ ] Subtask 3.4: On button click: update `localStorage.setItem('mp_channel', channel)`, update active class, dispatch a `channelchange` CustomEvent on `document` for KPI cards and other sections to react
  - [ ] Subtask 3.5: No `console.log` — no pino equivalent in client JS; silent operation

- [ ] Task 4: Wire `channel-toggle.eta` into `default.eta` channelToggle slot (AC#1)
  - [ ] Subtask 4.1: Dashboard route renders `channel-toggle.eta` via Eta's `include()` or string injection and passes result as `channelToggle` to layout
  - [ ] Note: `default.eta` already has `<%~ it.channelToggle || '' %>` slot from Story 8.1 — do NOT modify `default.eta` header structure; only provide the rendered component string from the route handler

- [ ] Task 5: Fill test scaffold stubs in `channel-toggle.test.js` (AC#1–AC#4)
  - [ ] Subtask 5.1: Fill `toggle_renders_pt_es_segmented_buttons_in_sticky_header` — Fastify inject GET / with mocked DB (2 channels); assert HTML includes PT and ES buttons
  - [ ] Subtask 5.2: Fill `active_channel_button_has_highlighted_class` — assert PT button has `mp-toggle-btn--active` or `aria-selected="true"` on first load
  - [ ] Subtask 5.3: Fill `toggle_scope_includes_kpi_cards_margin_editor_audit_preview` — assert scoped container wraps KPI section; banner zone is outside it
  - [ ] Subtask 5.4: Fill `toggle_does_not_scope_global_banner_zone` — assert banner zone NOT inside toggled container
  - [ ] Subtask 5.5: Fill `default_channel_is_pt_on_first_load` — assert PT button active when no localStorage hint in initial render
  - [ ] Subtask 5.6: Fill `toggle_state_sticky_across_navigation_via_local_storage` — already has a static assertion for `localStorage` in `dashboard.js`; verify it passes after Task 3
  - [ ] Subtask 5.7: Fill `no_both_merged_view_button_exists` — assert `!html.includes('Ambos')` and `!html.includes('Both')`
  - [ ] Subtask 5.8: Fill `toggle_is_strictly_pt_xor_es` — count buttons with `data-channel` attribute; assert exactly 2
  - [ ] Subtask 5.9: Fill `toggle_hidden_when_customer_has_single_channel_only` — mock DB with channelCount=1; assert toggle absent from HTML
  - [ ] Subtask 5.10: Fill `single_channel_shows_tooltip_apenas_pt_ativo_neste_marketplace` — assert tooltip text present when disabled variant is used (or assert toggle absent per chosen variant)

---

## Dev Notes

### CRITICAL: Story 8.1 Already Created the Slot — Do Not Recreate

Story 8.1 shipped `app/src/views/layouts/default.eta` with this exact slot in the sticky header:

```eta
<!-- Channel toggle slot — Story 8.3 fills this with channel-toggle.eta -->
<%~ it.channelToggle || '' %>
```

Story 8.3 fills this slot by:
1. Rendering `channel-toggle.eta` as a partial from the dashboard route handler
2. Passing the rendered HTML string as `channelToggle` in the `reply.view()` payload

Do NOT create a new slot or modify the `default.eta` header structure — the slot is already wired.

### Channel Toggle Component: `channel-toggle.eta`

Visual DNA source: `MarketPilot.html` lines ~1237-1257 — the free-report PT/ES toggle uses:
- Container: `display: flex; background: var(--mp-surface); border: 1px solid var(--mp-line-soft); border-radius: var(--mp-radius-sm); padding: 4px;`
- Active button: `background: var(--mp-primary)` (navy gradient), `color: #fff`
- Inactive button: `background: transparent`, `color: var(--mp-ink-2)`
- Transition: `transition: all 0.15s`

The dashboard version uses abbreviated labels `PT` / `ES` (not `Portugal` / `Espanha` — sticky header space is constrained). UX skeleton §10.1 says "PT/ES toggle pill — same component, same styling" (carried verbatim from free report). Use abbreviated labels.

```eta
<%# app/src/views/components/channel-toggle.eta %>
<% if (it.channelCount >= 2) { %>
  <div class="mp-channel-toggle" role="group" aria-label="Canal de preços ativo">
    <button
      class="mp-toggle-btn <% if (it.activeChannel === 'pt') { %>mp-toggle-btn--active<% } %>"
      data-channel="pt"
      aria-selected="<%= it.activeChannel === 'pt' ? 'true' : 'false' %>"
      aria-label="Canal Portugal"
      type="button"
    >PT</button>
    <button
      class="mp-toggle-btn <% if (it.activeChannel === 'es') { %>mp-toggle-btn--active<% } %>"
      data-channel="es"
      aria-selected="<%= it.activeChannel === 'es' ? 'true' : 'false' %>"
      aria-label="Canal Espanha"
      type="button"
    >ES</button>
    <!-- Phase 2: 'Both' merged view requires cross-channel EAN deduplication — deferred per UX-DR14 -->
  </div>
<% } else { %>
  <!-- Single-channel: toggle hidden (channelCount < 2) per AC#4 -->
  <!-- Phase 2: show disabled toggle with tooltip "Apenas PT ativo neste marketplace" if UX requests it -->
<% } %>
```

### Channel Count Query (extend `app/src/routes/dashboard/index.js`)

Add to the existing SQL query in Story 8.1's route handler (or run as a second `req.db.query()` call):

```js
// Channel count: how many distinct channels does this customer_marketplace have?
const { rows: channelRows } = await req.db.query(
  `SELECT COUNT(DISTINCT sc.channel_code)::int AS channel_count
   FROM sku_channels sc
   WHERE sc.customer_marketplace_id = cm.id
   -- RLS-aware client; cm.id resolved via outer query or separate query on customer_marketplaces
   `,
  // ...
);
```

**Simpler approach** (preferred — avoids a JOIN): Run the channel count as a second query after the first:

```js
const { rows: chanRows } = await req.db.query(
  `SELECT COUNT(DISTINCT sc.channel_code)::int AS channel_count
   FROM sku_channels sc
   JOIN customer_marketplaces cm ON cm.id = sc.customer_marketplace_id
   WHERE cm.customer_id = $1`,
  [req.user.id]
);
const channelCount = chanRows[0]?.channel_count ?? 1;
```

RLS is active on `sku_channels` — the customer can only see their own rows. The `cm.customer_id = $1` filter is belt-and-suspenders for clarity, but RLS alone is sufficient.

**Pass to view:**

```js
return reply.view('pages/dashboard.eta', {
  // ... existing Story 8.1 fields ...
  channelCount,
  activeChannel: 'pt', // server-side default; client JS overrides via localStorage
  // channelToggle: rendered via Eta include or partial injection (see below)
});
```

### How to Pass `channelToggle` to the Layout

**Option A (recommended):** Render `channel-toggle.eta` as an Eta partial from within `dashboard.eta`:

In `dashboard.eta`, add near the top:

```eta
<%~ include('/components/channel-toggle', { channelCount: it.channelCount, activeChannel: it.activeChannel }) %>
```

Then in the Eta layout call, pass the result up to `default.eta`'s `channelToggle` slot. However, Eta doesn't support block-passing to layout this way directly.

**Option B (recommended for this slot pattern):** Since `default.eta` already uses `<%~ it.channelToggle || '' %>`, the dashboard route handler should render the toggle HTML and pass it as a string.

In `app/src/routes/dashboard/index.js`:

```js
// Render channel-toggle partial to string for layout slot
const channelToggleHtml = await reply.view('components/channel-toggle.eta', {
  channelCount,
  activeChannel: 'pt',
}, { raw: true }); // Eta view-as-string; verify Fastify-Eta API for raw render

return reply.view('pages/dashboard.eta', {
  // ... existing fields ...
  channelToggle: channelToggleHtml,
  channelCount,
  activeChannel: 'pt',
});
```

**Check the actual Fastify-Eta API in server.js or existing routes before implementing.** The `@fastify/view` plugin's `reply.view()` renders to response — to get a string, check if `fastify.view()` (instance method, not reply method) exists. If not, use Eta's standalone `renderFile` or `render` from the `eta` package directly. Look at how other routes handle partial inclusion.

**Alternative (simpler):** Pass `channelCount` and `activeChannel` to `dashboard.eta`, and have `dashboard.eta` include `channel-toggle.eta` and inject the result into the layout's `channelToggle` block via Eta's `setBlock`/`contentFor` if available, or simply inline the toggle HTML in `dashboard.eta` and pass it up.

**Pragmatic fallback:** Include `channel-toggle.eta` directly in `dashboard.eta` (not in `default.eta`'s slot), placing it where it visually belongs in the sticky header area. This avoids the render-to-string complexity. However, this deviates from Story 8.1's slot pattern. Check the existing `app/src/routes/dashboard/index.js` Story 8.1 implementation to see how `userEmail` and `userInitials` are passed — the pattern there shows what fields the layout expects.

**Decision note for Amelia:** Story 8.1 passes `userEmail` and `userInitials` to `reply.view('pages/dashboard.eta', {...})` and the layout uses them via `it.userEmail`. The `channelToggle` slot in `default.eta` expects an HTML string passed as `it.channelToggle`. The cleanest implementation: render `channel-toggle.eta` as a standalone Eta string within the route handler using `eta.render(templateSource, data)`, then pass the result as `channelToggle` to the view. Document which approach you chose in the Dev Agent Record.

### Toggle JS: `public/js/dashboard.js` Extension

Fill the `// ── Channel toggle slot (Story 8.3) ──` placeholder:

```js
// ── Channel toggle slot (Story 8.3) ─────────────────────────────────────────

(function initChannelToggle() {
  const STORAGE_KEY = 'mp_channel';
  const DEFAULT_CHANNEL = 'pt';

  const toggleBtns = document.querySelectorAll('.mp-channel-toggle .mp-toggle-btn');
  if (!toggleBtns.length) return; // single-channel: toggle not rendered

  function getActiveChannel() {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'pt' || stored === 'es' ? stored : DEFAULT_CHANNEL;
  }

  function setActiveChannel(channel) {
    localStorage.setItem(STORAGE_KEY, channel);
    toggleBtns.forEach(btn => {
      const isActive = btn.dataset.channel === channel;
      btn.classList.toggle('mp-toggle-btn--active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    // Notify interested sections (KPI cards, margin editor, audit preview)
    document.dispatchEvent(new CustomEvent('channelchange', { detail: { channel } }));
  }

  // Initialize from localStorage
  setActiveChannel(getActiveChannel());

  // Wire click handlers
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => setActiveChannel(btn.dataset.channel));
  });
})();
```

**Constraints:**
- No `console.log` anywhere in this file — per architecture constraint #18 (no console.log in production code)
- No `type="module"` unless ES import syntax is needed — this is a classic script per F9
- The `channelchange` CustomEvent allows KPI cards (Story 8.2) and margin editor (Story 8.4) to react without direct coupling

### CSS Classes to Add to `public/css/components.css`

```css
/* Channel toggle pill — carried from MarketPilot.html visual DNA (§10.1) */
.mp-channel-toggle {
  display: flex;
  background: var(--mp-surface);
  border: 1px solid var(--mp-line-soft);
  border-radius: var(--mp-radius-sm);
  padding: 4px;
  gap: 0;
}

.mp-toggle-btn {
  padding: 8px 18px;
  border: none;
  cursor: pointer;
  background: transparent;
  color: var(--mp-ink-2);
  font-weight: 600;
  font-size: 13px;
  border-radius: calc(var(--mp-radius-sm) - 2px);
  transition: all 0.15s;
  font-family: var(--mp-font-display);
  letter-spacing: -0.01em;
}

.mp-toggle-btn--active {
  background: var(--mp-primary);
  color: #fff;
}

.mp-toggle-btn:focus-visible {
  outline: 2px solid var(--mp-primary);
  outline-offset: 2px;
}
```

Add to `public/css/components.css` — do NOT create a new CSS file. Extend the existing file (Story 8.1 already modified it with banner variants and KPI state modifiers).

### Mechanism Trace

Story 8.3 is a **pure UI / client-state story** — no DB writes, no `transitionCronState`, no `writeAuditEvent`. The mechanism trace section is omitted per template guidance for pure-additive stories.

**Call-chain (read-only):**
1. HTTP GET `/` → `dashboardRoutes` handler
2. Handler queries `sku_channels` for `COUNT(DISTINCT channel_code)` → `channelCount`
3. Handler renders `channel-toggle.eta` with `{ channelCount, activeChannel: 'pt' }` → HTML string
4. Handler calls `reply.view('pages/dashboard.eta', { ..., channelToggle: htmlString, ... })`
5. `dashboard.eta` passes `channelToggle` up to `default.eta` layout → renders in `<%~ it.channelToggle || '' %>` slot
6. Browser loads `public/js/dashboard.js` (deferred) → `initChannelToggle()` reads localStorage, sets active class, wires click handlers
7. On click: updates localStorage + active classes + dispatches `channelchange` CustomEvent

**Tx-topology:** No DB writes. The channel count query is autocommit-per-statement via `req.db.query()` (RLS-aware client, no transaction).

### No Mirakl Endpoints in This Story

Story 8.3 is pure dashboard UI and client JS. No Mirakl API calls. The Mirakl endpoint verification step (Step 5 of story creation workflow) does not apply.

### Previous Story Learnings (Story 8.1 Dev Notes)

**Eta comment syntax:** `<%# -%>` is NOT a silent comment in Eta v4 (outputs bare JS, causes parse error). Use HTML `<!-- -->` comments in template body. All template comments must be HTML comments.

**NODE_ENV=test guard:** `authMiddlewareConditional` throws if bypass fires outside `NODE_ENV=test`. Run tests with `NODE_ENV=test node --test`.

**CSS ownership:** `tokens.css` = tokens only; `layout.css` = layout; `components.css` = components. Channel toggle CSS goes in `components.css`. Do NOT add toggle styles to `tokens.css` or `layout.css`.

**Test injection pattern (from Stories 4.7–8.1):**

```js
const app = await buildApp({ logger: false });
app.addHook('preHandler', async (req) => {
  req.user = { id: 'test-customer-uuid', email: 'test@example.com' };
  req.db = {
    query: async (sql, params) => {
      // Return mock rows for each query
      if (sql.includes('COUNT(DISTINCT')) return { rows: [{ channel_count: 2 }] };
      return { rows: [{ cron_state: 'ACTIVE', anomaly_count: 0, sustained_transient_active: false, ... }] };
    }
  };
});
const response = await app.inject({ method: 'GET', url: '/' });
assert.ok(response.payload.includes('>PT<'), 'PT toggle button present');
```

---

## Project Structure Notes

### Alignment with Unified Project Structure

```
# Files to CREATE:
app/src/views/components/channel-toggle.eta   # New component — PT/ES toggle pill

# Files to EXTEND (do NOT recreate):
app/src/routes/dashboard/index.js             # Add channel count query + channelToggle rendering
public/js/dashboard.js                        # Fill Story 8.3 channel toggle slot
public/css/components.css                     # Add .mp-channel-toggle + .mp-toggle-btn CSS classes

# Test files to FILL (DO NOT recreate — scaffolds exist from Epic-Start):
tests/app/routes/dashboard/channel-toggle.test.js  # 10 scaffold stubs → fill per Tasks 5.x
```

### Detected Conflicts / Variances

1. **Story 8.2 dependency (KPI re-render on toggle):** Story 8.3 dispatches a `channelchange` CustomEvent. Story 8.2's `kpi-cards.eta` is not yet implemented; when it ships, its JS will listen to `channelchange` and re-fetch or show/hide channel-scoped content. Story 8.3 only needs to dispatch the event — no KPI re-render logic here.

2. **`activeChannel` server-side default vs localStorage:** The server always renders with `activeChannel: 'pt'` (default). Client JS immediately overrides to whatever localStorage says. This means the first paint always shows PT active, then flickers to ES if localStorage says ES. This is acceptable at MVP (S-size story, no flash mitigation needed). Document this behavior in Dev Agent Record.

3. **`channelToggle` slot render approach:** The method to render `channel-toggle.eta` to a string and pass it as `channelToggle` to the layout depends on the specific `@fastify/view` + Eta version setup. Read `app/src/server.js` to understand the registered view engine and its options before implementing. An inline Eta `include()` call from within `dashboard.eta` may be simpler than route-level string rendering — choose whatever works without modifying `default.eta`'s structure.

4. **`customer_marketplaces` channel_code:** The `channel_code` values are stored on `sku_channels`, not on `customer_marketplaces`. The count query correctly targets `sku_channels` — verify column names against the DDL in `architecture-distillate/06-database-schema.md` before writing the query. Confirmed channel codes from architecture cross-cutting empirical facts: `WRT_PT_ONLINE` / `WRT_ES_ONLINE`.

---

## References

- [Source: `_bmad-output/planning-artifacts/epics-distillate/05-epic-8-dashboard.md` — Story 8.3 spec]
- [Source: `_bmad-output/planning-artifacts/epics-distillate/_index.md` — UX-DR14 coverage map + FR35]
- [Source: `_bmad-output/planning-artifacts/architecture-distillate/_index.md` — Cross-cutting constraints + Mirakl empirical facts (WRT_PT_ONLINE / WRT_ES_ONLINE)]
- [Source: `_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md` — Naming patterns, CSS ownership, Pattern A/B/C contracts]
- [Source: `_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md` — File locations]
- [Source: `_bmad-output/planning-artifacts/ux-skeleton.md` §4.2.2, §10.1 — Channel toggle behavior + visual DNA carries]
- [Source: `_bmad-output/design-references/bundle/project/MarketPilot.html` lines ~1237-1257 — PT/ES toggle pill visual reference (React JSX → translate to vanilla Eta/CSS)]
- [Source: `_bmad-output/implementation-artifacts/8-1-dashboard-root-state-aware-view-sticky-header-chrome.md` — Story 8.1 Dev Notes + CSS extension patterns + Eta comment syntax warning + test injection pattern]
- [Source: `_bmad-output/implementation-artifacts/epic-8-test-plan.md` — Story 8.3 test scaffold table]

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (Step 1 BAD subagent — story sharding, 2026-05-15)

### Debug Log References

### Completion Notes List

### File List
