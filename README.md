# LINE × Notion タスクリマインダー

Notionのタスク（GTD運用、`status = next`）をLINEで回すための個人用Bot。
Google Apps Script (GAS) 上で動く。利用者は1人（作者本人）のみ。

- 朝8時: 今日やるタスクの一覧がLINEに届く
- 夜21時: 「終わった？」とクイックリプライ付きで確認が来る
- ボタンか番号の返信で Notion の `status` が `done` になる
- 番号+「明日」で `着手日` を明日にずらせる（延期）
- 思いついたことを送ると Notion の `inbox` に入る

## 使い方（LINEトーク画面で）

| 送るもの | 動き |
|---|---|
| クイックリプライの「① 完了」 | ①のタスクを `done` に |
| クイックリプライの「① 明日」 | ①の `着手日` を明日に（6件以下のときだけ表示） |
| `2` / `2完了` / `2 終わった` | 2番のタスクを `done` に |
| `2 明日` / `2延期` | 2番の `着手日` を明日に |
| `リスト` / `今日` | 現時点の `next` 一覧を再送（番号対応表も更新） |
| それ以外の文 | そのタイトルで `inbox` に新規ページ作成 |

番号対応表は最後に送った一覧から6時間で失効する。失効後は「リスト」で出し直してから番号を送る（古い一覧の番号で別タスクを誤完了しないための仕様）。

## ファイル構成

```
.
├── .clasp.json          # コミットしない（.gitignore済み）
├── .claspignore         # push対象は appsscript.json と src/ のみ
├── appsscript.json      # timeZone: Asia/Tokyo, runtimeVersion: V8
├── src/
│   ├── config.gs        # 定数、プロパティ名マッピング、秘密情報読み出し
│   ├── notion.gs        # Notion APIラッパ
│   ├── line.gs          # LINE APIラッパ、クイックリプライ組み立て
│   ├── handlers.gs      # doPost、テキスト/postback処理、番号対応表
│   ├── jobs.gs          # pushMorning / pushEvening
│   └── setup.gs         # setupTriggers、疎通確認用関数
├── Code.gs              # 旧プロトタイプ（参考用・pushされない）
└── SPEC.md              # 実装指示書
```

Notion側でプロパティ名を変えたら [src/config.gs](src/config.gs) の `PROP` だけ直せばよい。

## セットアップ手順

### 1. Notionインテグレーション

1. https://www.notion.so/my-integrations でインテグレーションを作成し、トークンを控える
2. **db_tasks のページ右上「…」→「接続」からこのインテグレーションを接続する**
   （これを忘れるとトークンが正しくても404が返る。ハマりどころ筆頭）

### 2. LINE Messaging APIチャネル

1. https://developers.line.biz/ でMessaging APIチャネルを作成
2. チャネルアクセストークン（長期）を発行して控える
3. 自分のユーザーID（`U`で始まる文字列。チャネル基本設定に表示される）を控える
4. QRコードから自分で友だち追加する

### 3. GASプロジェクト

```bash
npm install -g @google/clasp
clasp login
clasp create --type webapp --title "notion-line-reminder" --rootDir .
clasp push
```

既存プロジェクトに紐付ける場合は `clasp clone <scriptId> --rootDir .` か、
`.clasp.json` を手で作る（`{"scriptId":"...","rootDir":"."}`）。

### 4. スクリプトプロパティ

GASエディタの「プロジェクトの設定 > スクリプト プロパティ」で3件を手入力する。
**コードやリポジトリには絶対に書かない。**

| キー | 値 |
|---|---|
| `NOTION_TOKEN` | Notionインテグレーションのトークン |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINEのチャネルアクセストークン |
| `LINE_USER_ID` | 自分のLINEユーザーID |

### 5. 疎通確認（GASエディタで手動実行）

1. `testConnection` — ログに `next` のタスクが列挙されればNotion側OK
2. `testLinePush` — LINEに1通届けばLINE側OK（無料枠を1通消費）
3. `testMorning` / `testEvening` — 通知の見た目を確認

### 6. Webhookのデプロイ

1. GASエディタで「デプロイ > 新しいデプロイ > ウェブアプリ」
   - 実行ユーザー: 自分 / アクセスできるユーザー: **全員**
2. 発行された `/exec` URLを、LINE Developersの「Webhook URL」に登録し、**Webhookの利用をON**
3. LINE Official Account Manager で**「応答メッセージ」をOFF**にする
   （ONのままだとBotの返信と定型文が二重に届く）

> ⚠️ **コードを変更したら「デプロイを管理 > 編集 > 新しいバージョン」でデプロイし直すこと。**
> `clasp push` しただけではWebhookに反映されない。何度も踏むので注意。

### 7. トリガー設定

GASエディタで `setupTriggers` を1回実行する。
既存トリガーを全削除してから作るので、何度実行しても重複しない。

## 運用メモ

- pushは朝夜の2回だけ（月60通程度）。LINE無料枠は月200通
- ユーザーへの応答はすべてreply（無料枠を消費しない）
- 完了済みページに再度 `done` を書いても壊れない（冪等）

## v2候補（初版では見送り）

- 複数番号の一括完了（「1,3」「1 2 3」）
- 朝の一覧に「近い未来の自分へ」メモを添える
- db_project のリレーションからプロジェクト名を表示
