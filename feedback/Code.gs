// シバイヌおやびんのデイトレ道場: 「感想・要望・バグ報告」を受け取って、このスクリプトの持ち主の Gmail に送る
// Google Apps Script のウェブアプリとして公開する（実行するユーザー: 自分 / アクセスできるユーザー: 全員）。
// 送り先のアドレスはコードに書かず、スクリプトの持ち主のアドレスを使う。

const MAX_LEN = 2000;        // 1通の長さの上限（文字）
const MAX_PER_HOUR = 30;     // 1時間に受け付ける上限（いたずら対策）
const KINDS = ['感想', '要望', 'バグ報告'];

function doPost(e) {
  const p = (e && e.parameter) || {};
  if (p.website) return json({ ok: true });                // 人には見えない欄に何か入っていたら機械の投稿とみなして捨てる
  const message = String(p.message || '').trim().slice(0, MAX_LEN);
  if (!message) return json({ ok: false, error: 'empty' });
  const kind = KINDS.indexOf(p.kind) >= 0 ? p.kind : '感想';

  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('count') || 0);
  if (n >= MAX_PER_HOUR) return json({ ok: false, error: 'busy' });
  cache.put('count', String(n + 1), 3600);

  const when = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  const info = [
    `種類: ${kind}`,
    `日時: ${when}（日本時間）`,
    `データ: ${String(p.data || '-').slice(0, 100)}`,
    `画面: ${String(p.screen || '-').slice(0, 40)}`,
    `ブラウザ: ${String(p.ua || '-').slice(0, 300)}`,
  ].join('\n');
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: `[デイトレ道場] ${kind}`,
    body: `${message}\n\n----\n${info}\n`,
    name: 'デイトレ道場 メッセージ',
  });
  return json({ ok: true });
}

// ブラウザで URL を開いた時の確認用
function doGet() {
  return json({ ok: true, app: 'dojo-feedback' });
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
