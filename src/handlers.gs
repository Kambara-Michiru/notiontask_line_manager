/**
 * handlers.gs — LINE Webhook（doPost）とメッセージ処理
 */

function doPost(e) {
  // LINEには即座に200を返す必要があるため、処理の失敗はイベント単位で握る
  var ok = ContentService.createTextOutput(JSON.stringify({}))
    .setMimeType(ContentService.MimeType.JSON);

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return ok;
  }

  (body.events || []).forEach(function (ev) {
    try {
      if (ev.type === 'postback') {
        handlePostback_(ev);
      } else if (ev.type === 'message' && ev.message.type === 'text') {
        handleText_(ev);
      }
    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
      if (ev.replyToken) {
        try {
          lineReply(ev.replyToken, [textMessage_('エラー: ' + err.message)]);
        } catch (err2) {
          console.error(err2);
        }
      }
    }
  });

  return ok;
}

// ============================================================
// postback（クイックリプライのボタン）
// ============================================================

function handlePostback_(ev) {
  var data = parseQuery_(ev.postback.data);

  if (data.action === 'none') {
    lineReply(ev.replyToken, [textMessage_('りょうかい。明日また聞くね。')]);
    return;
  }

  if (data.action === 'done' && data.id) {
    markDone(data.id);
    replyRemaining_(ev.replyToken, removeFromLastList_(data.id), '完了！');
    return;
  }

  if (data.action === 'snooze' && data.id) {
    snoozeTask(data.id);
    replyRemaining_(ev.replyToken, removeFromLastList_(data.id), '⏭ 明日にまわした。');
    return;
  }
}

/** 完了/延期後に残りタスクの一覧（クイックリプライ付き）を返す */
function replyRemaining_(replyToken, rest, headline) {
  var text;
  if (rest.length === 0) {
    text = headline + '\n今日の分は全部さばけた。おつかれ！';
  } else {
    text = headline + ' 残り ' + rest.length + ' 件:\n\n' +
      rest.map(function (t, i) { return circled_(i) + ' ' + clip_(t.title, TITLE_CLIP); }).join('\n');
  }
  lineReply(replyToken, [withQuickReply_(textMessage_(text), rest)]);
}

// ============================================================
// テキストメッセージ
// ============================================================

var LIST_KEYWORDS_RE = /^(リスト|りすと|list|今日|きょう|いま|今|タスク)$/i;
var GREETING_RE = /^(おはよう?|おやすみ|こんにちは|こんばんは|ありがとう?|おつかれ(さま)?|お疲れ(様|さま)?|うん|はい|ok|おけ|りょ(うかい)?|了解|やあ|ういっす|よろしく)[!！～〜。.]?$/i;
var DONE_WORDS_RE = /^(完了|done|終わった|おわった|終わり|おわり|済み?|すんだ|できた|やった)$/i;
var SNOOZE_WORDS_RE = /^(明日|あした|延期|スヌーズ|パス|あとで)$/i;

function handleText_(ev) {
  var raw = ev.message.text.trim();

  // F-5: 一覧の再送
  if (LIST_KEYWORDS_RE.test(raw)) {
    replyCurrentList_(ev.replyToken);
    return;
  }

  // F-4: 番号による完了/延期（「2」「2完了」「3 終わった」「1 明日」など）
  // 番号が文頭のときだけコマンド扱いにする。「牛乳2本買う」はinbox行き。
  var m = normalizeDigits_(raw).match(/^(\d{1,2})\s*(.*)$/);
  if (m) {
    var suffix = m[2].trim();
    if (suffix === '' || DONE_WORDS_RE.test(suffix)) {
      completeByNumber_(ev.replyToken, parseInt(m[1], 10), 'done');
      return;
    }
    if (SNOOZE_WORDS_RE.test(suffix)) {
      completeByNumber_(ev.replyToken, parseInt(m[1], 10), 'snooze');
      return;
    }
    // 番号で始まるがコマンドではない → inboxへフォールスルー
  }

  // inbox誤爆ガード: 挨拶・相槌はタスク化しない
  if (raw.length <= 8 && GREETING_RE.test(raw)) {
    lineReply(ev.replyToken, [textMessage_(usageText_())]);
    return;
  }

  // F-6: inboxへ追加
  if (raw.length > 1) {
    var url = createInboxTask(raw);
    lineReply(ev.replyToken, [textMessage_('inbox に入れといた:\n' + raw + '\n' + url)]);
    return;
  }

  lineReply(ev.replyToken, [textMessage_(usageText_())]);
}

/** 現在の next 一覧を取得して返信し、番号対応表を更新する */
function replyCurrentList_(replyToken) {
  var tasks = fetchTodayTasks();
  saveLastList_(tasks);
  var text = tasks.length
    ? '今の next:\n\n' + buildListText_(tasks, true)
    : 'next は空っぽ。inbox の整理でもする？';
  lineReply(replyToken, [withQuickReply_(textMessage_(text), tasks)]);
}

/** 番号 → pageId を対応表から引いて done / snooze する */
function completeByNumber_(replyToken, num, mode) {
  var saved = loadLastList_();

  if (!saved.items.length) {
    lineReply(replyToken, [textMessage_('番号の対応表がないよ。「リスト」って送って一覧を出してから番号で返して。')]);
    return;
  }

  // 鮮度チェック: 古い一覧の番号で別タスクを誤操作しないようにする
  if (Date.now() - saved.at > LIST_TTL_MS) {
    lineReply(replyToken, [textMessage_('その番号、前の一覧のやつかも。「リスト」って送って最新の一覧を出し直して。')]);
    return;
  }

  var idx = num - 1;
  if (idx < 0 || idx >= saved.items.length) {
    lineReply(replyToken, [textMessage_('その番号は無いよ（今は' + saved.items.length + '件）。「リスト」で今の一覧が出せる。')]);
    return;
  }

  var task = saved.items[idx];
  if (mode === 'snooze') {
    snoozeTask(task.id);
    replyRemaining_(replyToken, removeFromLastList_(task.id), '⏭ ' + clip_(task.title, TITLE_CLIP) + '\n明日にまわした。');
  } else {
    markDone(task.id);
    replyRemaining_(replyToken, removeFromLastList_(task.id), '✅ ' + clip_(task.title, TITLE_CLIP) + '\n完了にした。');
  }
}

function usageText_() {
  return '使い方:\n' +
    '・「リスト」→ 今日のタスク一覧\n' +
    '・番号（例: 2）→ そのタスクを完了\n' +
    '・番号+明日（例: 2 明日）→ 着手日を明日へ\n' +
    '・それ以外の文 → Notionのinboxに追加';
}

// ============================================================
// 番号対応表（ScriptPropertiesに保持、LockServiceで保護）
// ============================================================

function saveLastList_(tasks) {
  var slim = tasks.map(function (t) { return { id: t.id, title: t.title }; });
  withLock_(function () {
    PropertiesService.getScriptProperties().setProperty(
      SP_KEY_LAST_LIST,
      JSON.stringify({ at: Date.now(), items: slim })
    );
  });
}

/** @return {{at: number, items: Array<{id: string, title: string}>}} */
function loadLastList_() {
  var raw = PropertiesService.getScriptProperties().getProperty(SP_KEY_LAST_LIST);
  if (!raw) return { at: 0, items: [] };
  var parsed = JSON.parse(raw);
  // 旧形式（配列のみ）が残っていても壊れないように
  if (Array.isArray(parsed)) return { at: 0, items: parsed };
  return parsed;
}

function removeFromLastList_(pageId) {
  var rest = [];
  withLock_(function () {
    var saved = loadLastList_();
    rest = saved.items.filter(function (t) { return t.id !== pageId; });
    PropertiesService.getScriptProperties().setProperty(
      SP_KEY_LAST_LIST,
      JSON.stringify({ at: saved.at || Date.now(), items: rest })
    );
  });
  return rest;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10 * 1000);
  try {
    fn();
  } finally {
    lock.releaseLock();
  }
}

// ---- 小物 ----

function parseQuery_(s) {
  var out = {};
  (s || '').split('&').forEach(function (kv) {
    var p = kv.split('=');
    out[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
  });
  return out;
}

/** 全角数字を半角に寄せる（「２」でも番号完了できるように） */
function normalizeDigits_(s) {
  return s.replace(/[０-９]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });
}
