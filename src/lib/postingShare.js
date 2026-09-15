export function postingApplicationUrl(origin, postingId) {
  const base = new URL(origin)
  if (!['https:', 'http:'].includes(base.protocol) || !/^[a-zA-Z0-9_-]{1,100}$/.test(postingId)) throw new TypeError('공고 주소를 확인해주세요.')
  return `${base.origin}/jobs/${encodeURIComponent(postingId)}/apply`
}

export async function generatePostingQr(url) {
  const { default: QRCode } = await import('qrcode')
  return QRCode.toDataURL(url, { type: 'image/png', width: 640, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
}
