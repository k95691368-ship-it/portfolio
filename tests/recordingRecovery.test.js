import 'fake-indexeddb/auto'
import { describe, it, expect, vi } from 'vitest'
import { beginRecordingBackup, appendRecordingChunk, recoverRecording, removeRecordingBackup } from '../src/features/interview/recordingStore.js'

describe('persistent recording chunks', () => {
  it('purges local backup older than 30 days on the next recovery attempt', async () => {
    const id = crypto.randomUUID()
    await beginRecordingBackup(id, 'owner', 'session', 'video/webm')
    await appendRecordingChunk(id, 0, new Blob(['expired']))
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 86400000)
    try { expect(await recoverRecording(id, 'owner', 'session')).toBeNull() }
    finally { clock.mockRestore() }
    expect(await recoverRecording(id, 'owner', 'session')).toBeNull()
  })
  it('recovers ordered bytes after reopening storage, verifies hash, isolates owner/session and removes acknowledged backup', async () => {
    const id = crypto.randomUUID()
    await beginRecordingBackup(id, 'owner', 'session', 'video/webm')
    await appendRecordingChunk(id, 0, new Blob(['abc']))
    await appendRecordingChunk(id, 1, new Blob(['def']))
    expect(await recoverRecording(id, 'other', 'session')).toBeNull()
    expect(await recoverRecording(id, 'owner', 'other')).toBeNull()
    const restored = await recoverRecording(id, 'owner', 'session')
    expect(await restored.blob.text()).toBe('abcdef')
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('abcdef'))
    expect(restored.sha256).toBe(Buffer.from(digest).toString('hex'))
    await removeRecordingBackup(id)
    expect(await recoverRecording(id, 'owner', 'session')).toBeNull()
  })
})
