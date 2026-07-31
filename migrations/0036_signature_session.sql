-- 서명을 "인증된 세션과 계정"에 묶는다.
--
-- 0027이 서명 환경(IP·기기·국가)을, 0033이 서명 대상 문서의 지문을 남기게 했지만,
-- 그 서명이 어느 계정으로 어느 로그인 세션에서 이루어졌는지는 어디에도 없었다.
-- 다툼에서 "내가 서명하지 않았다"는 주장이 나오면 접속 환경만으로는 부족하다.
--
-- 소급해 채우지 않는다. 도입 전 서명은 NULL로 남고, 증명서에는 "기록 없음
-- (도입 전 서명)"으로 정직하게 표기한다. 없는 근거를 있는 것처럼 만들지 않는다.
ALTER TABLE signatures ADD COLUMN verified_email TEXT;
ALTER TABLE signatures ADD COLUMN session_started_at TEXT;
-- 'account_password'  : 본인이 정한 비밀번호로 로그인한 세션
-- 'temp_password'     : 관리자가 발급한 임시 비밀번호를 아직 바꾸지 않은 계정
ALTER TABLE signatures ADD COLUMN verification_method TEXT;
