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

/**
 * F-2: 夜21時 — 終わった？と確認
 *
 * 概要テキスト + 最初の1枚のカードの2通で送る
 * （1回のpushにまとめれば無料枠の消費は1通分）。
 * カードを操作すると、確認と次のカードが返ってくる逐次処理型。
 */
function pushEvening() {
  var tasks = fetchTodayTasks();

  if (tasks.length === 0) {
    linePush([textMessage_('next は空っぽ。今日はおつかれさま。')]);
    return;
  }

  saveLastList_(tasks);

  linePush([
    textMessage_('これ、終わった？ 1件ずつ聞くね。\n\n' + buildListText_(tasks, false) +
      '\n\nカードのボタンで返すか、番号でも操作できるよ（「1 3 5」でまとめて完了、「2 来週」で延期）。'),
    taskCardMessage_(tasks[0], 0, tasks.length),
  ]);
}
