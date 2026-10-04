# 정리 큐 전용 작업자 배포

`storage-cleanup`은 기존 명시적 삭제와 미확정 파일 저장 과정에서 남긴
`storage_cleanup_intents`만 처리한다. 보존 기간에 따른 지원서·녹화 파기,
계정 복구 자료 정리, 이메일 발송, 계약 서명은 실행하지 않는다.
현재 사용 중인 파일은 기존 참조 검사로 보호하고, 아직 유효한 업로드
권한이 있는 파일은 큐의 `not_before`까지 기다린다.

전용 Edge 비밀 `STORAGE_CLEANUP_JOB_SECRET`을 Bearer 인증으로 보내는
`POST`만 허용한다. JSON은 `{"dryRun":true}` 또는 `{"dryRun":false}`만
허용하며, `STORAGE_CLEANUP_EXECUTE`가 정확히 `1`일 때만 실제 삭제가 가능하다.
응답은 객체 경로나 비밀 없이 집계만 반환하고 저장을 금지한다.
한 번에 최대 25개를 처리하며 provider 실패 시 기존 큐와 재시도 시각을 유지한다.

## 적용과 운영 활성화

먼저 `202609260001_storage_cleanup_intents.sql`을 적용하고 작업자를 배포한다.
실행 설정을 활성화하기 전에 인증과 dry-run 집계를 확인한다. Vault 이름
`storage_cleanup_job_secret`과 같은 값의 Edge 비밀은 별도 운영 작업으로 준비한다.
이 문서와 마이그레이션은 비밀을 생성하거나 extension을 설치하지 않는다.

`202610040001_storage_cleanup_schedule.sql`은 cron/net/Vault와 큐가 존재하고
Vault의 전용 비밀 이름까지 있을 때만 매시 23분 예약을 등록한다.
25개/회이므로 하루 최대 600개를 시도한다. 큐가 없는 시간의 호출을 줄이도록
매시간 주기를 선택했으며 backlog가 지속되면 실행 집계와 due 큐 수를 근거로
운영자가 주기·처리 용량을 검토한다. 기존 retention 예약과 실행 설정은 독립이다.
조건이 없으면 SQL은 안전하게 아무 예약도 만들지 않는다. 나중에 조건을 준비해도
이미 완료된 마이그레이션이 자동으로 재실행되지 않으므로 예약 SQL을 별도로 적용한다.

비밀 생성, 예약 활성화, 실제 삭제 실행은 이번 격리 검증 범위에 포함하지 않는다.

## 중단과 복구

이 작업자의 예약을 중단하거나 `STORAGE_CLEANUP_EXECUTE`를 비활성화하면
추가 큐 삭제를 멈출 수 있다. API·작업자 코드를 직전 버전으로 복구하더라도
큐와 사용자 데이터는 보존한다. 이미 provider에서 삭제한 바이트는 코드
복구로 되살릴 수 없으므로 운영 데이터 복원과 구분한다.

## 2026-10-04 릴리스의 백업·점검 조건

대상은 `obumqkwkvnemkyaahjbn` 한 프로젝트다. 백업용 임시 CLI 접속은
생성된 공식 dump plan의 `--role=postgres`와 같은 역할을 명시하며, 연결
비밀번호와 private Storage 키는 프로세스 메모리에서만 다룬다. 다른 CLI DB
명령이 같은 임시 로그인 역할을 갱신할 수 있으므로 백업 중에는 직렬 실행한다.

`PORTFOLIO_MAINTENANCE_MODE=1`은 API의 인증 처리 전 GET/HEAD와 쓰기를
503·`MAINTENANCE`·`Retry-After: 60`으로 막는다. OPTIONS는 유지한다.
읽기에도 세션 갱신·교부 기록이 있을 수 있어 함께 막는다. 이 설정은 retention,
다른 작업자나 이미 발급한 Storage 직접 업로드를 멈추지 않으므로 별도 확인이
필요하다. 유효한 업로드·녹화·방이 있으면 현재의 무활동 백업 절차를 사용하지 않는다.

신규 큐에 의존하는 최신 API를 점검 목적으로 먼저 배포하지 않는다. 운영 API27의
183개 소스 파트가 Git `68793fa8`과 LF 정규화 후 모두 일치하는 것을 확인했다.
그 Git 스냅샷에 점검 게이트만 추가하여 사용하고, 원래 스냅샷을 복구용으로
별도 보존한다. 점검용 패키지는 테스트 자동 탐색 대상인 작업 트리 밖에 둔다.

운영 DB 공개 스키마 덤프의 오프라인 재생은 사전 검사일 뿐 백업 완료가 아니다.
실제 쓰기·업로드·예약 작업의 정지를 확인한 뒤 암호화 아카이브를 생성하고,
최종 manifest·각 바이트의 해시·전체 SQL 재생을 다시 검사해야 복원점으로 인정한다.
계정 세션·일회성 복구 토큰은 복원하지 않는다. migration 적용 이력과 함수별
timezone 설정은 별도 릴리스 기록에 남겨야 한다.

암호화 파일과 키는 Git·OneDrive 밖의 서로 다른, 현재 Windows 사용자와 SYSTEM만
접근 가능한 로컬 디렉터리에 둔다. 키는 Windows 사용자 범위 DPAPI로 보호하고
파일에서 재읽어 복호화할 수 있는지 검사한다. 이것은 같은 Windows 계정/환경의
복구 수단이며 PC 분실·재설치에 대비한 독립 원격 백업이나 휴대 가능한 키 보관을
완료한 것으로 주장하지 않는다. 키를 채팅·로그·Git에 남기지 않는다.

API 정상화 실패 시 우선 점검을 유지하고 원래 API 스냅샷을 배포한 다음 점검
설정을 비활성화한다. 큐·migration 이력·사용자 자료를 삭제해 되돌리지 않는다.
사전 점검에서 다섯 `datetime/date/julianday` 함수의 `proconfig`는 NULL이었다.
이번 timezone 변경만 원복해야 한다면 해당 다섯 시그니처에 `RESET timezone`을
검토하되, 코드 롤백과 데이터 복원은 별개의 작업으로 취급한다.

운영 데이터를 실제로 복원해야 하는 사고에서는 먼저 API와 관련 작업자를 정지하고
새 복원점·사고 이후 변경을 보존한다. 아카이브를 독립 오프라인 DB로 복원하여
피해 범위·행 수·파일 해시를 확인하고, 기존 DB를 통째로 덮어쓰지 않는 대상별 복원
계획을 별도 검토한다. 이 도구는 `public`과 두 private bucket의 내용/설정만
포함한다. Supabase 내부 Auth, role grant, Edge 비밀·설정과 platform schema는
포함하지 않으므로 전체 프로젝트 복제·전체 재해 복구 도구로 사용하지 않는다.

공식 참고: [Supabase Cron](https://supabase.com/docs/guides/cron),
[Edge Functions 예약 호출](https://supabase.com/docs/guides/functions/schedule-functions),
[Vault](https://supabase.com/docs/guides/database/vault).
