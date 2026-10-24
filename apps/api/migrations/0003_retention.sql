-- FIL-09: soft-deleted files are purged from object storage after a grace period.
ALTER TABLE file_objects ADD COLUMN purged_at timestamptz;
CREATE INDEX file_objects_purge_idx ON file_objects (deleted_at) WHERE deleted_at IS NOT NULL AND purged_at IS NULL;
