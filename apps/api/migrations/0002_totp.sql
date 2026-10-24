-- AUTH-12: TOTP second factor. The secret is AES-GCM encrypted by the app (DATA_ENC_KEY);
-- recovery codes are stored as keyed hashes and consumed on use.
ALTER TABLE users
  ADD COLUMN totp_secret_enc text,
  ADD COLUMN totp_enabled_at timestamptz,
  ADD COLUMN recovery_code_hashes text[] NOT NULL DEFAULT '{}';
