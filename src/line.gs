/**
 * line.gs — LINE Messaging APIラッパ
 *
 * push は定時通知専用（無料枠 月200通を消費）。ユーザーへの応答は必ず reply を使う。
 */

function linePush(messages) {
  lineCall_('https://api.line.me/v2/bot/message/push', {
    to: lineUserId_(),
    messages: messages,
  });
}

function lineReply(replyToken, messages) {
  lineCall_('https://api.line.me/v2/bot/message/reply', {
    replyToken: replyToken,
    messages: messages,
  });
}

function lineCall_(url, payload) {
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + lineToken_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) {
    // replyToken切れ等はここで握りつぶさずログに残す（Webhook自体は落とさない）
    console.error('LINE API ' + res.getResponseCode() + ': ' + res.getContentText());
  }
}

function textMessage_(text) {
  return { type: 'text', text: clip_(text, TEXT_LIMIT) };
}

/**
 * タスク一覧に応じたクイックリプライを message に付けて返す。
 *
 * 枠の使い方（上限13）:
 *   - 6件以下: 各タスクに「完了」「明日」の2ボタン（最大12）+「まだ」= 13
 *   - 7件以上: 各タスクに「完了」のみ（最大12）+「まだ」= 13
 */
function withQuickReply_(message, tasks) {
  if (!tasks || tasks.length === 0) return message;

  var dual = tasks.length <= DUAL_BUTTON_MAX;
  var items = [];

  tasks.forEach(function (t, i) {
    items.push({
      type: 'action',
      action: {
        type: 'postback',
        label: circled_(i) + ' 完了',
        data: 'action=done&id=' + t.id,
        displayText: circled_(i) + ' 終わった',
      },
    });
    if (dual) {
      items.push({
        type: 'action',
        action: {
          type: 'postback',
          label: circled_(i) + ' 明日',
          data: 'action=snooze&id=' + t.id,
          displayText: circled_(i) + ' 明日にする',
        },
      });
    }
  });

  items.push({
    type: 'action',
    action: {
      type: 'postback',
      label: 'まだ',
      data: 'action=none',
      displayText: 'まだ残ってる',
    },
  });

  message.quickReply = { items: items };
  return message;
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
