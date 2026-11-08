# Dash

毎週の新着書籍一覧を利用者ごとの予約条件と照合し、一致した利用者のカード番号で予約する
Lambda パッケージです。出版社・著者・タイトルキーワードの各条件内では AND / OR を
選択でき、条件項目どうしは AND で照合します。タイトルキーワードは大文字・小文字を
区別しない部分一致です。条件が空の利用者は予約対象になりません。

新着一覧は条件が設定された利用者のうち `users` 配列で先頭のカード番号を使って取得し、
各書籍を対象利用者ごとに照合します。予約済み書籍は S3 の履歴で利用者・書籍番号ごとに
記録し、重複予約を防ぎます。予約前に `reservation-pending` を保存するため、Lambda が
応答を失った場合も再予約しません。予約成功後の通知は該当利用者だけに送り、Push 失敗時は
履歴を使って通知を再試行します。既存の version 1 履歴は読み込み時に version 2 へ移行し、
予約済み・予約処理中の記録を引き継ぎます。

## AWS 設定

| 環境変数                        | 用途                                                              |
| ------------------------------- | ----------------------------------------------------------------- |
| `DASH_PARAMETER_NAME`           | 図書館アカウント・VAPID 設定を含む SecureString パラメーター名    |
| `DASH_HISTORY_BUCKET`           | 調査・予約履歴と予約設定を保存する非公開 S3 バケット              |
| `DASH_HISTORY_KEY`              | 履歴キー（省略時 `dash_research_history.json`）                   |
| `DASH_SETTINGS_PREFIX`          | 利用者別設定の S3 プレフィックス（省略時 `reservation-settings`） |
| `SUBSCRIPTIONS_TABLE`           | Web Push 購読情報を格納する DynamoDB テーブル                     |
| `ALLOWED_EMAILS_PARAMETER_NAME` | 設定 API が認証メールをカード番号に対応付ける SecureString        |
| `AWS_REGION`                    | AWS リージョン（Lambda 標準設定を利用）                           |

Parameter Store の `SecureString` には図書館アカウントと VAPID 認証情報を保存します。
Gemini API キーや固定の予約カード番号は不要です。

```json
{
  "baseUrl": "https://library.example/opw/OPW",
  "users": [
    { "name": "利用者1", "cardNo": "カード番号1", "password": "パスワード1" },
    { "name": "利用者2", "cardNo": "カード番号2", "password": "パスワード2" },
    { "name": "利用者3", "cardNo": "カード番号3", "password": "パスワード3" },
    { "name": "利用者4", "cardNo": "カード番号4", "password": "パスワード4" }
  ],
  "vapid": {
    "subject": "mailto:admin@example.com",
    "publicKey": "VAPID公開鍵",
    "privateKey": "VAPID秘密鍵"
  }
}
```

設定 API は Cognito ID token を Lambda@Edge で検証した同一 CloudFront origin の
`GET /reservation-settings` と `POST /reservation-settings` です。Lambda は検証済みメールを
`ALLOWED_EMAILS_PARAMETER_NAME` の対応表でカード番号に変換し、カード番号を含む
`reservation-settings/<cardNo>.json` の S3 オブジェクトだけを読み書きします。リクエスト
からカード番号を指定することはできません。
POST 本文の SHA-256 を `x-amz-content-sha256` ヘッダーに含め、CloudFront の OAC 署名に
使用します。このヘッダーは CloudFront の API origin request policy で転送します。

設定オブジェクトの例:

```json
{
  "publishers": { "operator": "or", "values": ["集英社", "小学館"] },
  "authors": { "operator": "and", "values": ["佐藤太郎"] },
  "titleKeywords": { "operator": "or", "values": ["小説"] }
}
```

各項目は最大20個の値を持ち、各値は1〜100文字です。空の値は保存できません。画面上では
途中入力として空欄を表示できますが、保存時に除外します。設定値がすべて空の場合、その
利用者は対象外です。Dash 実行ロールは設定オブジェクトの読み取り権限、設定 API ロールは
同じプレフィックス内の読み書き権限を持ちます。

## ローカル REPL

Node.js 24 と pnpm が必要です。`backend/dash/.env.example` を `.env` にコピーし、
図書館ログイン情報を設定してください。

```sh
pnpm install
cd backend/dash
cp .env.example .env
# .env を編集した後
pnpm repl
```

予約条件は `.reservation-settings.json` に上記と同じ JSON 形式で保存します。ファイルが
なければ予約対象なしとして扱います。パスを変更する場合は
`DASH_RESERVATION_SETTINGS_PATH` を設定してください。`await scraper.getNewBooks()` で新着
一覧を確認し、`await runDash()` で dry-run の照合結果を確認できます。dry-run は予約・Push・
履歴更新を行いません。実際に図書館予約を行う場合のみ、明示的に
`await runDash({ dryRun: false })` を実行してください。これは図書館アカウントに変更を
加えます。Push はローカルプレビューのみです。`.env`、設定ファイル、履歴ファイルは Git
管理対象外です。

## 開発コマンド

```sh
pnpm --filter @higalibra/dash build
pnpm --filter @higalibra/dash lint
pnpm --filter @higalibra/dash test
pnpm --filter @higalibra/dash format:check
```

Dash Lambda ハンドラーは `dist/index.handler`、予約設定 API Lambda ハンドラーは
`dist/index.reservationSettingsApiHandler`、ランタイムは Node.js 26 です。両関数には Dash
パッケージ成果物をデプロイします。
