import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { expect, it } from 'vitest'

// The Edge uploader also scans JSDoc imports. TypeScript's virtual .js -> .d.ts
// resolution must not leave a missing physical asset in a deployment graph.
it('Edge mail and rate-limit type imports refer to an existing declaration asset', async () => {
  for (const name of ['emailOutbox.js', 'gmail.js', 'rateLimit.js']) {
    const source = new URL(`../server/_lib/${name}`, import.meta.url)
    const imports = [...(await readFile(source, 'utf8')).matchAll(/import\(['"]([^'"]*typecheck\/[^'"]+)['"]\)/g)]
    expect(imports.length, name).toBeGreaterThan(0)
    for (const [, specifier] of imports) {
      expect(specifier, name).toMatch(/\.d\.ts$/)
      expect(existsSync(new URL(specifier, source)), `${name}: ${specifier}`).toBe(true)
    }
  }
})
