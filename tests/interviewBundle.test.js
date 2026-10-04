import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { hashRecordingBlob } from '../src/features/interview/recordingStore.js'

// 녹화 업로드(tus)와 녹화 해시(@noble/hashes)는 녹화를 끝낸 사람만 쓴다.
// 정적으로 import 하면 면접 화면을 여는 모든 사람의 첫 묶음에 약 65KB(gzip 18KB)가 더 붙는다.
const read = (...parts) => readFileSync(join(process.cwd(), ...parts), 'utf8')

it('면접 화면은 녹화 업로드·해시 라이브러리를 필요할 때 불러온다', () => {
  const interview = read('src', 'features', 'interview', 'RealtimeInterview.jsx')
  const store = read('src', 'features', 'interview', 'recordingStore.js')
  for (const source of [interview, store]) {
    expect(source).not.toMatch(/^import[^\n]*['"](tus-js-client|@noble\/hashes[^'"]*)['"]/m)
  }
  expect(interview).toContain("import('tus-js-client')")
  expect(store).toContain("import('@noble/hashes/sha2.js')")
})

it('지연 로딩한 해시도 1MB 단위로 나눠 읽은 녹화의 SHA-256과 같다', async () => {
  const bytes = new Uint8Array(2.5 * 1024 * 1024).map((_, index) => index * 31)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  expect(await hashRecordingBlob(new Blob([bytes]))).toBe(Buffer.from(digest).toString('hex'))
})
