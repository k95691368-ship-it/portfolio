-- 전형을 왜 종료했는지 남긴다.
--
-- interview_rooms 에는 처음부터 status 'closed' 와 closed_at 이 정의돼 있었지만
-- 어디서도 쓰이지 않았다. 이제 방을 닫을 수 있게 하면서, 닫은 이유를 함께 남긴다.
--
-- 이유가 없으면 지원자는 "종료됨"이라는 상태만 보게 된다. 다른 사람이 뽑혀서인지,
-- 채용 자체가 취소된 것인지, 조건이 안 맞아서인지는 지원자에게 전혀 다른 의미다.
-- 채용절차법 제10조도 구직자에게 채용 여부를 알리도록 한다.
ALTER TABLE interview_rooms ADD COLUMN close_reason TEXT;
