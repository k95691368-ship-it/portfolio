-- 서명을 서명 대상 문서에 묶는다.
--
-- 전자서명이 "이 문서에 서명했다"를 뜻하려면 서명과 문서가 연결돼 있어야 한다.
-- 그런데 signatures 에는 서명 그림과 접속 흔적(IP·기기·국가)만 있고 어떤 내용에
-- 붙었는지가 없었다. 다툼이 생겨 "나는 그 조건에 동의하지 않았다"는 주장이
-- 나오면, 서명 데이터만으로는 무엇에 동의한 것인지 특정할 수 없었다.
--
-- 존재하는 유일한 지문은 서명이 다 끝난 뒤 회사가 올린 PDF 바이트에 대한
-- signed_contracts.sha256_hash 인데, 서명 행과 연결되지 않고 시점도 늦고
-- 회사가 버튼을 눌러야 생긴다.
--
-- 서명하는 순간 계약 내용의 지문을 계산해 서명과 함께 남긴다.
ALTER TABLE signatures ADD COLUMN document_sha256 TEXT;

-- 무효화된 서명에도 무엇에 붙어 있었는지를 남긴다.
ALTER TABLE signature_revocations ADD COLUMN document_sha256 TEXT;
