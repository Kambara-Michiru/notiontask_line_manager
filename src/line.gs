/**
 * line.gs — LINE Messaging APIラッパ
 *
 * push は定時通知専用（無料枠 月200通を消費）。ユーザーへの応答は必ず reply を使う。
 */

/**
 * 定時通知の送信。
 *
 * LINEに弾かれたら例外を投げる。ここを握り潰すと「通知が届かないのに
 * 実行は成功扱い」になり、原因不明の無反応障害になる（実際にやらかした）。
 * 呼び出し元の runJob_ が記録し、diagnose() から見えるようにする。
 */
function linePush(messages) {
  var r = lineSend_('https://api.line.me/v2/bot/message/push', { to: lineUserId_() }, messages);
  if (r.code >= 300) {
    throw new Error('LINEへのpushに失敗（HTTP ' + r.code + '）。' + pushHint_(r) +
      ' 応答: ' + r.text.slice(0, 200));
  }
}

/**
 * ユーザーへの応答。
 *
 * pushと違い失敗しても投げない。replyTokenは1回限りで再送できず、
 * ここで投げるとWebhook側のエラー処理がさらにreplyを試みて二重に失敗するため。
 */
function lineReply(replyToken, messages) {
  lineSend_('https://api.line.me/v2/bot/message/reply', { replyToken: replyToken }, messages);
}

/** HTTPコードから、実際に効く対処を1行で返す */
function pushHint_(r) {
  if (r.code === 429) {
    return '無料枠（月200通）を使い切った可能性が高い。diagnose() で残量を確認して。';
  }
  if (r.code === 400 && r.text.indexOf('to') !== -1) {
    return 'LINE_USER_ID が宛先として無効。「U+英数字32桁」のユーザーIDか確認して。';
  }
  if (r.code === 401) {
    return 'LINE_CHANNEL_ACCESS_TOKEN が無効か失効している。再発行して設定し直して。';
  }
  if (r.code === 403) {
    return 'このユーザーへの送信が許可されていない。Botを友だち追加しているか、' +
      'ブロックしていないか確認して。';
  }
  return 'GASの実行ログに応答本文が出ている。';
}

/**
 * 送信し、失敗（Flexの組み立て不備等で400）ならテキストだけで1回再送する。
 * これが無いと、LINE側に弾かれたとき「無反応に見える」障害になる。
 *
 * @return {{code:number, text:string}} 最後に試みた送信の結果
 */
function lineSend_(url, base, messages) {
  var payload = { messages: messages };
  Object.keys(base).forEach(function (k) { payload[k] = base[k]; });
  var r = lineCall_(url, payload);
  if (r.code < 300) return r;

  var fallback = messages
    .map(function (m) { return m.text || m.altText || ''; })
    .filter(String)
    .join('\n');
  payload.messages = [textMessage_(
    (fallback || '処理はしたけど返信の組み立てに失敗した。') +
    '\n（カード表示に失敗したのでテキストで送ってる。詳細はGASのログ）'
  )];
  return lineCall_(url, payload);
}

/** @return {{code:number, text:string}} */
function lineCall_(url, payload) {
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + lineToken_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code >= 300) {
    // replyToken切れ等はここで握りつぶさずログに残す（Webhook自体は落とさない）
    console.error('LINE API ' + code + ': ' + text);
  }
  return { code: code, text: text };
}

/**
 * LINE APIのGET（診断用）。pushを伴わないので無料枠を消費しない。
 * @return {{code:number, body:Object}} bodyはJSONでなければ {}
 */
function lineGet_(path) {
  var res = UrlFetchApp.fetch('https://api.line.me' + path, {
    method: 'get',
    headers: { 'Authorization': 'Bearer ' + lineToken_() },
    muteHttpExceptions: true,
  });
  var text = res.getContentText();
  var body = {};
  try { body = JSON.parse(text); } catch (err) { body = { raw: text }; }
  return { code: res.getResponseCode(), body: body };
}

function textMessage_(text) {
  return { type: 'text', text: clip_(text, TEXT_LIMIT) };
}

/**
 * タスクカード（Flex Message、1枚だけ）を組み立てる。
 *
 * 逐次処理型: カードは常に1枚ずつ送り、操作すると確認+次のカードが返る。
 * LINEは送信済みメッセージを編集・削除できないため、「常に一番下の
 * 最新カードだけを触ればいい」構造にすることで古いカード問題を避ける。
 *
 * @param {{id:string,title:string,priority:string,due:string}} t
 * @param {number} pos 一覧内の位置（0始まり。番号コマンドと同じ並び）
 * @param {number} total 一覧の総数
 */
function taskCardMessage_(t, pos, total) {
  var body = [
    { type: 'text', text: (pos + 1) + ' / ' + total, size: 'xs', color: '#999999' },
    { type: 'text', text: clip_(t.title, 100), weight: 'bold', size: 'sm', wrap: true },
  ];
  var b = badge_(t);
  if (b) {
    body.push({ type: 'text', text: b.trim(), size: 'xs', color: '#D85A30', wrap: true });
  }

  var picker = tomorrowStr_();
  var ref = '&id=' + t.id + '&pos=' + pos;
  return {
    type: 'flex',
    altText: 'タスク ' + (pos + 1) + '/' + total + ': ' + clip_(t.title, 40),
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button', style: 'primary', height: 'sm',
            action: {
              type: 'postback',
              label: '✅ 完了にする',
              data: 'action=done' + ref,
              displayText: '「' + clip_(t.title, 20) + '」終わった',
            },
          },
          {
            type: 'button', style: 'secondary', height: 'sm',
            action: {
              type: 'postback',
              label: '⏭ 明日へ',
              data: 'action=snooze' + ref,
              displayText: '「' + clip_(t.title, 20) + '」は明日',
            },
          },
          {
            type: 'button', style: 'secondary', height: 'sm',
            action: {
              type: 'datetimepicker',
              label: '📅 日付を選んで延期',
              data: 'action=snooze_pick' + ref,
              mode: 'date',
              initial: picker,
              min: picker,
            },
          },
          {
            type: 'button', style: 'link', height: 'sm',
            action: {
              type: 'postback',
              label: '⏩ スキップ（あとで判断）',
              data: 'action=skip' + ref,
              displayText: 'スキップ',
            },
          },
        ],
      },
    },
  };
}

/** 番号付き一覧テキストを組み立てる */
function buildListText_(tasks, withBadge) {
  return tasks.map(function (t, i) {
    var line = circled_(i) + ' ' + clip_(t.title, TITLE_CLIP);
    if (withBadge) line += badge_(t);
    return line;
  }).join('\n');
}

function badge_(t) {
  var parts = [];
  if (t.priority === PRIORITY_HIGH) parts.push('🔥');
  var today = todayStr_();
  if (t.due && t.due < today) parts.push('⚠️期限切れ');
  else if (t.due === today) parts.push('📅今日締切');
  return parts.length ? ' ' + parts.join(' ') : '';
}
