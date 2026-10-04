-- Opt-in queue processing only. No extension or credential is created here.
-- Deploy storage-cleanup first, then provision matching Edge
-- STORAGE_CLEANUP_JOB_SECRET and Vault storage_cleanup_job_secret separately.
-- STORAGE_CLEANUP_EXECUTE must equal '1' to allow actual receipt processing.
-- Hourly batches of 25 permit 600 attempts/day without frequent idle requests.
DO $cleanup_schedule$
BEGIN
  IF to_regnamespace('cron') IS NULL
     OR to_regnamespace('net') IS NULL
     OR to_regclass('vault.decrypted_secrets') IS NULL
     OR to_regclass('public.storage_cleanup_intents') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'storage_cleanup_job_secret') THEN
    PERFORM cron.schedule('portfolio-storage-cleanup-hourly', '23 * * * *', $job$
      SELECT net.http_post(
        url := 'https://obumqkwkvnemkyaahjbn.supabase.co/functions/v1/storage-cleanup',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
          'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'storage_cleanup_job_secret' LIMIT 1)),
        body := '{"dryRun": false}'::jsonb,
        timeout_milliseconds := 60000
      );
    $job$);
  END IF;
END
$cleanup_schedule$;
