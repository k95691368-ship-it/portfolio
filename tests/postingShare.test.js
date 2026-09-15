import { it, expect } from 'vitest'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import { generatePostingQr, postingApplicationUrl } from '../src/lib/postingShare.js'
import { reusablePostingFields } from '../shared/postingReuse.js'

it('decodes the generated PNG back to the exact application URL without tokens', async () => {
  const url = postingApplicationUrl('https://portfolio-epa.pages.dev/?token=not-shared', 'posting-123')
  expect(url).toBe('https://portfolio-epa.pages.dev/jobs/posting-123/apply')
  const image = await generatePostingQr(url)
  const png = PNG.sync.read(Buffer.from(image.split(',')[1], 'base64'))
  expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe(url)
  expect(png.width).toBe(640)
})
it('rejects unsafe origins and path injection', () => {
  expect(() => postingApplicationUrl('javascript:alert(1)', 'abc')).toThrow()
  expect(() => postingApplicationUrl('https://example.invalid', '../../admin?secret=1')).toThrow()
})
it('copies a field allowlist, preserving emoji but excluding identity, deadlines and applicant records', () => {
  const fields = reusablePostingFields({ title: '📋 모집', description: '🎁 혜택\n원문', deadline: '2000-01-01', wage_min: 15000, id: 'old', applicationCount: 9, created_by_user_id: 'private', signatures: ['private'] })
  expect(fields.title).toBe('📋 모집'); expect(fields.description).toBe('🎁 혜택\n원문'); expect(fields.wageMin).toBe('15000')
  expect(fields.deadline).toBe(''); expect(fields).not.toHaveProperty('id'); expect(fields).not.toHaveProperty('signatures')
  expect(fields).not.toHaveProperty('created_by_user_id'); expect(fields).not.toHaveProperty('applicationCount')
})
