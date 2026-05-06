// public/js/onboarding-key.js
//
// Story 4.3 — Client-side behaviour for /onboarding/key.
//
// Responsibilities:
//   1. Enable/disable the "Validar chave" button based on input non-empty state (AC#1)
//   2. Spinner + button label update while POST is in-flight (AC#3)
//   3. "Como gerar a chave?" modal open/close + Escape key handler (AC#5)
//   4. Keyboard focus trap inside modal (NFR-A2)
//
// Constraints (Critical):
//   - No import statements (plain defer script, no bundler)
//   - No framework JS (vanilla DOM only — architecture constraint #3)
//   - No console.log (browser client — console is ok here per ESLint config, but
//     we omit it for cleanliness)
//
// This file runs in the browser context (globals.browser in eslint.config.js).

(function () {
  'use strict';

  // ── DOM references ──────────────────────────────────────────────────────────
  var input = document.querySelector('#shop_api_key');
  var btn = document.querySelector('#validate-btn');
  var form = document.querySelector('#key-form');
  var modal = document.querySelector('#key-help-modal');
  var modalClose = document.querySelector('#key-help-modal-close');
  var modalCloseFooter = document.querySelector('#key-help-modal-close-footer');
  var modalBackdrop = document.querySelector('#key-help-modal-backdrop');
  var modalTrigger = document.querySelector('#open-key-help');

  // ── 1. Enable/disable "Validar chave" button ─────────────────────────────
  if (input && btn) {
    // Initial state: disabled until input has a non-empty value
    btn.disabled = true;

    input.addEventListener('input', function () {
      btn.disabled = input.value.trim().length === 0;
    });
  }

  // ── 2. Spinner + button label on form submit ──────────────────────────────
  if (form && btn) {
    form.addEventListener('submit', function () {
      btn.disabled = true;
      btn.classList.add('mp-btn-loading');
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = 'A validar a tua chave...';
    });
  }

  // ── 3 & 4. Modal open/close + focus trap (NFR-A2) ────────────────────────

  function openModal () {
    if (!modal) return;
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('modal--open');
    // Focus the close button so keyboard users can immediately close
    if (modalClose) {
      modalClose.focus();
    }
    // Prevent body scroll while modal is open
    document.body.style.overflow = 'hidden';
  }

  function closeModal () {
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('modal--open');
    document.body.style.overflow = '';
    // Return focus to the trigger element (NFR-A2)
    if (modalTrigger) {
      modalTrigger.focus();
    }
  }

  if (modalTrigger) {
    modalTrigger.addEventListener('click', function (e) {
      e.preventDefault();
      openModal();
    });
  }

  if (modalClose) {
    modalClose.addEventListener('click', closeModal);
  }

  if (modalCloseFooter) {
    modalCloseFooter.addEventListener('click', closeModal);
  }

  // Close on backdrop click
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', closeModal);
  }

  // Close on Escape key (AC#5)
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal && modal.classList.contains('modal--open')) {
      closeModal();
    }
  });

  // Focus trap inside modal (NFR-A2)
  if (modal) {
    modal.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      if (!modal.classList.contains('modal--open')) return;

      var focusable = modal.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      );
      var focusableArray = Array.prototype.slice.call(focusable);
      if (focusableArray.length === 0) return;

      var first = focusableArray[0];
      var last = focusableArray[focusableArray.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: wrap from first to last
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: wrap from last to first
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }
})();
