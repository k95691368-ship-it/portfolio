import { createPostgresD1 } from '../api/postgresD1.ts'
import { createSupabaseStorage } from '../api/supabaseStorage.ts'
import { handleStorageCleanupJob } from '../../../server/_lib/storageCleanupJob.js'

const deno = (globalThis as typeof globalThis & { Deno: { env: { toObject(): Record<string, string> }, serve(handler: (request: Request) => Promise<Response>): void } }).Deno
const environment = deno.env.toObject()
const env = { ...environment, DB: createPostgresD1(environment.SUPABASE_DB_URL),
  DOCUMENTS: createSupabaseStorage(environment, 'documents'),
  INTERVIEW_RECORDINGS: createSupabaseStorage(environment, 'interview-recordings') }

deno.serve((request: Request) => handleStorageCleanupJob(request, env))
