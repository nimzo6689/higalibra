# Keeper

毎日の利用者状況同期、返却期限が近い貸出の自動延長、取置済み・返却期限の
Web Push 通知を行う Lambda パッケージです。

## 設定

Lambda に次の環境変数を設定します。

| 変数                    | 用途                                             |
| ----------------------- | ------------------------------------------------ |
| `KEEPER_PARAMETER_NAME` | Parameter Store の SecureString 設定 JSON の名前 |
| `STATUS_BUCKET`         | 利用者状況 JSON を保存する S3 バケット           |
| `STATUS_KEY`            | S3 オブジェクトキー（省略時 `user_status.json`） |
| `SUBSCRIPTIONS_TABLE`   | Push 購読情報を格納する DynamoDB テーブル        |
| `AWS_REGION`            | AWS リージョン（Lambda の標準設定を利用）        |

Parameter Store の `SecureString` に、以下の JSON を保存してください。図書館
アカウントと VAPID 秘密鍵はリポジトリや Lambda 環境変数に置かず、暗号化した
`SecureString` として管理します。
`users` には家族4人分の利用者情報を設定します。

```json
{
  "baseUrl": "https://library.example/opw/OPW",
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
      "name": "利用者名",
      "cardNo": "利用者カード番号",
      "password": "図書館パスワード"
    }
  ],
  "vapid": {
    "subject": "mailto:admin@example.com",
    "publicKey": "VAPID公開鍵",
    "privateKey": "VAPID秘密鍵"
  },
  "reservationCardNo": "Dash が予約に使うカード番号",
  "geminiApiKey": "Google AI Studio API key"
}
```

`reservationCardNo` と `geminiApiKey` は Dash でも使います。Dash は指定した
`reservationCardNo` のアカウントだけで予約します。PWA で使う利用者 ID と Push
購読のキーには `cardNo` を使用します。Dash の評価ルールとローカル
REPL の使い方は [backend/dash/README.md](../dash/README.md) を参照してください。

DynamoDB の購読項目は `cardNo`, `endpoint`, `keys.p256dh`, `keys.auth` を持つ必要が
あります。Keeper は `cardNo` で対象項目を Scan します。Lambda 実行ロールには
設定したパラメーターの復号を伴う読み取り、S3 オブジェクトの読み書き、
DynamoDB テーブルの Scan 権限が必要です。

初回実行時、S3 に状態ファイルがなければ空の前回状態として扱います。成功後、
`user_status.json` のデータ設計に沿った JSON を保存します。延長対象は返却日まで
0〜3 日で状態が `再貸出` の本です。延長後は最新状態を再取得します。Push 送信に
かかわらず、取得した最新状況を先に状態ファイルへ保存します。Push 送信に失敗した
場合は状態を保持したうえで Lambda 実行を失敗として返します。

## ビルド

```sh
pnpm --filter @higalibra/keeper build
pnpm --filter @higalibra/keeper lint
pnpm --filter @higalibra/keeper test
pnpm --filter @higalibra/keeper format:check
```

Lambda にデプロイする際は、本パッケージと workspace 依存 package の production
dependencies を含めてください。ビルド成果物の `dist/index.js` が Lambda の ESM
エントリポイントで、パッケージルートを zip 化する場合はハンドラーを
`dist/index.handler` に設定します。AWS Lambda では Node.js 24 を使用してください。
貸出日計算とスクレイピングでは `@js-temporal/polyfill` を使用するため、
Node.js の組み込み `Temporal` API に依存しません。
