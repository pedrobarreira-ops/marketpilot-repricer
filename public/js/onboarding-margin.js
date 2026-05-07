// public/js/onboarding-margin.js
//
// Story 4.8 — Margin band picker client-side logic.
//
// Responsibilities (per Dev Notes F9 pattern — vanilla IIFE, no bundler):
//   1. Listen to `change` events on the 4 radio inputs (name="band")
//   2. When `under_5` selected:
//      - Show `.mp-thin-margin-callout` (remove display:none)
//      - Disable submit button until "Compreendo e continuo" is clicked
//   3. When other band selected:
//      - Hide `.mp-thin-margin-callout`
//      - Clear acknowledge hidden field value
//      - Enable submit button (a band is now selected)
//   4. "Compreendo e continuo" click:
//      - Set hidden input `acknowledge` to 'true'
//      - Enable submit button
//
// Progressive enhancement: submit button starts HTML-disabled; form is
// still submittable without JS (server validates band + acknowledge server-side).

(function () {
  'use strict';

  const radios = document.querySelectorAll('input[type="radio"][name="band"]');
  const callout = document.getElementById('thin-margin-callout');
  const acknowledgeField = document.getElementById('acknowledge-field');
  const submitBtn = document.getElementById('margin-submit');
  const acknowledgeBtn = document.getElementById('acknowledge-btn');

  if (!radios.length || !callout || !acknowledgeField || !submitBtn || !acknowledgeBtn) {
    // Elements not found — page may be in an unexpected state; do nothing.
    return;
  }

  /**
   * Handle radio change: show/hide callout, manage submit state.
   *
   * @param {Event} event - change event from a band radio input
   */
  function onBandChange (event) {
    const selectedBand = event.target.value;

    if (selectedBand === 'under_5') {
      // Show the thin-margin warning callout
      callout.style.display = '';
      // Clear any previous acknowledgement and disable submit until confirmed
      acknowledgeField.value = '';
      submitBtn.disabled = true;
    } else {
      // Hide callout and clear acknowledgement when another band is picked
      callout.style.display = 'none';
      acknowledgeField.value = '';
      // Enable submit — a valid non-under_5 band is selected
      submitBtn.disabled = false;
    }
  }

  /**
   * Handle "Compreendo e continuo" click: set acknowledge and enable submit.
   */
  function onAcknowledge () {
    acknowledgeField.value = 'true';
    submitBtn.disabled = false;
  }

  // Attach listeners
  radios.forEach(function (radio) {
    radio.addEventListener('change', onBandChange);
  });

  acknowledgeBtn.addEventListener('click', onAcknowledge);
}());
