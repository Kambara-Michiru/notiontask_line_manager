/**
 * jobs.gs — 定時ジョブ（トリガーから呼ばれる）
 *
 * pushはここからだけ送る（無料枠対策。1日2回 ≒ 月60通）。
 */

/** F-1: 朝8時 — 今日やることを通知 */
function pushMorning() {
  var tasks = fetchTodayTasks();

  if (tasks.length === 0) {
    linePush([textMessage_('おはよう。今日の next は空っぽ。\ninbox を clarify する時間にする？')]);
    return;
  }

  saveLastList_(tasks);

  var text = 'おはよう。今日やるやつ:\n\n' +
    buildListText_(tasks, true) +
    '\n\nまずどれから？';

  linePush([textMessage_(text)]);
}

/** F-2: 夜21時 — 終わった？とクイックリプライ付きで確認 */
function pushEvening() {
  var tasks = fetchTodayTasks();

  if (tasks.length === 0) {
    linePush([textMessage_('next は空っぽ。今日はおつかれさま。')]);
    return;
  }

  saveLastList_(tasks);

  var text = 'これ、終わった？\n\n' +
    buildListText_(tasks, false) +
    '\n\n終わったやつをタップするか、番号を送って。\n（番号+「明日」で明日にまわせるよ）';

  linePush([withQuickReply_(textMessage_(text), tasks)]);
}
