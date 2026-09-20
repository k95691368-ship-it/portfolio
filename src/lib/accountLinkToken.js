// Keep email capabilities only in this page's memory. Remove the fragment before
// submitting anything; React StrictMode may initialize the page twice.
let remembered = null
export function readAccountLinkToken() {
  const { pathname, hash } = window.location
  if (!['/verify-email', '/reset-password'].includes(pathname)) return ''
  if (hash) {
    const token = new URLSearchParams(hash.slice(1)).get('token') || ''
    remembered = { pathname, token: /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '' }
    window.history.replaceState(window.history.state, '', pathname)
  }
  return remembered?.pathname === pathname ? remembered.token : ''
}
export function forgetAccountLinkToken() { remembered = null }
