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
  if (!data.id) return;

  // 体感速度のため、返信を先に送ってからNotionを更新する
  // （返信内容は対応表から組めるのでNotionの応答を待つ必要がない）
  if (data.action === 'done') {
    var r = updateListState_(data.id, 'done');
    replyAction_(ev.replyToken, '✅ 完了: ' + titleOr_(r), r);
    notionAfterReply_(function () { markDone(data.id); }, r);
    return;
  }

  if (data.action === 'snooze') {
    var r2 = updateListState_(data.id, 'snoozed');
    replyAction_(ev.replyToken, '⏭ 明日へ: ' + titleOr_(r2), r2);
    notionAfterReply_(function () { snoozeTask(data.id); }, r2);
    return;
  }

  // 日付ピッカーで選んだ日へ延期
  if (data.action === 'snooze_pick') {
    var date = ev.postback.params && ev.postback.params.date
      ? ev.postback.params.date : tomorrowStr_();
    var r3 = updateListState_(data.id, 'snoozed');
    replyAction_(ev.replyToken, '📅 ' + date + ' へ: ' + titleOr_(r3), r3);
    notionAfterReply_(function () { snoozeTaskTo(data.id, date); }, r3);
    return;
  }

  // スキップ: Notionは触らず次のカードへ
  if (data.action === 'skip') {
    var r4 = updateListState_(data.id, 'skipped');
    replyAction_(ev.replyToken, '⏩ スキップ: ' + titleOr_(r4), r4);
    return;
  }
}

function titleOr_(r) {
  return r.title ? clip_(r.title, TITLE_CLIP) : '(タイトル不明)';
}

/**
 * 返信後のNotion更新。replyTokenは使用済みなので、失敗はpushで知らせる
 * （まれな事象なので無料枠への影響は無視できる。操作は冪等なので再操作で復旧可能）。
 */
function notionAfterReply_(fn, r) {
  try {
    fn();
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    try {
      linePush([textMessage_(
        '⚠️ 「' + titleOr_(r) + '」のNotion更新に失敗した:\n' + err.message +
        '\nもう一度操作するか、Notion側を直接確認して。'
      )]);
    } catch (err2) {
      console.error(err2);
    }
  }
}

/**
 * 操作結果の返信: タスク名入りの確認テキスト + 次の未処理カード。
 * 次が無ければ締めの文面だけ返す。
 */
function replyAction_(replyToken, headline, r) {
  var messages = [];
  if (r.remaining === 0) {
    var closing = r.skipped > 0
      ? '一旦ここまで。スキップした ' + r.skipped + ' 件は、また次の通知で聞くね。'
      : '今日の分は全部さばけた。おつかれ！';
    messages.push(textMessage_(headline + '\n' + closing));
  } else {
    messages.push(textMessage_(headline + '\n残り ' + r.remaining + ' / ' + r.total + ' 件。'));
    messages.push(taskCardMessage_(r.next, r.nextPos, r.total));
  }
  lineReply(replyToken, messages);
}

// ============================================================
// テキストメッセージ
// ============================================================

var LIST_KEYWORDS_RE = /^(リスト|りすと|list|今日|きょう|いま|今|タスク)$/i;
var GREETING_RE = /^(おはよう?|おやすみ|こんにちは|こんばんは|ありがとう?|おつかれ(さま)?|お疲れ(様|さま)?|うん|はい|ok|おけ|りょ(うかい)?|了解|やあ|ういっす|よろしく)[!！～〜。.]?$/i;
var DONE_WORDS_RE = /^(完了|done|終わった|おわった|終わり|おわり|済み?|すんだ|できた|やった)$/i;

/**
 * 延期先の語を日付（yyyy-MM-dd）に解決する。解決できなければ null。
 * 「明日」「明後日」「今週末」「来週」「金曜」など。
 */
function resolveSnoozeDate_(word) {
  if (/^(明日|あした|延期|スヌーズ|パス|あとで)$/i.test(word)) return dateStrOffset_(1);
  if (/^(明後日|あさって)$/.test(word)) return dateStrOffset_(2);
  if (/^(今週末|週末)$/.test(word)) {
    var toSat = 6 - dayOfWeek_();          // 月=1…日=7、土=6
    if (toSat <= 0) toSat += 7;
    return dateStrOffset_(toSat);
  }
  if (/^来週$/.test(word)) {
    return dateStrOffset_(8 - dayOfWeek_()); // 次の月曜
  }
  var m = word.match(/^(月|火|水|木|金|土|日)(曜日?)?$/);
  if (m) {
    var diff = '月火水木金土日'.indexOf(m[1]) + 1 - dayOfWeek_();
    if (diff <= 0) diff += 7;              // 同じ曜日なら来週のその曜日
    return dateStrOffset_(diff);
  }
  return null;
}

function handleText_(ev) {
  var raw = ev.message.text.trim();

  // F-5: 一覧の再送
  if (LIST_KEYWORDS_RE.test(raw)) {
    replyCurrentList_(ev.replyToken);
    return;
  }

  // F-4: 番号による完了/延期。複数番号の一括もここで受ける。
  //   「2」「2完了」「1 3 5」「1,3 終わった」「2 明日」「4 来週」「3 金曜」
  // 番号が文頭のときだけコマンド扱いにする。「牛乳2本買う」はinbox行き。
  var m = normalizeDigits_(raw).match(/^(\d{1,2}(?:[\s,、]+\d{1,2})*)\s*(.*)$/);
  if (m) {
    var nums = m[1].split(/[\s,、]+/).map(function (s) { return parseInt(s, 10); });
    var suffix = m[2].trim();
    if (suffix === '' || DONE_WORDS_RE.test(suffix)) {
      completeByNumbers_(ev.replyToken, nums, null);
      return;
    }
    var snoozeDate = resolveSnoozeDate_(suffix);
    if (snoozeDate) {
      completeByNumbers_(ev.replyToken, nums, snoozeDate);
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

/** 現在の next 一覧（概要テキスト+最初のカード）を返信し、番号対応表を更新する */
function replyCurrentList_(replyToken) {
  var tasks = fetchTodayTasks();
  saveLastList_(tasks);
  if (!tasks.length) {
    lineReply(replyToken, [textMessage_('next は空っぽ。inbox の整理でもする？')]);
    return;
  }
  lineReply(replyToken, [
    textMessage_('今の next:\n\n' + buildListText_(tasks, true)),
    taskCardMessage_(tasks[0], 0, tasks.length),
  ]);
}

/**
 * 番号 → pageId を対応表から引いて、まとめて done / 延期する。
 * @param {?string} snoozeDate 延期先の日付。nullなら完了扱い。
 */
function completeByNumbers_(replyToken, nums, snoozeDate) {
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

  // 番号を全部検証してから実行する（一部だけ処理して残りが失敗、を避ける）
  var bad = nums.filter(function (n) { return n < 1 || n > saved.items.length; });
  if (bad.length) {
    lineReply(replyToken, [textMessage_('番号 ' + bad.join(', ') + ' は無いよ（今は' + saved.items.length + '件）。「リスト」で今の一覧が出せる。')]);
    return;
  }

  // 先に対応表を更新して返信し、Notion更新（件数分の直列HTTP）は後ろに回す
  var lines = [];
  var r = null;
  var uniq = nums.filter(function (n, i) { return nums.indexOf(n) === i; });
  uniq.forEach(function (n) {
    var task = saved.items[n - 1];
    lines.push((snoozeDate ? '⏭ ' : '✅ ') + clip_(task.title, TITLE_CLIP));
    r = updateListState_(task.id, snoozeDate ? 'snoozed' : 'done');
  });

  if (snoozeDate) lines.push('→ ' + snoozeDate + ' にまわした。');
  replyAction_(replyToken, lines.join('\n'), r);

  uniq.forEach(function (n) {
    var task = saved.items[n - 1];
    notionAfterReply_(function () {
      if (snoozeDate) snoozeTaskTo(task.id, snoozeDate);
      else markDone(task.id);
    }, { title: task.title });
  });
}

function usageText_() {
  return '使い方:\n' +
    '・「リスト」→ 今日のタスク一覧（カード付き）\n' +
    '・番号（例: 2 / 1 3 5）→ 完了\n' +
    '・番号+延期先（例: 2 明日 / 4 来週 / 3 金曜）→ 着手日を変更\n' +
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

/**
 * 対応表の該当タスクに状態（done / snoozed / skipped）を付け、
 * 次に出すカードの情報を返す。
 *
 * 項目を削除せず位置を保つことで、送信済み一覧の番号がずっと有効であり続ける
 * （削除して詰めると、ユーザーが見ている番号と内部の番号がズレる）。
 * 次のカードは「操作した位置より後ろ→先頭に戻って」の順で未処理を探す。
 * スキップ済みはこの回では再登場しない。
 *
 * @return {{title:string, remaining:number, skipped:number, total:number,
 *           next:?Object, nextPos:number}}
 */
function updateListState_(pageId, state) {
  var out = { title: '', remaining: 0, skipped: 0, total: 0, next: null, nextPos: -1 };
  withLock_(function () {
    var saved = loadLastList_();
    var pos = -1;
    saved.items.forEach(function (t, i) {
      if (t.id === pageId) {
        t.st = state;
        pos = i;
        out.title = t.title;
      }
    });
    PropertiesService.getScriptProperties().setProperty(
      SP_KEY_LAST_LIST, JSON.stringify(saved)
    );

    out.total = saved.items.length;
    var open = [];
    saved.items.forEach(function (t, i) {
      if (!t.st) open.push(i);
      else if (t.st === 'skipped') out.skipped++;
    });
    out.remaining = open.length;

    var after = open.filter(function (i) { return i > pos; });
    out.nextPos = after.length ? after[0] : (open.length ? open[0] : -1);
    if (out.nextPos >= 0) out.next = saved.items[out.nextPos];
  });
  return out;
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
