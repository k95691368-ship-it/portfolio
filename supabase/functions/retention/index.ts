import { createPostgresD1 } from '../api/postgresD1.ts'
import { createSupabaseStorage } from '../api/supabaseStorage.ts'
import { runRetention } from '../../../server/_lib/retention.js'

const deno = (globalThis as typeof globalThis & { Deno: { env: { toObject(): Record<string, string> }, serve(handler: (request: Request) => Promise<Response>): void } }).Deno
const environment = deno.env.toObject()
const env = { ...environment, DB: createPostgresD1(environment.SUPABASE_DB_URL),
  DOCUMENTS: createSupabaseStorage(environment, 'documents'),
  INTERVIEW_RECORDINGS: createSupabaseStorage(environment, 'interview-recordings') }

deno.serve(async (request: Request) => {
  // Separate schedule credential; never accepted as an application session.
  if (!environment.RETENTION_JOB_SECRET || request.headers.get('Authorization') !== `Bearer ${environment.RETENTION_JOB_SECRET}`) {
    return new Response(null, { status: 403 })
  }
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  const body = await request.json().catch(() => null)
  if (!body || typeof body.dryRun !== 'boolean') return new Response(null, { status: 400 })
  return Response.json(await runRetention(env, { dryRun: body.dryRun || environment.RETENTION_EXECUTE !== '1' }))
})
