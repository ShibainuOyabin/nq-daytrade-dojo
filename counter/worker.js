// シバイヌおやびんのデイトレ道場・スイングトレード道場: ページを開いた回数のカウンター（Cloudflare Worker + D1）
// POST /hit   … 公開ページから開かれた時に今日の回数を 1 増やし、累計・昨日・今日を返す
// GET  /stats … 数えずに累計・昨日・今日を返す
// /swing/hit・/swing/stats はスイングトレード道場の分（表 swing_hits）。それ以外はデイトレ道場の分（表 hits）
// 日付の区切りは日本時間。受け取るのは「開いた」という合図だけで、ほかのデータは受け取らない。
//
// 連打対策（2026-10-18 に1日で約8.6万回の連打があったため）:
// - 同じ送り元（IP アドレス）からの /hit は 1 分に RATE_PER_MIN 回まで（LIMITER。データベースに書く前に止める）
// - 同じ送り元からの「開いた」は 1 日に DAILY_LIMIT 回までしか数えない（表 seen）
// - IP アドレスは保存しない。秘密の文字列 SALT・日付と混ぜたハッシュだけを、その日と翌日まで残す
const ORIGINS = ['https://shibainuoyabin.github.io'];
const DAILY_LIMIT = 5;
const jstDay = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

async function visitorKey(env, table, day, ip) {
  const data = new TextEncoder().encode(`${env.SALT || ''}|${table}|${day}|${ip}`);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...h.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(req, env) {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Cache-Control': 'no-store',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    let { pathname } = new URL(req.url), table = 'hits';
    if (pathname.startsWith('/swing/')) { table = 'swing_hits'; pathname = pathname.slice(6); }
    if (pathname !== '/hit' && pathname !== '/stats') return new Response('not found', { status: 404, headers });

    const now = Date.now(), today = jstDay(now), yesterday = jstDay(now - 86400e3);
    const stats = () => env.DB.prepare(
      `SELECT COALESCE(SUM(n), 0) AS total,
              COALESCE(SUM(CASE WHEN day = ?2 THEN n END), 0) AS yesterday,
              COALESCE(SUM(CASE WHEN day = ?1 THEN n END), 0) AS today
       FROM ${table}`).bind(today, yesterday).first();

    if (pathname === '/hit') {
      // 公開ページ以外（ローカル版や直接のアクセス）からは数えない
      if (req.method !== 'POST' || !ORIGINS.includes(req.headers.get('Origin') || '')) {
        return new Response('forbidden', { status: 403, headers });
      }
      const ip = req.headers.get('CF-Connecting-IP') || '';
      // 短い時間の連打は、データベースに触る前に断る
      if (env.LIMITER) {
        const { success } = await env.LIMITER.limit({ key: `${table}|${ip}` });
        if (!success) return new Response('too many requests', { status: 429, headers });
      }
      // 同じ送り元は 1 日 DAILY_LIMIT 回まで数える
      const key = await visitorKey(env, table, today, ip);
      const seen = await env.DB.prepare(
        `INSERT INTO seen (tbl, day, k, n) VALUES (?1, ?2, ?3, 1)
         ON CONFLICT(tbl, day, k) DO UPDATE SET n = n + 1 RETURNING n`).bind(table, today, key).first('n');
      if (seen <= DAILY_LIMIT) {
        await env.DB.prepare(`INSERT INTO ${table} (day, n) VALUES (?1, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1`)
          .bind(today).run();
      } else if (seen === DAILY_LIMIT + 1 || seen % 100 === 0) {
        console.log(JSON.stringify({ skipped: table, n: seen, country: req.cf && req.cf.country,
          ua: (req.headers.get('User-Agent') || '').slice(0, 160) }));
      }
      // 古い記録はときどき消す（今日と昨日の分だけ残す）
      if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM seen WHERE day < ?1').bind(yesterday).run();
    }
    return Response.json(await stats(), { headers });
  },
};
