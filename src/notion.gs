/**
 * notion.gs — Notion APIラッパ
 *
 * query（今日のタスク取得）/ markDone / snooze / createInbox
 */

function notionFetch_(path, method, payload) {
  var res = UrlFetchApp.fetch('https://api.notion.com/v1' + path, {
    method: method,
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + notionToken_(),
      'Notion-Version': NOTION_VERSION,
    },
    payload: payload ? JSON.stringify(payload) : null,
    muteHttpExceptions: true,
  });

  var code = res.getResponseCode();
  if (code >= 300) {
    var hint = '';
    if (code === 404) {
      hint = '（404はDB側でインテグレーションが「接続」されていない場合にも出ます）';
    }
    throw new Error('Notion API ' + code + hint + ': ' + res.getContentText().slice(0, 300));
  }
  return JSON.parse(res.getContentText());
}

/**
 * status = next かつ「着手日が未設定 or 今日以前」のタスクを
 * Due Date昇順で最大 MAX_TASKS 件返す。
 */
function fetchTodayTasks() {
  var body = notionFetch_('/databases/' + NOTION_DATABASE_ID + '/query', 'post', {
    filter: { property: PROP.status, status: { equals: STATUS.next } },
    sorts: [{ property: PROP.due, direction: 'ascending' }],
    page_size: 100,
  });

  var today = todayStr_();
  return body.results
    .map(toTask_)
    .filter(function (t) { return !t.start || t.start <= today; })
    .slice(0, MAX_TASKS);
}

function toTask_(page) {
  var props = page.properties;
  return {
    id: page.id,
    url: page.url,
    title: plainTitle_(props[PROP.title]),
    priority: props[PROP.priority] && props[PROP.priority].select
      ? props[PROP.priority].select.name : '',
    due: dateStart_(props[PROP.due]),
    start: dateStart_(props[PROP.start]),
  };
}

/** status を done に更新（すでにdoneでも壊れない） */
function markDone(pageId) {
  var properties = {};
  properties[PROP.status] = { status: { name: STATUS.done } };
  notionFetch_('/pages/' + pageId, 'patch', { properties: properties });
}

/** 着手日を明日にずらす（statusは next のまま） */
function snoozeTask(pageId) {
  snoozeTaskTo(pageId, tomorrowStr_());
}

/** 着手日を指定日（yyyy-MM-dd）にずらす */
function snoozeTaskTo(pageId, dateStr) {
  var properties = {};
  properties[PROP.start] = { date: { start: dateStr } };
  notionFetch_('/pages/' + pageId, 'patch', { properties: properties });
}

/** テキストを status = inbox の新規ページとして作成し、URLを返す */
function createInboxTask(title) {
  var properties = {};
  properties[PROP.title] = { title: [{ text: { content: title } }] };
  properties[PROP.status] = { status: { name: STATUS.inbox } };
  var page = notionFetch_('/pages', 'post', {
    parent: { database_id: NOTION_DATABASE_ID },
    properties: properties,
  });
  return page.url;
}

// ---- プロパティ取り出しヘルパ ----

function plainTitle_(prop) {
  if (!prop || !prop.title) return '(無題)';
  var s = prop.title.map(function (r) { return r.plain_text; }).join('');
  // タイトル内の改行は一覧の番号対応を崩すのでスペースに潰す
  return s.replace(/\s+/g, ' ').trim() || '(無題)';
}

function dateStart_(prop) {
  return prop && prop.date && prop.date.start ? prop.date.start.slice(0, 10) : '';
}
