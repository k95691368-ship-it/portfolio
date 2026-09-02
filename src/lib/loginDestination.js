export function loginDestination(search) {
  const requested = new URLSearchParams(search).get('next')
  return /^\/rooms\/[^/?#]+\/interview\/[^/?#]+$/.test(requested || '')
    ? requested
    : '/dashboard'
}

export function requiresFreshDocument(pathname) {
  return /^\/rooms\/[^/?#]+\/interview\/[^/?#]+$/.test(String(pathname || ''))
}
