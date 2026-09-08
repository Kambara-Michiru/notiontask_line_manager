# LINE × Notion タスクリマインダー 実装指示書

## 0. この文書について

Google Apps Script (GAS) で動く個人用タスクリマインダーBotを作る。
同梱の `Code.gs` は動作**未検証**のプロトタイプ。API呼び出しの形は参考にしてよいが、
そのまま採用せず、この指示書の要件に沿って書き直すこと。

利用者は1人（作者本人）のみ。マルチユーザー対応は不要。

---

## 1. ゴール

Notionに溜まっているタスクを、LINEのトーク画面で「声をかけられて、返事したら片付く」状態にする。

- 朝、今日やるタスクがLINEに届く
- 夜、「終わった？」と聞かれる
- ボタンか番号で返事すると Notion 側が `done` に変わる
- 思いついたことをLINEに投げると Notion の `inbox` に入る

Notionを開かずに一日のタスクが回ることをもって完成とする。

---

## 2. 技術スタック / 制約

| 項目 | 内容 |
|---|---|
| 実行環境 | Google Apps Script (V8ランタイム) |
| ローカル管理 | `clasp` を使う。`clasp push` でデプロイできる状態にする |
| 言語 | 素のJavaScript。TypeScriptは使わない（ビルド工程を増やしたくない） |
| 外部ライブラリ | **使用禁止**。GASの `UrlFetchApp` / `PropertiesService` / `ScriptApp` / `Utilities` のみで完結させる |
| テスト | GAS上で手動実行する検証関数を用意する（自動テストフレームワークは導入しない） |

### 秘密情報の扱い

以下はすべて `PropertiesService.getScriptProperties()` から読む。**コードへのハードコード禁止**。

- `NOTION_TOKEN`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_USER_ID`

値そのものは人間が GASコンソールで手入力する。Claude Code は値を知る必要がないし、
リポジトリ内のどのファイルにも書かない。`.claspignore` と `.gitignore` を用意し、
`.clasp.json` に含まれるスクリプトIDもコミットしない。

---

## 3. 対象Notionデータベース（確定情報）

**db_tasks**

- Database ID: `27e36903-c171-804c-84c2-fc041e4b7fab`
- Data Source ID: `27e36903-c171-80c4-8df1-000b5061969a`（新API版を使う場合のみ必要）

| プロパティ名 | 型 | 値 / 備考 |
|---|---|---|
| `tasks` | title | タスク名 |
| `status` | status | `inbox` / `someday/maybe` / `next` / `waiting` / `done` / `trash` |
| `優先度` | select | `低` / `中` / `高` |
| `着手日` | date | いつ手をつけるか |
| `Due Date/完了日` | date | 締切。完了時の記録にも使う |
| `db_project` | relation | → db_project (`27a36903-c171-8042-830c-000be524419e`) |
| `書類か？` | select | `document` |
| `近い未来の自分へ` | text | 未来の自分向けのメモ |

プロパティ名は日本語やスラッシュを含む。コード中に文字列リテラルを散らさず、
**先頭のマッピング定数1箇所に集約**すること（Notion側で名前を変えたときの修正点を1つにする）。

GTD運用なので、「今日やるもの」の定義は `status = next` とする。

---

## 4. 外部API仕様

### 4.1 Notion API

`Notion-Version: 2022-06-28` を使う。

- 取得: `POST https://api.notion.com/v1/databases/{database_id}/query`
- 更新: `PATCH https://api.notion.com/v1/pages/{page_id}`
- 作成: `POST https://api.notion.com/v1/pages`

status型のフィルタとプロパティ更新は専用の形をとる。ここを `select` と間違えると400が返る。

```json
// filter
{ "property": "status", "status": { "equals": "next" } }

// update
{ "properties": { "status": { "status": { "name": "done" } } } }
```

**注意**: 新しいAPIバージョン (`2025-09-03`) では database ではなく data source を叩く形に変わっている。
今回は安定している `2022-06-28` を採用するが、バージョン文字列は定数に切り出しておくこと。

### 4.2 LINE Messaging API

- push: `POST https://api.line.me/v2/bot/message/push` — **無料枠 月200通を消費する**
- reply: `POST https://api.line.me/v2/bot/message/reply` — **無料枠を消費しない**
- Webhook: GASのウェブアプリURL (`/exec`) に `doPost` で受ける

制約:

- クイックリプライは1メッセージにつき最大13個、ラベルは20文字以内
- replyToken は1回きり、有効期限は短い
- Webhookのレスポンスは即座に200を返す必要がある

**設計上の含意**: ユーザーからの入力に対する応答はすべて reply を使い、push は
定時通知（1日2回）だけに限定する。これで月の消費を60通程度に抑える。

---

## 5. 機能要件

### F-1 朝の通知（push）

毎朝8時に実行。

- `status = next` かつ「`着手日` が未設定 または 今日以前」のタスクを取得
- `Due Date/完了日` の昇順、最大12件
- 番号（①②③…）付きの一覧としてLINEにpush
- `優先度 = 高` には 🔥、期限超過には ⚠️、今日締切にはその旨を付ける
- 0件のときは、その旨と `inbox` の整理を促す一言を送る（空リストを送らない）

### F-2 夜の確認（push + クイックリプライ）

毎晩21時に実行。

- F-1 と同じ条件で取得
- 一覧に加えて、各タスクに対応する完了ボタンをクイックリプライで付ける
- ボタンの postback data は `action=done&id={pageId}` 形式
- 「まだ残ってる」用の `action=none` ボタンも1つ付ける

### F-3 完了処理（postback）

- `action=done` を受けたら該当ページの `status` を `done` に更新
- 更新後、残りタスクの一覧を reply で返す（残りにもクイックリプライを付け直す）
- 全部終わったら、その旨を返す
- `action=none` のときは何も更新せず、短い返事だけ返す

### F-4 番号による完了（テキスト）

ボタンではなく「1」「2完了」「3 終わった」のようなテキストでも完了できる。

- 直近に送った一覧の「番号 → pageId」の対応を `ScriptProperties` に保持する
- 範囲外の番号には、その旨と再取得の方法を返す
- 実装は F-3 と共通の処理に寄せる

### F-5 一覧の再送

「リスト」「今日」などのキーワードで、現時点の `next` 一覧を reply で返す。
番号の対応表もこのタイミングで更新する。

### F-6 inbox への追加

上記のいずれにも当てはまらないテキストを受け取ったら、それをタイトルとして
`status = inbox` の新規ページを db_tasks に作成し、作成したページのURLを返す。

### F-7 セットアップ用関数

- `setupTriggers()` — 既存トリガーを全削除してから、朝夜2つの時間主導トリガーを作り直す（べき等に）
- `testConnection()` — Notionから取得した結果をログに出すだけの疎通確認用

---

## 6. 非機能要件

- **タイムゾーン**: 日付計算はすべて `Asia/Tokyo` 固定。`appsscript.json` の `timeZone` も合わせる
- **エラー処理**: `doPost` 内の例外でWebhook全体を落とさない。イベント単位で try/catch し、
  replyToken があればエラー内容を短く返す。無くてもログには残す
- **HTTPエラー**: `UrlFetchApp` は `muteHttpExceptions: true` で呼び、ステータスコードを自分で見る。
  Notionの4xx/5xxはレスポンスボディを含めて投げる（原因が分からないと直せないため）
- **文字数**: LINEのテキストは5000文字上限。タスク件数の上限（12件）でまず超えないが、
  タイトルが長い場合に備えて一覧全体を切り詰める処理を入れる
- **冪等性**: すでに `done` のページに再度 `done` を書いても壊れないこと

---

## 7. ファイル構成

```
.
├── .clasp.json          # コミットしない
├── .claspignore
├── .gitignore
├── appsscript.json      # timeZone: Asia/Tokyo, runtimeVersion: V8
├── src/
│   ├── config.gs        # 定数、プロパティ名マッピング、ScriptProperties読み出し
│   ├── notion.gs        # Notion APIラッパ（query / markDone / createInbox）
│   ├── line.gs          # LINE APIラッパ（push / reply / quickReply組み立て）
│   ├── handlers.gs      # doPost, handleText, handlePostback
│   ├── jobs.gs          # pushMorning, pushEvening
│   └── setup.gs         # setupTriggers, testConnection
└── README.md            # セットアップ手順
```

GASは全ファイルがグローバルスコープを共有するので、ファイル分割は責務の整理のためだけ。
関数名の衝突に注意すること。

---

## 8. 実装タスク（この順で進める）

1. `clasp` プロジェクトの雛形と `appsscript.json` を作る
2. `config.gs` — 定数とプロパティ名マッピング。ここが他の全ファイルの前提になる
3. `notion.gs` — まず query だけ実装し、`testConnection()` で実際に取得できることを確認
4. `line.gs` — push を実装し、自分のLINEに1通届くことを確認
5. `jobs.gs` — F-1 を完成させる
6. `handlers.gs` — `doPost` の骨格と F-3（postback完了）
7. `jobs.gs` に F-2（クイックリプライ付きの夜通知）を追加
8. F-4 / F-5 / F-6 を追加
9. `setup.gs` の `setupTriggers()`
10. `README.md` を書く

各ステップで動作確認できる状態を保つこと。まとめて書いてから一気に動かさない。

---

## 9. 受け入れ基準

- [ ] `testConnection()` が `next` のタスクを正しく列挙する
- [ ] `pushMorning()` が番号付き一覧をLINEに送る
- [ ] `pushEvening()` のクイックリプライをタップすると、Notion側の `status` が `done` になる
- [ ] タップ後、残りタスクの一覧が返信で戻ってくる
- [ ] 「2」と送ると2番目のタスクが完了する
- [ ] 「リスト」と送ると最新の一覧が返る
- [ ] 「牛乳買う」と送ると db_tasks に `inbox` のページができ、URLが返る
- [ ] `next` が0件のときも例外にならず、適切な文面が返る
- [ ] トークンが未設定の状態で実行しても、原因が分かるエラーメッセージが出る
- [ ] `setupTriggers()` を2回実行してもトリガーが重複しない

---

## 10. ハマりどころ（既知）

- **Notionのインテグレーション接続忘れ**: トークンが正しくても、db_tasks 側で
  インテグレーションを「接続」していないと404が返る。エラーメッセージでこれを示唆すること
- **LINEの自動応答**: LINE Official Account Manager 側で「応答メッセージ」がONだと、
  Botの返信と定型文が二重に来る。READMEに手順として明記すること
- **デプロイのバージョン**: GASのウェブアプリは、コードを変更しても「新しいバージョン」として
  デプロイし直さないとWebhookに反映されない。ここは何度も踏むのでREADMEに強調して書く
- **プロパティ名のスラッシュ**: `Due Date/完了日` はそのままキーとして使える。
  URLエンコードなどは不要
- **`ScriptProperties` の同時書き込み**: 使用者が1人なので競合はまず起きないが、
  番号対応表の更新は `LockService` で囲っておくと安全

---

## 11. 人間側でやること（Claude Codeの担当外）

実装完了後、以下は作者本人が行う。READMEにこの手順を書くこと。

1. Notionインテグレーションの作成と db_tasks への接続
2. LINE Messaging APIチャネルの作成、チャネルアクセストークンの発行、自分で友だち追加
3. GASコンソールでスクリプトプロパティ3件を入力
4. ウェブアプリとしてデプロイし、`/exec` URLをLINEのWebhook URLに登録
5. LINE側で応答メッセージOFF / WebhookON
6. `setupTriggers()` を1回実行
