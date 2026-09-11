/**
 * diagnostics.gs — 「朝と夜に通知が来ない」の原因切り分け
 *
 * GASエディタで diagnose() を1回実行し、実行ログを読む。
 * push を1通も送らないので、LINEの無料枠は消費しない。
 *
 * 定時通知だけが来ない（=返信は動く）ときの原因は、経験上この4つに絞られる:
 *   1. トリガーが無い    … デプロイしてもトリガーは作られない。setupTriggers() の実行が別途必要
 *   2. LINE_USER_ID      … pushだけが要求する値。未設定/誤りでもreplyは正常に動くので気づけない
 *   3. 無料枠の枯渇      … push だけ 429 で弾かれる。これもreplyは動き続ける
 *   4. ジョブ内の例外    … トリガーは起動しているが Notion 側などで落ちている
 * diagnose() はこの4つを順に潰す。
 */

function diagnose() {
  var out = [
    '================================',
    ' 定時通知 自己診断 ' + fmtTime_(Date.now()),
    '================================',
    '',
    checkTriggers_(),
    '',
    checkRunLog_(),
    '',
    checkSecrets_(),
    '',
    checkLine_(),
    '',
    checkNotion_(),
    '',
  ].join('\n');

  console.log(out);
  return out;
}

// ------------------------------------------------------------
// 1. トリガー
// ------------------------------------------------------------

var EXPECTED_JOBS = ['pushMorning', 'pushEvening'];

function checkTriggers_() {
  var lines = ['【1】時間主導トリガー'];
  var clock = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getEventType() === ScriptApp.EventType.CLOCK;
  });

  if (!clock.length) {
    lines.push('  ❌ トリガーが1つも無い。これが原因。');
    lines.push('     ウェブアプリの「デプロイ」ではトリガーは作られません。');
    lines.push('     → GASエディタで setupTriggers() を1回実行してください。');
    return lines.join('\n');
  }

  var counts = {};
  clock.forEach(function (t) {
    var fn = t.getHandlerFunction();
    counts[fn] = (counts[fn] || 0) + 1;
  });

  EXPECTED_JOBS.forEach(function (fn) {
    if (!counts[fn]) {
      lines.push('  ❌ ' + fn + ' のトリガーが無い → setupTriggers() を実行');
    } else if (counts[fn] > 1) {
      lines.push('  ⚠️ ' + fn + ' のトリガーが ' + counts[fn] + ' 個ある（通知が重複します）');
      lines.push('     → setupTriggers() を実行すると1個に戻ります');
    } else {
      lines.push('  ✅ ' + fn + ' のトリガーあり');
    }
  });

  Object.keys(counts).forEach(function (fn) {
    if (EXPECTED_JOBS.indexOf(fn) === -1) {
      lines.push('  ⚠️ 見覚えのないトリガー: ' + fn);
    }
  });

  lines.push('  （実行時刻はGASの仕様で指定した時台の中でずれます。8時なら8:00〜9:00の間）');
  return lines.join('\n');
}

// ------------------------------------------------------------
// 2. 最終実行記録 — 「起動していない」と「起動して失敗した」の区別
// ------------------------------------------------------------

function checkRunLog_() {
  var lines = ['【2】定時ジョブの最終実行'];
  var log = loadRunLog_();

  EXPECTED_JOBS.forEach(function (fn) {
    var r = log[fn];
    if (!r) {
      lines.push('  ― ' + fn + ': 実行記録なし');
      lines.push('     （トリガーが起動していないか、記録機能の追加より前の実行しかない）');
      return;
    }
    var age = Math.floor((Date.now() - r.at) / (60 * 60 * 1000));
    var head = (r.ok ? '  ✅ ' : '  ❌ ') + fn + ': ' + fmtTime_(r.at) +
      '（' + age + '時間前）' + (r.ok ? ' 成功 ' : ' 失敗 ') + r.note;
    lines.push(head);
    if (!r.ok) {
      lines.push('     → トリガー自体は動いています。上のエラー内容が原因です。');
    } else if (age > 30) {
      lines.push('     → 最後の成功から1日以上あいています。トリガーが止まった可能性。');
    }
  });

  return lines.join('\n');
}

// ------------------------------------------------------------
// 3. スクリプトプロパティ
// ------------------------------------------------------------

function checkSecrets_() {
  var lines = ['【3】スクリプトプロパティ'];

  REQUIRED_SECRETS.forEach(function (key) {
    var raw = peekSecret_(key);
    if (!raw) {
      lines.push('  ❌ ' + key + ' が未設定');
      return;
    }
    var v = raw.trim();
    lines.push('  ✅ ' + key + ' = ' + mask_(v));
    if (raw !== v) {
      lines.push('     ⚠️ 前後に空白/改行が入っています（コードはtrimして使うので実害はなし）');
    }
  });

  // LINE_USER_ID は push 専用。ここが違うと「返信は動くのに定時通知だけ来ない」になる。
  var uid = peekSecret_('LINE_USER_ID').trim();
  if (uid) {
    if (/^U[0-9a-f]{32}$/i.test(uid)) {
      lines.push('  ✅ LINE_USER_ID の形式OK');
    } else {
      lines.push('  ❌ LINE_USER_ID の形式が不正 → これが原因の可能性大');
      if (uid.charAt(0) === '@') {
        lines.push('     「@」で始まっています。これはベーシックID（友だち追加用）で、pushには使えません。');
      } else if (uid.charAt(0).toUpperCase() !== 'U') {
        lines.push('     「U」で始まっていません。LINE IDや表示名ではなくユーザーIDが必要です。');
      } else {
        lines.push('     U + 英数字32桁が必要です（現在 ' + uid.length + ' 文字）。');
      }
      lines.push('     → LINE Developersコンソール > チャネル基本設定 > 下部の「あなたのユーザーID」');
      lines.push('     ※ この値は push だけが使うので、誤っていても返信（reply）は正常に動きます。');
    }
  }

  return lines.join('\n');
}

// ------------------------------------------------------------
// 4. LINE側（トークンの有効性と無料枠の残量）
// ------------------------------------------------------------

function checkLine_() {
  var lines = ['【4】LINE Messaging API（pushは送らないので無料枠は減りません）'];

  try {
    var info = lineGet_('/v2/bot/info');
    if (info.code === 200) {
      lines.push('  ✅ チャネルアクセストークン有効（Bot: ' + (info.body.displayName || '?') + '）');
    } else if (info.code === 401) {
      lines.push('  ❌ トークンが無効か失効している（401）→ LINE_CHANNEL_ACCESS_TOKEN を再発行');
      return lines.join('\n');
    } else {
      lines.push('  ⚠️ /v2/bot/info が ' + info.code + ': ' + JSON.stringify(info.body).slice(0, 200));
    }

    var quota = lineGet_('/v2/bot/message/quota');
    var used = lineGet_('/v2/bot/message/quota/consumption');
    var usedN = Number((used.body && used.body.totalUsage) || 0);

    if (quota.code === 200 && quota.body.type === 'limited') {
      var limit = Number(quota.body.value || 0);
      var left = limit - usedN;
      var mark = left <= 0 ? '  ❌ ' : (left < 20 ? '  ⚠️ ' : '  ✅ ');
      lines.push(mark + '今月のpush: ' + usedN + ' / ' + limit + ' 通（残り ' + left + ' 通）');
      if (left <= 0) {
        lines.push('     無料枠を使い切っています。これが原因です。');
        lines.push('     pushだけが429で弾かれ、返信（reply）は無料なので動き続けます。');
        lines.push('     → 来月まで待つか、プランを見直してください。');
      }
    } else if (quota.code === 200) {
      lines.push('  ✅ push上限なし（今月の利用 ' + usedN + ' 通）');
    } else {
      lines.push('  ⚠️ 送信上限の取得に失敗（' + quota.code + '）');
    }
  } catch (err) {
    lines.push('  ❌ LINEへの問い合わせに失敗: ' + (err && err.message ? err.message : err));
  }

  return lines.join('\n');
}

// ------------------------------------------------------------
// 5. Notion側
// ------------------------------------------------------------

function checkNotion_() {
  var lines = ['【5】Notion'];
  try {
    var tasks = fetchTodayTasks();
    lines.push('  ✅ 接続OK。今日通知対象になるタスク: ' + tasks.length + ' 件');
    tasks.slice(0, 5).forEach(function (t, i) {
      lines.push('     ' + circled_(i) + ' ' + clip_(t.title, TITLE_CLIP) + badge_(t));
    });
    if (tasks.length === 0) {
      lines.push('     ※ 0件でも通知自体は「next は空っぽ」という文面で届きます。');
      lines.push('       0件だから来ない、ということはありません。');
    }
  } catch (err) {
    lines.push('  ❌ ' + (err && err.message ? err.message : err));
    lines.push('     → 404なら db_tasks の「…」>「接続」でインテグレーションを接続してください。');
  }
  return lines.join('\n');
}
