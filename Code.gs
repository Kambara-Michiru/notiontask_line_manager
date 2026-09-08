/**
 * LINE × Notion タスクリマインダー
 *
 * 朝：今日やること（status = next）をLINEに通知
 * 夜：「終わった？」とクイックリプライ付きで確認 → タップでNotionを done に更新
 *
 * 対象DB: db_tasks
 *   tasks(title) / status(status) / 優先度(select) / 着手日(date)
 *   Due Date/完了日(date) / db_project(relation) / 近い未来の自分へ(text)
 */

// ============================================================
// 設定
// ============================================================

const SP = PropertiesService.getScriptProperties();

const NOTION_TOKEN = SP.getProperty('NOTION_TOKEN');
const LINE_TOKEN   = SP.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
const MY_USER_ID   = SP.getProperty('LINE_USER_ID');

const DATABASE_ID    = '27e36903-c171-804c-84c2-fc041e4b7fab'; // db_tasks
const NOTION_VERSION = '2022-06-28';
const TZ             = 'Asia/Tokyo';

// プロパティ名（Notion側で変えたらここだけ直す）
const P = {
  title:    'tasks',
  status:   'status',
  priority: '優先度',
  due:      'Due Date/完了日',
  start:    '着手日',
  note:     '近い未来の自分へ',
};

// 完了時に「Due Date/完了日」へ今日の日付を入れるか
const WRITE_COMPLETION_DATE = false;

// ============================================================
// エントリポイント（トリガーから呼ぶ）
// ============================================================

/** 朝：今日やることを通知 */
function pushMorning() {
  const tasks = fetchTodayTasks();

  if (tasks.length === 0) {
    linePush([{ type: 'text', text: 'おはよう。today に上がってるタスクは無いよ。\ninbox を clarify する時間にする？' }]);
    return;
  }

  saveLastList(tasks);

  const lines = tasks.map((t, i) => `${circled(i)} ${t.title}${badge(t)}`);
  const text =
    'おはよう。今日やるやつ:\n\n' +
    lines.join('\n') +
    '\n\nまずどれから？';

  linePush([{ type: 'text', text: text }]);
}

/** 夜：終わった？と聞く（クイックリプライ付き） */
function pushEvening() {
  const tasks = fetchTodayTasks();

  if (tasks.length === 0) {
    linePush([{ type: 'text', text: 'next は空っぽ。今日はおつかれさま。' }]);
    return;
  }

  saveLastList(tasks);

  const lines = tasks.map((t, i) => `${circled(i)} ${t.title}`);
  const text =
    'これ、終わった？\n\n' +
    lines.join('\n') +
    '\n\n終わったやつをタップするか、番号を送って。';

  linePush([withQuickReply({ type: 'text', text: text }, tasks)]);
}

// ============================================================
// LINE Webhook
// ============================================================

function doPost(e) {
  const ok = ContentService.createTextOutput(JSON.stringify({}))
    .setMimeType(ContentService.MimeType.JSON);

  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return ok;
  }

  (body.events || []).forEach(function (ev) {
    try {
      if (ev.type === 'postback') {
        handlePostback(ev);
      } else if (ev.type === 'message' && ev.message.type === 'text') {
        handleText(ev);
      }
    } catch (err) {
      console.error(err);
      if (ev.replyToken) {
        lineReply(ev.replyToken, [{ type: 'text', text: 'エラー: ' + err.message }]);
      }
    }
  });

  return ok;
}

function handlePostback(ev) {
  const data = parseQuery(ev.postback.data);

  if (data.action === 'none') {
    lineReply(ev.replyToken, [{ type: 'text', text: 'りょうかい。明日また聞くね。' }]);
    return;
  }

  if (data.action === 'done' && data.id) {
    markDone(data.id);
    const rest = removeFromLastList(data.id);
    const msg = rest.length === 0
      ? '完了！ 今日の next は全部片付いた。'
      : '完了！ 残り ' + rest.length + ' 件:\n' +
        rest.map(function (t, i) { return circled(i) + ' ' + t.title; }).join('\n');
    lineReply(ev.replyToken, [withQuickReply({ type: 'text', text: msg }, rest)]);
  }
}

function handleText(ev) {
  const raw = ev.message.text.trim();

  // 「リスト」「今日」→ 現在の next を再送
  if (/^(リスト|list|今日|いま|今)$/i.test(raw)) {
    const tasks = fetchTodayTasks();
    saveLastList(tasks);
    const text = tasks.length
      ? tasks.map(function (t, i) { return circled(i) + ' ' + t.title + badge(t); }).join('\n')
      : 'next は空っぽ。';
    lineReply(ev.replyToken, [withQuickReply({ type: 'text', text: text }, tasks)]);
    return;
  }

  // 「1」「1完了」「done 2」「2 終わった」→ その番号を done に
  const m = raw.match(/(\d+)/);
  if (m) {
    const idx = parseInt(m[1], 10) - 1;
    const list = loadLastList();
    if (idx < 0 || idx >= list.length) {
      lineReply(ev.replyToken, [{ type: 'text', text: 'その番号は無いよ。「リスト」で今の一覧が出せる。' }]);
      return;
    }
    const task = list[idx];
    markDone(task.id);
    const rest = removeFromLastList(task.id);
    const msg = '✅ ' + task.title + '\n完了にした。' +
      (rest.length ? '\n\n残り:\n' + rest.map(function (t, i) { return circled(i) + ' ' + t.title; }).join('\n') : '\n全部おわり。おつかれ。');
    lineReply(ev.replyToken, [withQuickReply({ type: 'text', text: msg }, rest)]);
    return;
  }

  // 新規タスクとして inbox に放り込む
  if (raw.length > 1) {
    const url = createInboxTask(raw);
    lineReply(ev.replyToken, [{ type: 'text', text: 'inbox に入れといた:\n' + raw + '\n' + url }]);
    return;
  }

  lineReply(ev.replyToken, [{
    type: 'text',
    text: '使い方:\n・番号を送る → 完了\n・「リスト」→ 今の next\n・それ以外の文 → inbox に追加'
  }]);
}

// ============================================================
// Notion
// ============================================================

function notion(path, method, payload) {
  const res = UrlFetchApp.fetch('https://api.notion.com/v1' + path, {
    method: method,
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + NOTION_TOKEN,
      'Notion-Version': NOTION_VERSION,
    },
    payload: payload ? JSON.stringify(payload) : null,
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 300) {
    throw new Error('Notion ' + code + ': ' + res.getContentText().slice(0, 300));
  }
  return JSON.parse(res.getContentText());
}

/** status = next で、着手日が未設定 or 今日以前のタスク */
function fetchTodayTasks() {
  const body = notion('/databases/' + DATABASE_ID + '/query', 'post', {
    filter: {
      property: P.status,
      status: { equals: 'next' },
    },
    sorts: [{ property: P.due, direction: 'ascending' }],
    page_size: 50,
  });

  const today = todayStr();

  return body.results
    .map(toTask)
    .filter(function (t) { return !t.start || t.start <= today; })
    .slice(0, 12); // クイックリプライは13枠まで
}

function toTask(page) {
  const props = page.properties;
  return {
    id: page.id,
    url: page.url,
    title: plainTitle(props[P.title]),
    priority: props[P.priority] && props[P.priority].select ? props[P.priority].select.name : '',
    due: dateStart(props[P.due]),
    start: dateStart(props[P.start]),
    note: plainText(props[P.note]),
  };
}

function markDone(pageId) {
  const properties = {};
  properties[P.status] = { status: { name: 'done' } };
  if (WRITE_COMPLETION_DATE) {
    properties[P.due] = { date: { start: todayStr() } };
  }
  notion('/pages/' + pageId, 'patch', { properties: properties });
}

function createInboxTask(title) {
  const properties = {};
  properties[P.title]  = { title: [{ text: { content: title } }] };
  properties[P.status] = { status: { name: 'inbox' } };
  const page = notion('/pages', 'post', {
    parent: { database_id: DATABASE_ID },
    properties: properties,
  });
  return page.url;
}

// ============================================================
// LINE API
// ============================================================

/** push: 無料プランは月200通まで（1日2回なら月60通） */
function linePush(messages) {
  lineCall('https://api.line.me/v2/bot/message/push', { to: MY_USER_ID, messages: messages });
}

/** reply: 無料枠にカウントされない。返信は基本こっちを使う */
function lineReply(replyToken, messages) {
  lineCall('https://api.line.me/v2/bot/message/reply', { replyToken: replyToken, messages: messages });
}

function lineCall(url, payload) {
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + LINE_TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) {
    console.error('LINE ' + res.getResponseCode() + ': ' + res.getContentText());
  }
}

/** タスク一覧からクイックリプライボタンを生やす */
function withQuickReply(message, tasks) {
  if (!tasks || tasks.length === 0) return message;

  const items = tasks.slice(0, 12).map(function (t, i) {
    return {
      type: 'action',
      action: {
        type: 'postback',
        label: circled(i) + ' 完了',
        data: 'action=done&id=' + t.id,
        displayText: circled(i) + ' 終わった',
      },
    };
  });

  items.push({
    type: 'action',
    action: { type: 'postback', label: 'まだ', data: 'action=none', displayText: 'まだ残ってる' },
  });

  message.quickReply = { items: items };
  return message;
}

// ============================================================
// 直近リストの保持（番号 → pageId の対応づけ）
// ============================================================

function saveLastList(tasks) {
  const slim = tasks.map(function (t) { return { id: t.id, title: t.title }; });
  SP.setProperty('LAST_LIST', JSON.stringify(slim));
}

function loadLastList() {
  const raw = SP.getProperty('LAST_LIST');
  return raw ? JSON.parse(raw) : [];
}

function removeFromLastList(pageId) {
  const rest = loadLastList().filter(function (t) { return t.id !== pageId; });
  SP.setProperty('LAST_LIST', JSON.stringify(rest));
  return rest;
}

// ============================================================
// ユーティリティ
// ============================================================

function todayStr() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function circled(i) {
  return '①②③④⑤⑥⑦⑧⑨⑩⑪⑫'.charAt(i) || String(i + 1);
}

function badge(t) {
  const parts = [];
  if (t.priority === '高') parts.push('🔥');
  if (t.due && t.due < todayStr()) parts.push('⚠️期限切れ');
  else if (t.due === todayStr()) parts.push('今日締切');
  return parts.length ? ' ' + parts.join(' ') : '';
}

function plainTitle(prop) {
  if (!prop || !prop.title) return '(無題)';
  return prop.title.map(function (r) { return r.plain_text; }).join('') || '(無題)';
}

function plainText(prop) {
  if (!prop || !prop.rich_text) return '';
  return prop.rich_text.map(function (r) { return r.plain_text; }).join('');
}

function dateStart(prop) {
  return prop && prop.date && prop.date.start ? prop.date.start.slice(0, 10) : '';
}

function parseQuery(s) {
  const out = {};
  (s || '').split('&').forEach(function (kv) {
    const p = kv.split('=');
    out[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
  });
  return out;
}

// ============================================================
// セットアップ用（手動で1回実行）
// ============================================================

/** 時間主導トリガーを作る */
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('pushMorning').timeBased().atHour(8).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('pushEvening').timeBased().atHour(21).everyDays(1).inTimezone(TZ).create();
}

/** 接続確認 */
function testConnection() {
  const tasks = fetchTodayTasks();
  console.log('取得 ' + tasks.length + ' 件');
  tasks.forEach(function (t, i) { console.log(circled(i) + ' ' + t.title + badge(t)); });
}
