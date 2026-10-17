// シバイヌおやびんのデイトレ道場: CSV の読み取りと変換、サンプル（架空）データ、ブラウザ内への保存
// 読み込んだファイルはこのブラウザの中だけで処理し、どこにも送信しない。
window.DojoData = (() => {
  'use strict';

  // ---------- タイムゾーン: タイムゾーンのない日時（壁時計）→ UTC ----------
  const fmtCache = {}, offCache = {};
  function tzParts(tz, ms) {
    const f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
    const p = {};
    for (const x of f.formatToParts(new Date(ms))) p[x.type] = +x.value;
    return p;
  }
  function tzOffsetMs(tz, ms) {
    const p = tzParts(tz, ms);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  }
  function wallToUtcMs(tz, y, mo, d, h, mi, s) {
    const guess = Date.UTC(y, mo - 1, d, h, mi, s);
    if (tz === 'UTC') return guess;
    const key = `${tz}|${y}-${mo}-${d}-${h}`;
    let off = offCache[key];
    if (off === undefined) {
      off = tzOffsetMs(tz, guess);
      off = tzOffsetMs(tz, guess - off); // 夏時間の切り替わり付近を合わせ直す
      offCache[key] = off;
    }
    return guess - off;
  }

  // ---------- 時刻の文字列 ----------
  // 戻り値: { ms }（時刻が一意に決まる）/ { wall: [年,月,日,時,分,秒] }（タイムゾーンなし）/ null
  function parseTime(raw) {
    const s = String(raw).trim();
    if (!s) return null;
    let m;
    if (/^\d{9,13}(\.\d+)?$/.test(s)) {           // UNIX 秒・ミリ秒
      const n = +s;
      return { ms: n > 1e11 ? n : n * 1000 };
    }
    if (/\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i.test(s)) { // タイムゾーン付き ISO
      let iso = s.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
      const ms = Date.parse(iso);
      if (!isNaN(ms)) return { ms };
    }
    const hms = (h, mi, sec, ap) => {
      let hh = +(h || 0);
      if (ap) { ap = ap.toUpperCase(); if (ap === 'PM' && hh < 12) hh += 12; if (ap === 'AM' && hh === 12) hh = 0; }
      return [hh, +(mi || 0), +(sec || 0)];
    };
    // 2026-08-07 09:30 / 2026/08/07 9:30:00 / 2026.08.07 09:30（MT）
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(AM|PM)?)?$/i))) {
      return { wall: [+m[1], +m[2], +m[3], ...hms(m[4], m[5], m[6], m[7])] };
    }
    // 20260807 093000 / 20260807 09:30
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})(?:[ T]+(\d{2}):?(\d{2})(?::?(\d{2}))?)?$/))) {
      return { wall: [+m[1], +m[2], +m[3], ...hms(m[4], m[5], m[6])] };
    }
    // 08/07/2026 09:30（米国式。最初の数字が 12 より大きければ 日/月/年）
    if ((m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:[T ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i))) {
      let mo = +m[1], d = +m[2];
      if (mo > 12) [mo, d] = [d, mo];
      return { wall: [+m[3], mo, d, ...hms(m[4], m[5], m[6], m[7])] };
    }
    return null;
  }

  // ---------- CSV ----------
  function splitLine(line, sep) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === sep) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(x => x.trim());
  }

  const norm = h => h.replace(/^﻿/, '').replace(/[<>"'\s_]/g, '').toLowerCase();
  const ALIASES = {
    datetime: ['datetime', 'date/time', 'timestamp', 'gmttime', 'localtime', '日時', '日付時刻'],
    date: ['date', '日付', 'day'],
    time: ['time', '時刻', '時間'],
    open: ['open', 'o', '始値', 'openprice'],
    high: ['high', 'h', '高値', 'highprice'],
    low: ['low', 'l', '安値', 'lowprice'],
    close: ['close', 'c', '終値', 'last', 'closeprice', 'lastprice'],
    volume: ['volume', 'vol', 'v', '出来高', 'tickvol', 'tickvolume', 'realvolume'],
  };
  const num = x => {
    if (x == null) return NaN;
    const s = String(x).replace(/,/g, '').trim();
    return s === '' ? NaN : +s;
  };

  function findColumns(header) {
    const n = header.map(norm), col = {};
    for (const k in ALIASES) {
      const i = n.findIndex(h => ALIASES[k].includes(h));
      if (i >= 0) col[k] = i;
    }
    return col;
  }

  // text: CSV の中身, tz: タイムゾーンのない時刻をどこの時間とみなすか
  // 戻り値: { bars: [[UTC秒, 始, 高, 安, 終, 出来高], ...], info } または { error, hint }
  function parseCSV(text, tz) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '');
    if (lines.length < 2) return { error: 'ファイルの中身がほとんどありません。', hint: 'CSVファイル（文字だけのファイル）を選んでいるか確かめてください。' };
    const first = lines[0];
    const sep = [',', ';', '\t'].map(c => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
    let header = splitLine(first, sep), col = findColumns(header), start = 1;

    // 列名がない場合は「時刻, 始値, 高値, 安値, 終値, 出来高」の順とみなす
    // 1行目が「時刻＋数字」なら列名なし、それ以外は列名の行とみなす
    const hasNames = col.open != null || col.close != null || !(parseTime(header[0]) && !isNaN(num(header[1])));
    if (!hasNames) {
      if (parseTime(header[0]) && !isNaN(num(header[1]))) { col = { datetime: 0, open: 1, high: 2, low: 3, close: 4, volume: header.length > 5 ? 5 : undefined }; start = 0; }
      else return { error: '1行目に列名が見つかりませんでした。', hint: '1行目に「time,open,high,low,close,volume」のような列名を入れてください。' };
    }
    const missing = ['open', 'high', 'low', 'close'].filter(k => col[k] == null);
    if (missing.length) {
      const jp = { open: '始値 (open)', high: '高値 (high)', low: '安値 (low)', close: '終値 (close)' };
      return { error: `必要な列が見つかりません: ${missing.map(k => jp[k]).join('、')}`, hint: `見つかった列名: ${header.join(' / ')}` };
    }
    // 時刻の列: 日時の列 → 日付＋時刻の2列 → どちらか片方
    let timeOf;
    if (col.datetime != null) timeOf = r => r[col.datetime];
    else if (col.date != null && col.time != null) timeOf = r => `${r[col.date]} ${r[col.time]}`;
    else if (col.time != null) timeOf = r => r[col.time];
    else if (col.date != null) timeOf = r => r[col.date];
    else return { error: '時刻の列が見つかりません。', hint: `列名を「time」や「datetime」にしてください。見つかった列名: ${header.join(' / ')}` };

    const rows = [];
    let skipped = 0, naive = 0, firstBad = null;
    for (let i = start; i < lines.length; i++) {
      const r = splitLine(lines[i], sep);
      const tm = parseTime(timeOf(r));
      let o = num(r[col.open]), h = num(r[col.high]), l = num(r[col.low]), c = num(r[col.close]);
      const v = col.volume != null ? num(r[col.volume]) : NaN;
      if (!tm || [o, h, l, c].some(x => !isFinite(x))) { skipped++; if (firstBad == null) firstBad = i + 1; continue; }
      let ms;
      if (tm.ms != null) ms = tm.ms;
      else { naive++; ms = wallToUtcMs(tz, ...tm.wall); }
      h = Math.max(h, o, c, l); l = Math.min(l, o, c, h);
      rows.push([Math.round(ms / 1000), o, h, l, c, isFinite(v) && v >= 0 ? v : null]);
    }
    if (rows.length < 20) {
      return { error: `読み取れた足が ${rows.length} 本しかありません。`, hint: firstBad ? `${firstBad} 行目などが読み取れませんでした。時刻や数字の書き方を確かめてください。` : '' };
    }
    rows.sort((a, b) => a[0] - b[0]);
    const uniq = [];
    for (const r of rows) { if (uniq.length && uniq[uniq.length - 1][0] === r[0]) uniq[uniq.length - 1] = r; else uniq.push(r); }

    // 足の長さ（いちばん多い間隔）
    const freq = new Map();
    for (let i = 1; i < uniq.length; i++) {
      const d = uniq[i][0] - uniq[i - 1][0];
      if (d > 0 && d <= 3600) freq.set(d, (freq.get(d) || 0) + 1);
    }
    const interval = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!interval) return { error: '足の間隔が分かりませんでした。', hint: '日足や週足ではなく、5分足（または1分足）のデータを書き出してください。' };
    if (interval > 300) {
      return { error: `${interval % 60 ? interval + '秒' : interval / 60 + '分'}足のデータのようです。`, hint: '5分より長い足は使えません。チャートを5分足（または1分足）にしてから書き出してください。' };
    }
    if (300 % interval !== 0) return { error: `足の間隔（${interval}秒）が5分を割り切れません。`, hint: '1分・2分・5分足などで書き出してください。' };

    const hadVolume = uniq.some(r => r[5] != null);
    let bars = uniq.map(r => [r[0], r[1], r[2], r[3], r[4], r[5] == null ? (hadVolume ? 0 : 1) : r[5]]);
    let aggregated = false;
    if (interval < 300 || bars.some(b => b[0] % 300 !== 0)) {
      aggregated = interval < 300;
      const out = [];
      for (const b of bars) {
        const t = b[0] - (b[0] % 300), last = out[out.length - 1];
        if (last && last[0] === t) { last[2] = Math.max(last[2], b[2]); last[3] = Math.min(last[3], b[3]); last[4] = b[4]; last[5] += b[5]; }
        else out.push([t, b[1], b[2], b[3], b[4], b[5]]);
      }
      bars = out;
    }
    return {
      bars,
      info: {
        rows: lines.length - start, used: rows.length, skipped, naive: naive > 0, interval, aggregated, hadVolume,
        first: bars[0][0], last: bars[bars.length - 1][0],
      },
    };
  }

  // 2つのデータをつなぐ（同じ時刻は新しい方を使う）
  function mergeBars(a, b) {
    const m = new Map();
    for (const x of a) m.set(x[0], x);
    for (const x of b) m.set(x[0], x);
    return [...m.values()].sort((x, y) => x[0] - y[0]);
  }

  // ---------- サンプル（架空の値動き） ----------
  // 乱数の種を固定して毎回同じ値動きにする。実際の相場ではない。
  function makeSample(days = 20) {
    let seed = 20260807;
    const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const tick = 0.25, round = p => Math.round(p / tick) * tick;
    const bars = [];
    let price = 21000;
    // 冬時間だけの期間（夏時間の切り替えなし）の平日を使う
    let day = Date.UTC(2031, 0, 13); // 月曜
    for (let n = 0; n < days; day += 86400000) {
      const wd = new Date(day).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      n++;
      const trend = gauss() * 0.00004;                    // その日の流れ（1分あたり）
      const dayVol = 0.7 + rnd() * 0.8;                   // 荒れる日・静かな日
      const prev = new Date(day - 86400000);
      // 前日 18:00 ET 〜 当日 16:55 ET（17時台は休場）
      for (let k = 0; k < 23 * 12; k++) {
        const mins = 18 * 60 + k * 5, d = mins >= 1440 ? new Date(day) : prev, hm = mins % 1440;
        const ms = wallToUtcMs('America/New_York', d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), Math.floor(hm / 60), hm % 60, 0);
        const rth = hm >= 570 && hm < 960;
        let sig = 0.00018;                                 // 夜間
        if (hm >= 180 && hm < 570) sig = 0.00028;          // 欧州時間
        if (hm >= 510 && hm < 525) sig = 0.0006;           // 8:30 の指標発表
        if (rth) sig = 0.00045;
        if (hm >= 570 && hm < 615) sig = 0.0009;           // 寄り付き直後
        if (hm >= 930 && hm < 960) sig = 0.0006;           // 大引け前
        sig *= dayVol;
        const o = price;
        let h = o, l = o, p = o, move = 0;
        for (let s = 0; s < 5; s++) {
          const r = trend * (rth ? 1.5 : 0.5) + sig * gauss() * (rnd() < 0.03 ? 3 : 1);
          p *= 1 + r; move += Math.abs(r);
          h = Math.max(h, p); l = Math.min(l, p);
        }
        price = p;
        const base = rth ? 2500 + 4500 * (Math.pow((hm - 765) / 195, 2)) : (hm >= 180 ? 700 : 350);
        const vol = Math.round(base * (0.6 + rnd() * 0.8) * (1 + move / sig / 8));
        bars.push([Math.round(ms / 1000), round(o), round(h), round(l), round(price), vol]);
      }
    }
    for (const b of bars) { b[2] = Math.max(b[2], b[1], b[4]); b[3] = Math.min(b[3], b[1], b[4]); }
    return bars;
  }

  // ---------- ブラウザ内への保存（IndexedDB） ----------
  const DB = 'nqdojo', STORE = 'datasets';
  function openDB() {
    return new Promise((res, rej) => {
      if (!window.indexedDB) { rej(new Error('IndexedDB が使えません')); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function store(mode, fn) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); res(req && req.result); };
      tx.onerror = () => { db.close(); rej(tx.error); };
    });
  }
  const load = key => store('readonly', s => s.get(key)).catch(() => undefined);
  const save = (key, val) => store('readwrite', s => s.put(val, key));
  const remove = key => store('readwrite', s => s.delete(key)).catch(() => undefined);

  return { parseCSV, mergeBars, makeSample, load, save, remove, wallToUtcMs };
})();
