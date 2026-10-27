# Dash

毎週の新着本調査、Gemini による Web 検索付き評価、選択した1アカウントでの
予約、および予約成功時の Web Push 通知を行う Lambda パッケージです。

過去に評価した `bookNo` は S3 の調査履歴に記録し、次回実行では LLM 評価・予約を
繰り返しません。予約結果を履歴へ記録した後に通知するため、Push 失敗時も次回に通知
を再試行し、予約自体を重複実行しません。予約リクエスト前に `reservation-pending`
を保存するため、Lambda が応答を失った場合も二重予約を避ける設計です。

## Lambda 設定

| 環境変数              | 用途                                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| `DASH_PARAMETER_NAME` | 図書館アカウント・Gemini・VAPID 設定を含む SecureString パラメーター名 |
| `DASH_HISTORY_BUCKET` | 調査履歴を保存する非公開 S3 バケット                                   |
| `DASH_HISTORY_KEY`    | 履歴キー（省略時 `dash_research_history.json`）                        |
| `SUBSCRIPTIONS_TABLE` | Web Push 購読情報を格納する DynamoDB テーブル                          |
| `AWS_REGION`          | AWS リージョン（Lambda 標準設定を利用）                                |

Parameter Store の `SecureString` に保存する JSON は以下の形式です。図書館の認証情報、
Gemini API キー、VAPID 秘密鍵をリポジトリや Lambda 環境変数に置かないでください。
`reservationCardNo` は、4人の `users[].cardNo` のいずれか1つに設定します。

```json
{
  "baseUrl": "https://library.example/opw/OPW",
  "reservationCardNo": "カード番号1",
  "geminiApiKey": "Google AI Studio API key",
  "users": [
    {
      "name": "利用者1",
      "cardNo": "カード番号1",
      "password": "パスワード1"
    },
    {
      "name": "利用者2",
      "cardNo": "カード番号2",
      "password": "パスワード2"
    },
    {
      "name": "利用者3",
      "cardNo": "カード番号3",
      "password": "パスワード3"
    },
    {
      "name": "利用者4",
      "cardNo": "カード番号4",
      "password": "パスワード4"
    }
  ],
  "vapid": {
    "subject": "mailto:admin@example.com",
    "publicKey": "VAPID公開鍵",
    "privateKey": "VAPID秘密鍵"
  }
}
```

Gemini Flash に Google Search grounding を有効にして新着本を評価させ、結果は
日本語の短い理由とともに履歴に保存します。予約は `reservationCardNo` のアカウントで行い、
予約成功通知は設定された4人全員に送信します。

## ローカル REPL

Node.js 24 と pnpm が必要です。`backend/dash/.env.example` を `.env` にコピーし、
図書館ログイン情報と Gemini API キーを設定します。ローカル利用では
`HIGALIBRA_CARD_NO` が予約に使用するカード番号になります。

```sh
pnpm install
cd backend/dash
cp .env.example .env
# .env を編集した後
pnpm repl
```

REPL では `await scraper.getNewBooks()` で新着一覧を確認し、
`await evaluateBook(books[0])` で Gemini の評価を1冊単位で確認できます。
`await runDash()` は dry-run が既定で、予約・Web Push は行わず、ローカルの
`.dash-history.json` に評価結果を保存します。実際に図書館予約を行う場合のみ、
明示的に `await runDash({ dryRun: false })` を実行してください。これは図書館
アカウントに変更を加えます。dry-run の履歴は本番動作時には再評価されるため、
dry-run 後もそのまま切り替えて試せます。ローカル REPL では Push は送信せず、
プレビューを表示します。`.env` とローカル履歴は git 管理対象外です。

## 開発コマンド

```sh
pnpm --filter @higalibra/dash build
pnpm --filter @higalibra/dash lint
pnpm --filter @higalibra/dash test
pnpm --filter @higalibra/dash format:check
```

Lambda ハンドラーは `dist/index.handler`、ランタイムは Node.js 24 です。デプロイ
ロールには SecureString パラメーター読み取り、履歴オブジェクトの S3 読み書き、および購読テーブルの
Scan 権限が必要です。
