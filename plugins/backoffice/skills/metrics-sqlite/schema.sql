-- Usage: sqlite3 data/metrics.db < schema.sql   (one database per business)
CREATE TABLE IF NOT EXISTS daily_metrics (
  piece_id     TEXT NOT NULL,          -- calendar id (P01) or ad name
  date         TEXT NOT NULL,          -- YYYY-MM-DD
  channel      TEXT NOT NULL,          -- meta, tiktok, instagram-organic...
  impressions  INTEGER DEFAULT 0,
  clicks       INTEGER DEFAULT 0,
  results      INTEGER DEFAULT 0,      -- what counts as success: messages, bookings, sales
  spend        REAL    DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'MXN',
  source_file  TEXT,                   -- CSV in data/ the row came from
  imported_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (piece_id, date, channel)  -- re-importing a day replaces it, it does not duplicate it
);
