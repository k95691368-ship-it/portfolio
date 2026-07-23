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
