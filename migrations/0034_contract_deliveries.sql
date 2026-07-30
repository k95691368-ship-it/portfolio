-- 근로계약서 교부 이력.
--
-- 근로기준법 제17조 제2항은 사용자가 근로계약서를 근로자에게 교부하도록 하고,
-- 위반은 제114조 벌금 대상이다. 그런데 이 앱에서 교부는 회사가 계약서 화면에서
-- 버튼을 한 번 누르는 데 달려 있었다. 누르지 않으면 계약은 'signed'로 끝나지만
-- 교부물이 아예 없고, 근로자에게 가는 것은 "계약서를 확인해보세요"라는 인앱
-- 알림 하나뿐이었다.
--
-- 받은 기록도 없었다. signed_contracts 에는 수신자 컬럼이 없고(최종합격 이메일
-- 표에는 recipient_email 이 있는데 계약서 쪽에만 없다) 다운로드 로그도 남지
-- 않아, 전자문서법 제5조가 요구하는 수신자·수신일시 보존이 함께 깨졌다.
--
-- 교부를 별도 표로 분리한 이유: PDF를 다시 저장하면 signed_contracts 의
-- emailed_at 이 NULL 로 리셋되어 교부 이력이 지워졌다. 교부는 한 번 일어난
-- 사실이므로 문서 저장과 생애주기를 분리한다.
CREATE TABLE contract_deliveries (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES interview_rooms(id),
  recipient_user_id TEXT REFERENCES users(id),
  -- in_app: 체결 즉시 서버가 만드는 열람 가능 상태
  -- email: 이메일 발송
  -- download: 근로자가 직접 내려받음
  -- paper: 전자 수신을 원하지 않는 근로자에게 인쇄해 교부
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'download', 'paper')),
  recipient_address TEXT,
  status TEXT NOT NULL DEFAULT 'delivered',
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  delivered_at TEXT NOT NULL DEFAULT (datetime('now')),
  first_viewed_at TEXT,
  downloaded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_contract_deliveries_room ON contract_deliveries(room_id, id);
-- 채널마다 한 행만 두어, 같은 채널의 교부가 중복으로 쌓이지 않게 한다.
CREATE UNIQUE INDEX idx_contract_deliveries_room_channel
  ON contract_deliveries(room_id, channel);
