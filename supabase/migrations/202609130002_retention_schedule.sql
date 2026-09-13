-- Activation is opt-in: deploy the retention function, create the Vault secret
-- retention_job_secret, and set its matching Edge secret RETENTION_JOB_SECRET.
-- The Edge function still stays dry-run unless RETENTION_EXECUTE=1 is approved.
DO $schedule$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL
     AND to_regnamespace('net') IS NOT NULL
     AND to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'retention_job_secret') THEN
      PERFORM cron.schedule('portfolio-retention-hourly', '17 * * * *', $job$
        SELECT net.http_post(
          url := 'https://obumqkwkvnemkyaahjbn.supabase.co/functions/v1/retention',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
            'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'retention_job_secret' LIMIT 1)),
          body := '{"dryRun": false}'::jsonb,
          timeout_milliseconds := 60000
        );
      $job$);
    END IF;
  END IF;
END
$schedule$;
