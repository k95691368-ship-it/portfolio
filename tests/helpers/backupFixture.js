import { afterAll, beforeAll } from 'vitest'
import { mkdtemp, readdir, lstat, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { encryptionKey, writeArchive } from '../../scripts/backup-recovery-lib.mjs'

// 백업·복구 테스트가 함께 쓰는 준비물. 오프라인 복원(PGlite)이 테스트마다 수 초씩 걸려
// 한 파일에서 차례로 돌면 전체 테스트 시간을 혼자 붙잡았다. 여러 파일로 나눠 병렬로
// 돌리기 위해 backupRecovery.test.js 에서 옮겨 왔다. 내용은 그대로다.
export const key = encryptionKey('ab'.repeat(32))
export const sql = Buffer.from(`-- pg_dump-shaped public schema fixture
\\restrict Abc123
CREATE SCHEMA public;
CREATE TABLE public.applications (id text PRIMARY KEY, applicant_email text NOT NULL, answers jsonb, sequence bigint);
CREATE TABLE public.documents (id text PRIMARY KEY, application_id text REFERENCES public.applications(id), storage_key text NOT NULL);
INSERT INTO public.applications VALUES ('application-1','fixture@example.invalid','{"한글":"답변"}',9007199254740993);
INSERT INTO public.documents VALUES ('document-1','application-1','지원서/resume.pdf');
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
\\unrestrict Abc123
`)
export const pdf = Buffer.from('%PDF-1.7\nfixture file\n한글\u0000binary')
export const video = Buffer.alloc(300000, 43)
export const entries = () => [
  { kind: 'database', name: 'database.sql', body: sql },
  { kind: 'object', bucket: 'documents', name: '지원서/resume.pdf', contentType: 'application/pdf', expectedSize: pdf.length, body: pdf },
  { kind: 'object', bucket: 'interview-recordings', name: 'rooms/recording.webm', contentType: 'video/webm', expectedSize: video.length, body: video },
  { kind: 'object', bucket: 'documents', name: 'zero.txt', contentType: 'text/plain', expectedSize: 0, body: Buffer.alloc(0) },
]

export const env = { BACKUP_ENCRYPTION_KEY: 'ab'.repeat(32), SUPABASE_URL: 'https://fixtureproject.supabase.co',
  SUPABASE_DB_URL: 'postgresql://postgres:fixture-password@db.fixtureproject.supabase.co:5432/postgres', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-only' }

// 테스트 파일마다 자기만의 임시 폴더와 암호화된 기준 백업을 만들고, 끝나면 그 폴더만 지운다.
export function backupWorkspace() {
  const workspace = { root: null, archivePath: null, sequence: 0 }
  workspace.unique = (suffix = '.prbk') => join(workspace.root, `fixture-${++workspace.sequence}${suffix}`)
  beforeAll(async () => {
    workspace.root = await mkdtemp(join(tmpdir(), 'portfolio-backup-test-'))
    workspace.archivePath = workspace.unique()
    await writeArchive({ output: workspace.archivePath, key, metadata: { project: 'fixture' }, entries: entries() })
  })
  afterAll(async () => {
    // Only remove files under this test-created, resolved temporary directory.
    const allowed = resolve(workspace.root)
    const cleanup = async (path) => {
      const rel = relative(allowed, resolve(path))
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Unsafe cleanup target')
      const stat = await lstat(path)
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        for (const name of await readdir(path)) await cleanup(join(path, name))
        await rmdir(path)
      } else await unlink(path)
    }
    if (!allowed.startsWith(resolve(tmpdir())) || !allowed.includes('portfolio-backup-test-')) throw new Error('Unsafe test root')
    await cleanup(allowed)
  })
  return workspace
}
