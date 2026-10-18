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

-- 連打対策: 送り元ごとの、その日の「開いた」の回数。IP アドレスは保存せず、元に戻せないハッシュ（k）だけを持つ
CREATE TABLE IF NOT EXISTS seen (
  tbl TEXT NOT NULL,      -- hits / swing_hits
  day TEXT NOT NULL,
  k   TEXT NOT NULL,
  n   INTEGER NOT NULL,
  PRIMARY KEY (tbl, day, k)
);
