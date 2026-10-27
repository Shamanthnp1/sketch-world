-- migrations/0001_init.sql
CREATE TABLE worlds (id TEXT PRIMARY KEY, title TEXT NOT NULL, scene TEXT NOT NULL, safe INTEGER NOT NULL, owner_token_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX worlds_gallery ON worlds (safe, created_at DESC);
CREATE TABLE usage (day TEXT PRIMARY KEY, spent_micro INTEGER NOT NULL DEFAULT 0);   -- micro-dollars, UTC day
CREATE TABLE checks (sha256 TEXT PRIMARY KEY, safe INTEGER NOT NULL, created_at INTEGER NOT NULL);
