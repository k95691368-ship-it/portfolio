// Compile-only consumer checks. Invalid calls must keep failing so broadening a
// boundary to `any` cannot silently turn the incremental gate into a no-op.
import { withRequestDeadline } from '../src/api/requestDeadline.js'
import { boundedRequest, RequestBodyError } from '../server/_lib/requestBody.js'
import { contentDisposition, jsonError, jsonResponse } from '../server/_lib/http.js'
import { EmailDeliveryError, isGmailConfigured, sendGmailEmail } from '../server/_lib/gmail.js'
import { sendTrackedEmail } from '../server/_lib/emailOutbox.js'
import { checkRateLimit } from '../server/_lib/rateLimit.js'
import type { EmailMessage, MailEnvironment, TrackedMailEnvironment } from './core.js'

declare const environment: TrackedMailEnvironment
declare const mailEnvironment: MailEnvironment
declare const message: EmailMessage

const result: Promise<number> = withRequestDeadline(async (signal) => {
  signal.throwIfAborted()
  return 42
}, { signal: new AbortController().signal, timeoutMs: 1000 })
void result

// @ts-expect-error Request deadlines require numeric milliseconds.
withRequestDeadline(async () => 42, { timeoutMs: '1000' })
// @ts-expect-error The operation result must retain its type through the race.
const wrongResult: Promise<string> = withRequestDeadline(async () => 42)
void wrongResult
// @ts-expect-error A bounded body needs the complete Request interface.
boundedRequest({ url: 'https://example.invalid/api/login' })
boundedRequest(new Request('https://example.invalid/api/login')) satisfies Promise<Request>
new RequestBodyError(413, 'Too large').status satisfies number
// @ts-expect-error HTTP errors use numeric status codes.
jsonError('Failure', '500')
// @ts-expect-error Header values must be strings.
jsonResponse({ ok: true }, 200, { 'X-App-Request': 1 })
// @ts-expect-error Only file response dispositions are accepted.
contentDisposition('contract.pdf', 'form-data')

new EmailDeliveryError('Uncertain acceptance', 'unknown')
// @ts-expect-error Provider acceptance is not a delivery failure state.
new EmailDeliveryError('Accepted', 'accepted')
// @ts-expect-error Required message fields cannot be missing.
sendGmailEmail(mailEnvironment, { to: 'recipient@example.invalid' })
// @ts-expect-error An attachment requires base64 content, not raw bytes.
sendGmailEmail(mailEnvironment, { ...message, attachments: [{ filename: 'contract.pdf', contentBase64: new Uint8Array() }] })
sendTrackedEmail(environment, message) satisfies Promise<{ id: string }>

if (isGmailConfigured(mailEnvironment)) {
  mailEnvironment.GMAIL_CLIENT_ID satisfies string
  mailEnvironment.GMAIL_REFRESH_TOKEN satisfies string
}
// @ts-expect-error Configuration must be checked before using optional fields.
mailEnvironment.GMAIL_CLIENT_ID satisfies string
// @ts-expect-error A rate limiter requires a connected database.
checkRateLimit({}, 'email:global', 100, 86400)
