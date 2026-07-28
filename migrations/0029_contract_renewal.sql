-- 갱신 계약을 이전 계약과 연결한다.
--
-- 기간제법 제4조의 2년 상한은 "하나의 계약"이 아니라 계속근로기간으로 따진다.
-- 그런데 지금까지는 계약 하나만 보고 2년 초과를 판정했기 때문에, 1년짜리
-- 계약을 세 번 갱신해 3년을 일한 근로자는 아무 경고 없이 지나갔다. 실제로
-- 문제가 되는 것은 이 반복 갱신 쪽이다.
--
-- 계약(면접방)끼리 앞뒤를 이어 두면 계속근로기간을 합산해 판정할 수 있다.
ALTER TABLE contract_terms ADD COLUMN previous_room_id TEXT REFERENCES interview_rooms(id);

CREATE INDEX idx_contract_terms_previous ON contract_terms(previous_room_id);
