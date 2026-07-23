// 첨부파일 검증 공용 유틸 (이력서/포트폴리오/지원서류 등).
export const ALLOWED_UPLOAD_EXT = ['pdf', 'doc', 'docx', 'hwp', 'hwpx']
export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024 // 10MB

const EXT_MIME = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  hwp: 'application/x-hwp',
  hwpx: 'application/haansofthwpx',
}

export function fileExt(name) {
  return (String(name || '').split('.').pop() || '').toLowerCase()
}

export function mimeForExt(ext) {
  return EXT_MIME[ext] || 'application/octet-stream'
}

// 유효하면 null, 아니면 사용자용 오류 메시지를 반환.
export function validateUploadFile(file) {
  if (!file || typeof file === 'string') return '파일을 선택해주세요.'
  if (file.size <= 0) return '빈 파일은 업로드할 수 없습니다.'
  if (file.size > MAX_UPLOAD_SIZE) return '파일 크기는 10MB 이하만 가능합니다.'
  if (!ALLOWED_UPLOAD_EXT.includes(fileExt(file.name))) {
    return 'PDF, DOC, DOCX, HWP 파일만 업로드할 수 있습니다.'
  }
  return null
}

// 확장자별 실제 파일 시그니처(매직바이트). 확장자만 위조한 업로드를 차단한다.
// - PDF: "%PDF"
// - docx/hwpx: ZIP 컨테이너(OOXML/OWPML) → "PK.."
// - doc/hwp(5.x): OLE 복합 문서 → D0CF11E0A1B11AE1
const MAGIC_SIGNATURES = {
  pdf: [[0x25, 0x50, 0x44, 0x46]],
  docx: [
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06],
    [0x50, 0x4b, 0x07, 0x08],
  ],
  hwpx: [
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06],
    [0x50, 0x4b, 0x07, 0x08],
  ],
  doc: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  hwp: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
}

export function matchesSignature(headerBytes, ext) {
  const sigs = MAGIC_SIGNATURES[ext]
  if (!sigs) return true // 알 수 없는 확장자는 앞선 검사에서 이미 차단됨
  return sigs.some((sig) => sig.every((byte, i) => headerBytes[i] === byte))
}

// 파일 앞부분을 읽어 시그니처를 확인. 유효하면 null, 아니면 오류 메시지.
export async function validateFileContent(file) {
  const ext = fileExt(file.name)
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  if (!matchesSignature(header, ext)) {
    return '파일 내용이 형식과 일치하지 않습니다. 올바른 파일인지 확인해주세요.'
  }
  return null
}
