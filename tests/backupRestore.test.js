// @vitest-environment node
// 실제 오프라인 PostgreSQL 복원(PGlite). 병렬 실행을 위해 backupRecovery.test.js 에서 나눴다.
import { expect, it } from 'vitest'
import { readFile, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { writeArchive, restoreLocal } from '../scripts/backup-recovery-lib.mjs'
import { key, entries, backupWorkspace } from './helpers/backupFixture.js'

const workspace = backupWorkspace()

it('restores the actual offline PostgreSQL database plus PDF, video and empty object byte-for-byte', async () => {
  const output = workspace.unique('-recovered')
  await expect(restoreLocal({ input: workspace.archivePath, output, key, confirmed: true })).resolves.toMatchObject({ tables: 2, objects: 3 })
  const manifest = JSON.parse(await readFile(join(output, 'recovery-manifest.json'), 'utf8'))
  const recovered = new PGlite({ loadDataDir: new Blob([await readFile(join(output, manifest.database))]) })
  try {
    expect((await recovered.query('SELECT applicant_email, answers, sequence::text FROM public.applications')).rows)
      .toEqual([{ applicant_email: 'fixture@example.invalid', answers: { 한글: '답변' }, sequence: '9007199254740993' }])
    expect((await recovered.query('SELECT storage_key FROM public.documents')).rows).toEqual([{ storage_key: '지원서/resume.pdf' }])
    expect((await recovered.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.applications'::regclass")).rows[0].relrowsecurity).toBe(true)
    for (const original of entries().filter((entry) => entry.kind === 'object')) {
      const record = manifest.objects.find((entry) => entry.bucket === original.bucket && entry.name === original.name)
      const bytes = await readFile(join(output, record.file))
      // Native byte comparison avoids walking every index of a large recording
      // in the test framework while still checking its length and every byte.
      expect(bytes.equals(original.body)).toBe(true)
    }
  } finally { await recovered.close() }
}, 30000)

it('rejects unsupported SQL before creating any recovery directory and does not disclose SQL content', async () => {
  const input = workspace.unique(), output = workspace.unique('-recovered')
  await writeArchive({ output: input, key, metadata: {}, entries: [{ kind: 'database', name: 'database.sql',
    body: Buffer.from("SELECT 'sensitive-fixture' FROM missing_table;") }] })
  await expect(restoreLocal({ input, output, key, confirmed: true })).rejects.toThrow('Offline PostgreSQL restore failed')
  await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' })
}, 30000)
