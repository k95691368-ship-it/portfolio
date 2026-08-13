-- 코드만으로 면접방에 들어온 사람의 접속.
--
-- 지원자에게 로그인을 요구하는 것이 실제로는 벽이었다.
--
--   첫 화면은 '회사 = 로그인', '지원자 = 공고 보기'로 나뉜다. 서류합격해서
--   임시 비밀번호를 받은 사람은 '회사' 버튼이 자기 것이 아니라고 여겨 누르지
--   않는다. 그러면 면접방이 만들어져 있어도 들어갈 길이 없다.
--
--   이 앱은 이미 같은 문제를 한 번 풀었다. 지원은 로그인 없이 하고 접수번호로
--   현황을 조회한다. 면접방도 같은 방식으로 연다 — 초대코드로 들어온다.
--
-- 로그인 세션과 같은 표에 두지 않는다. 이것은 계정이 아니라 "이 방 하나에
-- 대한 출입증"이다. 같은 표에 섞으면 어느 코드로 어디까지 할 수 있는지가
-- 흐려지고, 계정 세션에만 걸어 둔 검사가 이쪽에도 걸린 것처럼 보인다.
--
-- 토큰은 해시만 저장한다. 계정 세션과 같은 이유다 — 표가 통째로 유출돼도
-- 남의 방에 들어갈 수는 없어야 한다.
CREATE TABLE room_access_sessions (
  token_hash TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES interview_rooms(id),
  -- 누가 들어왔는지는 코드만으로 알 수 없다. 접속 환경이라도 남겨 두어야
  -- 나중에 "언제 누가 열어 봤는가"를 따질 때 볼 것이 있다.
  entered_ip TEXT,
  entered_user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_room_access_room ON room_access_sessions(room_id);
CREATE INDEX idx_room_access_expires ON room_access_sessions(expires_at);
