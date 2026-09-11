/**
 * jobs.gs — 定時ジョブ（トリガーから呼ばれる）
 *
 * pushはここからだけ送る（無料枠対策。1日2回 ≒ 月60通）。
 *
 * トリガー実行は画面が無いので、失敗しても気づけない。
 * runJob_ で実行結果をスクリプトプロパティに残し、diagnose() から
 * 「そもそも起動していない」のか「起動したが失敗した」のかを見分けられるようにする。
 */

/** F-1: 朝8時 — 今日やることを通知 */
function pushMorning() {
  runJob_('pushMorning', function () {
    var tasks = fetchTodayTasks();

    if (tasks.length === 0) {
      linePush([textMessage_('おはよう。今日の next は空っぽ。\ninbox を clarify する時間にする？')]);
      return '0件（空っぽ通知）';
    }

    saveLastList_(tasks);

    var text = 'おはよう。今日やるやつ:\n\n' +
      buildListText_(tasks, true) +
      '\n\nまずどれから？';

    linePush([textMessage_(text)]);
    return tasks.length + '件';
  });
}

/**
 * F-2: 夜21時 — 終わった？と確認
 *
 * 概要テキスト + 最初の1枚のカードの2通で送る
 * （1回のpushにまとめれば無料枠の消費は1通分）。
 * カードを操作すると、確認と次のカードが返ってくる逐次処理型。
 */
function pushEvening() {
  runJob_('pushEvening', function () {
    var tasks = fetchTodayTasks();

    if (tasks.length === 0) {
      linePush([textMessage_('next は空っぽ。今日はおつかれさま。')]);
      return '0件（空っぽ通知）';
    }

    saveLastList_(tasks);

    linePush([
      textMessage_('これ、終わった？ 1件ずつ聞くね。\n\n' + buildListText_(tasks, false) +
        '\n\nカードのボタンで返すか、番号でも操作できるよ（「1 3 5」でまとめて完了、「2 来週」で延期）。'),
      taskCardMessage_(tasks[0], 0, tasks.length),
    ]);
    return tasks.length + '件';
  });
}

/**
 * ジョブを実行し、結果（成功/失敗と時刻）を記録する。
 * 例外は握り潰さず再throwする（GASの実行履歴にも失敗として残すため）。
 */
function runJob_(name, fn) {
  try {
    var note = fn();
    recordRun_(name, true, note || '');
    console.log(name + ' 成功: ' + (note || ''));
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    recordRun_(name, false, msg);
    console.error(name + ' 失敗: ' + (err && err.stack ? err.stack : msg));
    throw err;
  }
}

/** 最終実行記録を書く（ジョブ名ごとに1件だけ保持） */
function recordRun_(name, ok, note) {
  try {
    var sp = PropertiesService.getScriptProperties();
    var all = loadRunLog_();
    all[name] = { at: Date.now(), ok: ok, note: String(note).slice(0, 300) };
    sp.setProperty(SP_KEY_LAST_RUN, JSON.stringify(all));
  } catch (err) {
    // 記録に失敗しても本体の通知は止めない
    console.error('実行記録の保存に失敗: ' + err);
  }
}

/** @return {Object<string, {at:number, ok:boolean, note:string}>} */
function loadRunLog_() {
  var raw = PropertiesService.getScriptProperties().getProperty(SP_KEY_LAST_RUN);
  if (!raw) return {};
  try {
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}
