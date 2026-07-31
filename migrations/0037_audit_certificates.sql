-- 감사추적증명서 발급 이력.
--
-- 지금까지 이 앱이 내보내는 유일한 문서는 계약서 화면을 이미지로 찍어 만든
-- PDF였고, 그 이미지 바이트의 해시를 "문서 무결성 지문"으로 보여 주었다.
-- 래스터 바이트는 기기 픽셀 비율·폰트 대체에 따라 달라지므로 재현할 수 없고,
-- 재현할 수 없는 지문은 무결성을 증명하지 못한다. 정작 재현 가능한 정본 지문
-- (0033의 signatures.document_sha256)은 아무 데로도 내보내지지 않았다.
--
-- 증명서를 발급 시점에 동결해 보관한다. 이후 계약 내용이 바뀌어도 발급된
-- 증명서는 그대로 검증된다.
--
-- canonical_text를 함께 보관하는 이유: 검증을 "저장된 원본 문자열을 다시
-- 해시해 대조"로 하면, 나중에 직렬화 규칙을 바꿔도 옛 증명서가 변조로
-- 뒤집히지 않는다.
CREATE TABLE audit_certificates (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES interview_rooms(id),
  serial TEXT NOT NULL UNIQUE,
  issued_by_user_id TEXT REFERENCES users(id),
  issued_at TEXT NOT NULL,
  document_sha256 TEXT,
  certificate_sha256 TEXT NOT NULL,
  canonical_text TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT
);

CREATE INDEX idx_audit_certificates_room ON audit_certificates(room_id, issued_at DESC);
