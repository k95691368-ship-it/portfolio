-- 한 계약의 갱신은 하나뿐이다.
--
-- 두 계약이 같은 계약을 이전 계약으로 삼으면 계속근로기간이 두 갈래로 갈라져
-- 어느 쪽도 사실이 아니게 된다. 기간제 2년 상한 판정이 갈라지므로, 어느 쪽을
-- 보느냐에 따라 같은 근로자가 무기계약 전환 대상이 되기도 하고 아니기도 한다.
--
-- 코드에서는 SELECT 로 확인한 뒤 INSERT 하고 있었다. D1 에는 트랜잭션이 없어
-- 두 요청이 동시에 오면 둘 다 "아직 없다"를 보고 둘 다 쓴다. 확인을 DB 에
-- 맡긴다.
--
-- NULL 은 여럿이어도 된다 — 이전 계약이 없는 방이 대부분이다.
CREATE UNIQUE INDEX idx_contract_terms_previous_unique
  ON contract_terms(previous_room_id)
  WHERE previous_room_id IS NOT NULL;
