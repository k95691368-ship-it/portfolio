import { expect, it } from 'vitest'
import config from '../vite.config.js'

it('preloads the emitted Korean font without introducing literal escape text into HTML', () => {
  const font = { type: 'asset', fileName: 'assets/SUIT-Variable-abc.woff2' }
  const html = { type: 'asset', fileName: 'index.html', source: '<html><head></head><body></body></html>' }
  config.plugins.find((p) => p.name === 'fast-first-paint').generateBundle({}, { font, html })
  expect(html.source).toContain('<link rel="preload" as="font" type="font/woff2" crossorigin href="/assets/SUIT-Variable-abc.woff2">')
  expect(html.source).not.toContain('\\n')
})
