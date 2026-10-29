-- migrations/0002_listed.sql: a saved world shows in the Gallery only once the operator approves it (listed = 1).
-- It still opens by link at /w/:id. Approve: UPDATE worlds SET listed = 1 WHERE id = '<id>' (README, docs/gate.md).
ALTER TABLE worlds ADD COLUMN listed INTEGER NOT NULL DEFAULT 0;
DROP INDEX worlds_gallery;
CREATE INDEX worlds_gallery ON worlds (safe, listed, created_at DESC);
-- The sample worlds of SAMPLE_WORLD_IDS in wrangler.jsonc (task 11.3). The gallery also lists any id in that var.
UPDATE worlds SET listed = 1 WHERE id IN ('NjaZ1IphRu', 'Tco7s8pREl', 'VcULvxRZQO');
