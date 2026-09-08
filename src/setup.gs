/**
 * setup.gs — セットアップ・動作確認用（GASエディタから手動実行する）
 */

/**
 * F-7: 時間主導トリガーを作り直す。
 * 既存トリガーを全削除してから作るので、何度実行しても重複しない（べき等）。
 */
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('pushMorning')
    .timeBased().atHour(8).everyDays(1).inTimezone(TZ).create();

  ScriptApp.newTrigger('pushEvening')
    .timeBased().atHour(21).everyDays(1).inTimezone(TZ).create();

  console.log('トリガーを設定した: pushMorning(8時) / pushEvening(21時)');
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
