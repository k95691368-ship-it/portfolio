-- 서명 후 계약 내용이 바뀌면 기존 서명을 무효화한다.
--
-- 지금까지 계약 내용을 잠그는 조건은 interview_rooms.status = 'signed' 하나였고,
-- 그 상태는 양측이 모두 서명한 뒤에야 붙었다. 그래서 지원자가 먼저 서명한
-- 상태에서 회사가 기본급과 계약서 본문을 바꾸고 이어서 서명하면, 지원자가 본
-- 적도 없는 조건에 지원자 서명이 붙은 계약이 만들어졌다.
--
-- 증거가 약한 문제가 아니라 서로 합의한 내용이 없는 문제다. 내용이 바뀌면
-- 그 전에 받은 서명은 더 이상 그 내용에 대한 동의가 아니므로 무효로 옮기고,
-- 상대방에게 다시 서명을 받아야 한다. 무효화된 서명도 지우지 않고 남겨,
-- 무엇이 언제 왜 무효가 되었는지 계약 이력으로 증명할 수 있게 한다.
CREATE TABLE signature_revocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES interview_rooms(id),
  signer_role TEXT NOT NULL,
  signer_user_id TEXT REFERENCES users(id),
  signed_at TEXT,
  signer_ip TEXT,
  signer_user_agent TEXT,
  signer_country TEXT,
  revoked_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_by_user_id TEXT REFERENCES users(id),
  reason TEXT NOT NULL
);

CREATE INDEX idx_signature_revocations_room ON signature_revocations(room_id, id);
