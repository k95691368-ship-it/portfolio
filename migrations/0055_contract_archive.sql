-- 체결된 근로계약서의 영구 보관소.
--
-- 지금까지 계약서는 면접방에 매달려 있었다. 방을 지우면 계약 조건도, 서명도,
-- 증명서도, R2 에 올린 PDF 도 함께 사라졌다. 삭제 앞에 "보존 의무가 남아
-- 있습니다" 라는 확인 한 단계가 있었지만, 확인하면 그대로 지워졌다.
--
-- 그런데 근로기준법 제42조와 시행령 제22조 제2항은 근로계약서를 근로관계가
-- 끝난 날부터 3년간 보존하라고 한다. 보존 의무의 대상은 '면접방' 이 아니라
-- '계약서' 다. 방은 대화하던 자리일 뿐이고, 계약서는 그 자리가 없어져도
-- 남아 있어야 하는 것이다.
--
-- 그래서 방과 끊어 낸다.
--
-- room_id 에 외래키를 걸지 않는다. 일부러다. 외래키를 걸면 방을 지울 때
-- 이 표도 함께 지워야 하고(그러면 보관이 아니다), 지우지 않으면 삭제 자체가
-- 실패한다. 어느 쪽도 답이 아니다. room_id 는 "어느 방에서 나온 계약인가" 를
-- 적어 두는 기록일 뿐, 그 방이 살아 있어야 한다는 뜻이 아니다.
--
-- 같은 이유로 사람도 참조하지 않고 이름과 이메일을 그대로 적어 둔다. 계정이
-- 지워져도 "누가 누구와 맺은 계약인가" 는 남아야 한다.
CREATE TABLE contract_archive (
  id TEXT PRIMARY KEY,
  -- 어느 방에서 나왔는가. 외래키가 아니다(위 설명).
  room_id TEXT NOT NULL UNIQUE,
  room_title TEXT,

  -- 당사자. 계정이 사라져도 남는다.
  employer_name TEXT,
  employer_user_id TEXT,
  employee_name TEXT,
  employee_user_id TEXT,
  employee_email TEXT,

  -- 보존 기간을 계산하는 데 필요한 날짜들.
  contract_start_date TEXT,
  contract_end_date TEXT,
  employment_ended_at TEXT,
  signed_at TEXT,
  -- 보존 만료일. 근로관계가 끝난 날부터 3년. 끝나지 않았으면 NULL.
  retention_until TEXT,

  -- 계약 내용 전체와 서명. 다시 만들어 낼 수 있을 만큼 통째로 담는다.
  terms_json TEXT NOT NULL,
  signatures_json TEXT NOT NULL,
  -- 서명 시점에 계산한 계약 내용 지문. 서명 행에 남은 것과 같아야 한다.
  fingerprint TEXT,
  certificate_serial TEXT,

  -- R2 에 저장한 정본. 방을 지워도 이 파일은 지우지 않는다.
  document_key TEXT NOT NULL,
  document_sha256 TEXT NOT NULL,
  document_bytes INTEGER NOT NULL,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- 원본 면접방이 삭제된 시각. 계약서는 남고 방만 사라졌다는 표시.
  source_deleted_at TEXT
);

CREATE INDEX idx_contract_archive_signed ON contract_archive(signed_at DESC);
CREATE INDEX idx_contract_archive_employee ON contract_archive(employee_user_id);
