-- Durable creation receipts contain no form body, invite code, or response copy.
-- Resource IDs deliberately have no FK: deleting a resource must not make an
-- old retry create it again. Receipts live for the owner's account lifetime;
-- short TTL cleanup would silently weaken that guarantee. User deletion removes
-- the owner's receipts, since that stable user ID can no longer authenticate.
CREATE TABLE IF NOT EXISTS create_operations (
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('posting', 'room')),
  operation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  resource_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (owner_user_id, kind, operation_id)
);
ALTER TABLE create_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON create_operations FROM PUBLIC, anon, authenticated;
