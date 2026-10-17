// シバイヌおやびんのデイトレ道場・スイングトレード道場: ページを開いた回数のカウンター（Cloudflare Worker + D1）
// POST /hit   … 公開ページから開かれた時に今日の回数を 1 増やし、累計・昨日・今日を返す
// GET  /stats … 数えずに累計・昨日・今日を返す
// /swing/hit・/swing/stats はスイングトレード道場の分（表 swing_hits）。それ以外はデイトレ道場の分（表 hits）
// 日付の区切りは日本時間。受け取るのは「開いた」という合図だけで、ほかのデータは受け取らない。
const ORIGINS = ['https://shibainuoyabin.github.io'];
const jstDay = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

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
    if (pathname === '/hit') {
      // 公開ページ以外（ローカル版や直接のアクセス）からは数えない
      if (req.method !== 'POST' || !ORIGINS.includes(req.headers.get('Origin') || '')) {
        return new Response('forbidden', { status: 403, headers });
      }
      await env.DB.prepare(`INSERT INTO ${table} (day, n) VALUES (?1, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1`)
        .bind(today).run();
    }
    const row = await env.DB.prepare(
      `SELECT COALESCE(SUM(n), 0) AS total,
              COALESCE(SUM(CASE WHEN day = ?2 THEN n END), 0) AS yesterday,
              COALESCE(SUM(CASE WHEN day = ?1 THEN n END), 0) AS today
       FROM ${table}`).bind(today, yesterday).first();
    return Response.json(row, { headers });
  },
};
