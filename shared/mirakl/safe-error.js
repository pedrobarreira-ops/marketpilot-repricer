// shared/mirakl/safe-error.js — AD5 SSoT (Story 3.1)
//
// Single source of truth for PT-localized customer-facing Mirakl error messages.
// NEVER exposes raw upstream error text, API response content, or apiKey.
// All Mirakl error-to-UI-message mapping flows through getSafeErrorMessage().

/**
 * Map any Mirakl error to a safe Portuguese user-facing message.
 * Never exposes raw error text, API response content, or apiKey.
 *
 * @param {{ status?: number }} err - A MiraklApiError or any object with a .status field
 * @returns {string} PT-localized user-facing message safe for display in UI banners
 */
export function getSafeErrorMessage (err) {
  const status = err?.status;

  if (status === 401) {
    return 'A chave Worten é inválida. Verifica a chave e tenta novamente.';
  }
  if (status === 429 || (typeof status === 'number' && status >= 500)) {
    return 'O Worten está temporariamente indisponível. Vamos tentar novamente em breve.';
  }
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return 'Pedido recusado pelo Worten. Contacta o suporte se persistir.';
  }
  // Transport errors (status 0) or unknown
  return 'O Worten está temporariamente indisponível. Vamos tentar novamente em breve.';
}
