-- 면접방 보관처리.
--
-- 전형 종료(closed)는 "이 채용은 이 사람으로 진행하지 않는다"는 결정이고,
-- 체결(signed)은 "계약이 성립했다"는 사실이다. 둘 다 그 방에서 앞으로 무슨
-- 일이 더 일어날 수 있는지를 말한다.
--
-- 보관은 다른 이야기다. 더 일어날 일이 없으니 지금 상태 그대로 잠근다는
-- 뜻이고, 그래서 상태(status)가 아니라 별도의 표시로 둔다. 종료된 방도
-- 체결된 방도 보관할 수 있어야 하는데, status 를 'archived' 로 덮으면 그
-- 방이 종료였는지 체결이었는지가 지워진다. 채용내정 성립 여부를 다투는
-- 자리에서 그 구분이 사라지는 것은 기록을 잃는 것과 같다.
--
-- 보관하면 대화도 계약서 저장도 막힌다. 잠그는 기능이라 누가 언제 잠갔는지
-- 함께 남긴다 -- 자세한 이력은 room_lifecycle_log 에 쌓이지만, 지금 잠겨
-- 있다는 사실과 그 시각은 방을 읽을 때마다 필요하다.
ALTER TABLE interview_rooms ADD COLUMN archived_at TEXT;
ALTER TABLE interview_rooms ADD COLUMN archived_by_name TEXT;

CREATE INDEX idx_rooms_archived ON interview_rooms(archived_at);
