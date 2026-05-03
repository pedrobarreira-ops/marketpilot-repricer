// Story 1.4 — recovery-token fragment extractor.
//
// Supabase Auth's password-recovery email link redirects to
// /reset-password#access_token=...&refresh_token=...&type=recovery.
// The server cannot read the URL fragment (it stays client-side), so this
// script extracts the tokens from window.location.hash and injects them
// into the form's hidden inputs before the customer submits the form.

(function () {
  if (typeof window === 'undefined') return;
  var hash = window.location.hash || '';
  if (hash.charAt(0) === '#') hash = hash.slice(1);
  if (!hash) return;
  var params = new URLSearchParams(hash);
  var access = params.get('access_token');
  var refresh = params.get('refresh_token');
  var accessInput = document.getElementById('access_token');
  var refreshInput = document.getElementById('refresh_token');
  if (access && accessInput) accessInput.value = access;
  if (refresh && refreshInput) refreshInput.value = refresh;
  // Clean the URL so the tokens don't sit in browser history.
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch (_e) { /* no-op */ }
})();
