/**
 * config.gs — 定数・プロパティ名マッピング・秘密情報の読み出し
 *
 * Notion側でプロパティ名を変えたら PROP だけ直せばよい。
 * トークン類はスクリプトプロパティから読む（コードには書かない）。
 */

// ---- Notion ----
var NOTION_DATABASE_ID = '27e36903-c171-804c-84c2-fc041e4b7fab'; // db_tasks
var NOTION_VERSION = '2022-06-28';

// Notionプロパティ名のマッピング（変更時はここだけ直す）
var PROP = {
  title: 'tasks',
  status: 'status',
  priority: '優先度',
  start: '着手日',
  due: 'Due Date/完了日',
  note: '近い未来の自分へ',
};

// statusの選択肢名
var STATUS = {
  inbox: 'inbox',
  next: 'next',
  done: 'done',
};

var PRIORITY_HIGH = '高';

// ---- 動作パラメータ ----
var TZ = 'Asia/Tokyo';
var MAX_TASKS = 12;                       // クイックリプライ13枠（12件+「まだ」）に合わせる
var DUAL_BUTTON_MAX = 6;                  // この件数以下なら「完了」「明日」の2ボタンを付ける
var LIST_TTL_MS = 6 * 60 * 60 * 1000;     // 番号対応表の有効期間（6時間）
var TITLE_CLIP = 40;                      // 一覧内タイトルの最大文字数
var TEXT_LIMIT = 4900;                    // LINEテキスト上限5000に対する安全マージン

// ---- ScriptProperties のキー ----
var SP_KEY_LAST_LIST = 'LAST_LIST';

/**
 * スクリプトプロパティから必須値を読む。未設定なら原因が分かるエラーを投げる。
 */
function getSecret_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) {
    throw new Error(
      'スクリプトプロパティ「' + key + '」が未設定。' +
      'GASエディタの「プロジェクトの設定 > スクリプト プロパティ」で設定してください。'
    );
  }
  return v;
}

function notionToken_() { return getSecret_('NOTION_TOKEN'); }
function lineToken_() { return getSecret_('LINE_CHANNEL_ACCESS_TOKEN'); }
function lineUserId_() { return getSecret_('LINE_USER_ID'); }

// ---- 日付ユーティリティ ----
function todayStr_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function tomorrowStr_() {
  return Utilities.formatDate(new Date(Date.now() + 24 * 60 * 60 * 1000), TZ, 'yyyy-MM-dd');
}

// ---- 文字列ユーティリティ ----
function circled_(i) {
  return '①②③④⑤⑥⑦⑧⑨⑩⑪⑫'.charAt(i) || String(i + 1) + '.';
}

function clip_(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
