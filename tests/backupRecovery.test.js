// @vitest-environment node
// 아카이브 형식·암호화·안전 검사. 오프라인 복원과 수집 경로는 병렬 실행을 위해 backupRestore·backupTokenReset·backupAcquisition·backupAcquisitionVerify 로 나눴다.
import { expect, it } from 'vitest'
import { readFile, writeFile, lstat, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { encryptionKey, writeArchive, readArchive, verifyBackup, restoreLocal, safeNewTarget, validateObjectName, localRestoreSql } from '../scripts/backup-recovery-lib.mjs'
import { key, sql, pdf, entries, backupWorkspace } from './helpers/backupFixture.js'

const workspace = backupWorkspace()

it('encrypts SQL and object bytes and checks all streamed object checksums', async () => {
  const encrypted = await readFile(workspace.archivePath)
  expect(encrypted.includes(Buffer.from('fixture@example.invalid'))).toBe(false)
  expect(encrypted.includes(pdf)).toBe(false)
  const read = await readArchive({ input: workspace.archivePath, key })
  expect(read.database.equals(sql)).toBe(true)
  expect(read.manifest).toHaveLength(4)
  expect(read.manifest.find((entry) => entry.key === 'documents/지원서/resume.pdf')).toMatchObject({ size: pdf.length,
    sha256: createHash('sha256').update(pdf).digest('hex') })
  expect(await verifyBackup({ input: workspace.archivePath, key })).toEqual({ version: 1, objects: 3, tables: 2, rows: '2' })
}, 30000)

it.each(['wrong-key', 'tampered', 'truncated', 'extra-data', 'bad-length'])('rejects %s without creating recovered files', async (kind) => {
  let bytes = await readFile(workspace.archivePath)
  let usedKey = key
  if (kind === 'wrong-key') usedKey = encryptionKey('cd'.repeat(32))
  if (kind === 'tampered') { bytes = Buffer.from(bytes); bytes[80] ^= 1 }
  if (kind === 'truncated') bytes = bytes.subarray(0, bytes.length - 50)
  if (kind === 'extra-data') bytes = Buffer.concat([bytes, Buffer.alloc(10)])
  if (kind === 'bad-length') { bytes = Buffer.from(bytes); bytes.writeUInt32BE(0xffffffff, 26) }
  const input = workspace.unique(), output = workspace.unique('-recovered')
  await writeFile(input, bytes)
  await expect(restoreLocal({ input, output, key: usedKey, confirmed: true })).rejects.toThrow()
  await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('refuses an archive without a final authenticated manifest', async () => {
  const bytes = await readFile(workspace.archivePath)
  let offset = 26, previous = 26
  while (offset < bytes.length) { previous = offset; offset += 32 + bytes.readUInt32BE(offset) }
  const input = workspace.unique()
  await writeFile(input, bytes.subarray(0, previous))
  await expect(readArchive({ input, key })).rejects.toThrow('Incomplete archive')
})

it('binds encrypted frames to their sequence and rejects reordered chunks', async () => {
  const bytes = await readFile(workspace.archivePath)
  const first = 26, second = first + 32 + bytes.readUInt32BE(first), third = second + 32 + bytes.readUInt32BE(second)
  const input = workspace.unique()
  await writeFile(input, Buffer.concat([bytes.subarray(0, first), bytes.subarray(second, third), bytes.subarray(first, second), bytes.subarray(third)]))
  await expect(readArchive({ input, key })).rejects.toThrow('authentication failed')
})

it.each(['../escape', 'a/../escape', 'a\\escape', '/absolute', 'a//b', 'a\u0000b'])('rejects unsafe object name %j', (name) => {
  expect(() => validateObjectName(name)).toThrow()
})

it('refuses overwrite, working-tree output and unconfirmed restore', async () => {
  await expect(writeArchive({ output: workspace.archivePath, key, metadata: {}, entries: entries() })).rejects.toThrow('already exists')
  await expect(safeNewTarget(join(process.cwd(), 'private.prbk'))).rejects.toThrow('working tree')
  await expect(safeNewTarget('relative.prbk')).rejects.toThrow('absolute')
  await expect(restoreLocal({ input: workspace.archivePath, output: workspace.unique('-recovered'), key })).rejects.toThrow('confirm-local-restore')
})

it('refuses symlinked output parents when supported', async () => {
  const link = workspace.unique('-link')
  try { await symlink(workspace.root, link, process.platform === 'win32' ? 'junction' : 'dir') } catch (error) {
    if (error.code === 'EPERM') return
    throw error
  }
  await expect(safeNewTarget(join(link, 'private.prbk'))).rejects.toThrow('symbolic links')
})

it.each(['missing-db', 'duplicate', 'wrong-size', 'source-failure'])('removes only its partial encrypted output on %s', async (kind) => {
  const output = workspace.unique()
  const source = entries()
  if (kind === 'missing-db') source.shift()
  if (kind === 'duplicate') source.push(source[1])
  if (kind === 'wrong-size') source[1].expectedSize++
  if (kind === 'source-failure') source[1].body = (async function* () { yield pdf; throw new Error('fixture download failed') })()
  await expect(writeArchive({ output, key, metadata: {}, entries: source })).rejects.toThrow()
  await expect(lstat(output)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await readFile(workspace.archivePath)).subarray(0, 10).toString()).toBe('PRBACKUP01')
})

it('preserves SQL-looking applicant text, functions, comments and escape strings while removing only real psql guards', () => {
  const content = String.raw`\restrict Abc123
CREATE SCHEMA public;
INSERT INTO data VALUES ('text
CREATE SCHEMA public;
\restrict UserText
''quote''\');
SELECT $$CREATE SCHEMA public;
\i file$$;
SELECT E'escaped \' still quoted';
-- CREATE SCHEMA public;
/* CREATE SCHEMA public; /* nested */ */
\unrestrict Abc123
`
  const result = localRestoreSql(Buffer.from(content))
  expect(result).toContain('CREATE SCHEMA IF NOT EXISTS public;')
  expect(result).toContain("'text\nCREATE SCHEMA public;\n\\restrict UserText\n''quote''\\'")
  expect(result).toContain('$$CREATE SCHEMA public;\n\\i file$$')
  expect(result).toContain('-- CREATE SCHEMA public;')
  expect(result).not.toContain('\\restrict Abc123')
})

it.each(['\\! command', '\\connect another', '\\i input.sql', 'SELECT 1;\n\\copy data from stdin'])('rejects unsupported psql command %j', (command) => {
  expect(() => localRestoreSql(Buffer.from(command))).toThrow('Unsupported psql commands')
})
