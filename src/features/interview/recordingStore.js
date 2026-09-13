import { sha256 } from '@noble/hashes/sha2.js'

const DATABASE = 'portfolio-interview-recordings'
function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('meta', { keyPath: 'id' })
      request.result.createObjectStore('chunks', { keyPath: ['id', 'index'] })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('브라우저 녹화 저장소를 열지 못했습니다.'))
  })
}
async function transaction(stores, operation, mode = 'readwrite') {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode)
      let result
      tx.oncomplete = () => resolve(result)
      tx.onerror = tx.onabort = () => reject(new Error('녹화 저장 공간이 부족하거나 저장이 중단되었습니다.'))
      operation(tx, (value) => { result = value })
    })
  } finally { db.close() }
}
async function pruneExpiredBackups() {
  const cutoff = Date.now() - 30 * 86400000
  return transaction(['meta', 'chunks'], (tx) => {
    const cursor = tx.objectStore('meta').openCursor()
    cursor.onsuccess = () => {
      const row = cursor.result
      if (!row) return
      if (row.value.lastAt <= cutoff) {
        tx.objectStore('chunks').delete(IDBKeyRange.bound([row.value.id, 0], [row.value.id, Number.MAX_SAFE_INTEGER]))
        row.delete()
      }
      row.continue()
    }
  })
}
export async function beginRecordingBackup(id, owner, sessionId, mime) {
  await pruneExpiredBackups()
  return transaction(['meta'], (tx) => tx.objectStore('meta').add({ id, owner, sessionId, mime, startedAt: Date.now(), lastAt: Date.now() }))
}
export function appendRecordingChunk(id, index, blob) {
  return transaction(['chunks', 'meta'], (tx) => {
    tx.objectStore('chunks').put({ id, index, blob })
    const request = tx.objectStore('meta').get(id)
    request.onsuccess = () => { if (request.result) tx.objectStore('meta').put({ ...request.result, lastAt: Date.now() }) }
  })
}
export async function hashRecordingBlob(blob) {
  const hash = sha256.create()
  for (let offset = 0; offset < blob.size; offset += 1024 * 1024) hash.update(new Uint8Array(await blob.slice(offset, offset + 1024 * 1024).arrayBuffer()))
  return [...hash.digest()].map((b) => b.toString(16).padStart(2, '0')).join('')
}
export async function recoverRecording(id, owner, sessionId) {
  await pruneExpiredBackups()
  const meta = await transaction(['meta'], (tx, done) => { const r = tx.objectStore('meta').get(id); r.onsuccess = () => done(r.result) }, 'readonly')
  if (!meta || meta.owner !== owner || meta.sessionId !== sessionId) return null
  const chunks = await transaction(['chunks'], (tx, done) => {
    const r = tx.objectStore('chunks').getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]))
    r.onsuccess = () => done(r.result.map((row) => row.blob))
  }, 'readonly')
  if (!chunks.length) return null
  const blob = new Blob(chunks, { type: meta.mime })
  return { blob, sha256: await hashRecordingBlob(blob), sizeBytes: blob.size, durationSeconds: Math.max(0, Math.round((meta.lastAt - meta.startedAt) / 1000)), recordingId: id }
}
export function removeRecordingBackup(id) {
  return transaction(['meta', 'chunks'], (tx) => {
    tx.objectStore('meta').delete(id)
    tx.objectStore('chunks').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]))
  })
}
