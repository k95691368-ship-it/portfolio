// Shared contracts for the incrementally checked request and mail boundaries.
// These describe the existing browser/edge APIs; they add no runtime code.
export type DeliveryFailureState = 'failed' | 'unknown'

export interface EmailAttachment {
  filename: string
  contentBase64: string
  contentType?: string
}

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html: string
  fromName?: string
  attachments?: EmailAttachment[]
  idempotencyKey?: string
  messageId?: string
}

export interface MailEnvironment {
  EMAIL_ENABLED?: string
  GMAIL_CLIENT_ID?: string
  GMAIL_CLIENT_SECRET?: string
  GMAIL_REFRESH_TOKEN?: string
  FINAL_OFFER_FROM_EMAIL?: string
  FINAL_OFFER_FROM_NAME?: string
}

export type ConfiguredMailEnvironment = MailEnvironment & Required<Pick<MailEnvironment,
  'GMAIL_CLIENT_ID' | 'GMAIL_CLIENT_SECRET' | 'GMAIL_REFRESH_TOKEN' | 'FINAL_OFFER_FROM_EMAIL'>>

export type SqlValue = string | number | bigint | boolean | null | Uint8Array
export type RateLimitTicket = number | string | bigint

export interface DatabaseStatement {
  bind(...values: SqlValue[]): DatabaseStatement
  first<Row extends object = Record<string, unknown>>(): Promise<Row | null>
  run(): Promise<{ meta?: { changes?: number; last_row_id?: RateLimitTicket | null } }>
}

export interface RateLimitDatabase {
  prepare(sql: string): DatabaseStatement
  withRateLimitLock?<Result>(bucket: string, operation: (db: RateLimitDatabase) => Promise<Result>): Promise<Result>
}

export interface TrackedMailEnvironment extends MailEnvironment {
  DB?: RateLimitDatabase
}

export interface EmailReceipt {
  id: string
}
