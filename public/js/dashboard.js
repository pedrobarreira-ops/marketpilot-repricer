// public/js/dashboard.js — Story 8.1 scaffold
//
// Per-page vanilla script loaded deferred near </body> (F9: no bundler).
// Story 8.3 populates the channel toggle state management slot below.
// Story 8.5 populates the pause/resume slot.
// Story 8.6 populates the Go-Live modal slot.
//
// Do NOT use type="module" or import statements — loaded as a classic script.
// Do NOT use console.log — UI-side script has no pino; use no logging at MVP.

// ── Channel toggle slot (Story 8.3) ─────────────────────────────────────────

(function initChannelToggle() {
  var STORAGE_KEY = 'mp_channel';
  var DEFAULT_CHANNEL = 'pt';

  var toggleBtns = document.querySelectorAll('.mp-channel-toggle .mp-toggle-btn');
  if (!toggleBtns.length) return; // single-channel: toggle not rendered (AC#4)

  function getActiveChannel() {
    var stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'pt' || stored === 'es' ? stored : DEFAULT_CHANNEL;
  }

  function setActiveChannel(channel) {
    localStorage.setItem(STORAGE_KEY, channel);
    toggleBtns.forEach(function(btn) {
      var isActive = btn.dataset.channel === channel;
      btn.classList.toggle('mp-toggle-btn--active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    // Notify interested sections (KPI cards Story 8.2, margin editor Story 8.4, audit preview)
    document.dispatchEvent(new CustomEvent('channelchange', { detail: { channel: channel } }));
  }

  // Initialize from localStorage (or default 'pt' on first load)
  setActiveChannel(getActiveChannel());

  // Wire click handlers
  toggleBtns.forEach(function(btn) {
    btn.addEventListener('click', function() { setActiveChannel(btn.dataset.channel); });
  });
})();

// ── Pause/Resume slot (Story 8.5) ───────────────────────────────────────────
// Story 8.5 will wire the pause/resume button interactions here.

// ── Go-Live modal slot (Story 8.6) ──────────────────────────────────────────
// Story 8.6 will wire the "Ir live →" button to the go-live modal.

// Dashboard JS loaded successfully.
