-- 日ごと（日本時間）の、ページを開いた回数
CREATE TABLE IF NOT EXISTS hits (
  day TEXT PRIMARY KEY,   -- 2026-10-18
  n   INTEGER NOT NULL
);

-- スイングトレード道場の分（同じ形）
CREATE TABLE IF NOT EXISTS swing_hits (
  day TEXT PRIMARY KEY,
  n   INTEGER NOT NULL
);
