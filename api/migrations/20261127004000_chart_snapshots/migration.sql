CREATE TABLE chart_snapshots (
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  timeZone TEXT NOT NULL,
  computedAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  PRIMARY KEY (userId, period, timeZone)
) WITHOUT ROWID;
