/**
 * setup.gs — セットアップ・動作確認用（GASエディタから手動実行する）
 *
 * 通知が来ないときは、まず diagnose()（src/diagnostics.gs）を実行する。
 */

var MORNING_HOUR = 8;
var EVENING_HOUR = 21;

/**
 * F-7: 時間主導トリガーを作り直す。
 * 既存トリガーを全削除してから作るので、何度実行しても重複しない（べき等）。
 *
 * ※ ウェブアプリの「デプロイ」ではトリガーは作られない。この関数の実行が別途必要。
 */
function setupTriggers() {
  var removed = ScriptApp.getProjectTriggers();
  removed.forEach(function (t) {
    ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('pushMorning')
    .timeBased().atHour(MORNING_HOUR).everyDays(1).inTimezone(TZ).create();

  ScriptApp.newTrigger('pushEvening')
    .timeBased().atHour(EVENING_HOUR).everyDays(1).inTimezone(TZ).create();

  console.log('既存トリガーを ' + removed.length + ' 件削除して作り直した。');
  console.log(showTriggers());
}

/** 現在のトリガー一覧をログに出す（設定できているかの確認用） */
function showTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  if (!triggers.length) {
    var msg = 'トリガーは0件。setupTriggers() を実行してください。';
    console.log(msg);
    return msg;
  }
  var out = triggers.map(function (t) {
    return '- ' + t.getHandlerFunction() + '（' + t.getEventType() + '）';
  }).join('\n');
  var text = '現在のトリガー ' + triggers.length + ' 件:\n' + out +
    '\n※ 実行時刻はGASの仕様で指定した時台の中でずれます（8時指定なら8:00〜9:00）。';
  console.log(text);
  return text;
}

/** F-7: Notion疎通確認 — next のタスクをログに出すだけ */
function testConnection() {
  var tasks = fetchTodayTasks();
  console.log('取得 ' + tasks.length + ' 件');
  tasks.forEach(function (t, i) {
    console.log(circled_(i) + ' ' + t.title + badge_(t) +
      (t.start ? ' [着手日 ' + t.start + ']' : '') +
      (t.due ? ' [締切 ' + t.due + ']' : ''));
  });
}

/** LINE疎通確認 — 自分に1通pushする（無料枠を1通消費する点に注意） */
function testLinePush() {
  linePush([textMessage_('疎通テスト: このメッセージが見えていればLINE側はOK。')]);
  console.log('pushした。LINEを確認して。');
}

/** 一連の流れの確認 — 朝通知を今すぐ送る */
function testMorning() {
  pushMorning();
}

/** 夜通知（クイックリプライ付き）を今すぐ送る */
function testEvening() {
  pushEvening();
}
