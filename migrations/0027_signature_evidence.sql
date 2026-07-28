-- 서명 증거 정보.
--
-- 지금 서명은 그림 한 장일 뿐이라 "누가 언제" 이상을 증명하지 못한다.
-- 실제 전자계약 서비스의 감사추적증명서는 서명이 이루어진 접속 환경(IP·기기)을
-- 함께 기록해 사후 분쟁에서 증거로 쓴다. 같은 수준의 기록을 남긴다.
ALTER TABLE signatures ADD COLUMN signer_ip TEXT;
ALTER TABLE signatures ADD COLUMN signer_user_agent TEXT;
ALTER TABLE signatures ADD COLUMN signer_country TEXT;
