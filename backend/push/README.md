# Push

CloudFront 経由で呼び出す Web Push 購読 API と、Keeper / Dash から利用する
Web Push 送信モジュールです。

## API

`/subscriptions` は CloudFront の Lambda URL origin からこの Lambda を呼び出します。
Function URL は `AWS_IAM` と Origin Access Control (OAC) で保護し、CloudFront
ディストリビューションだけが呼び出せます。JWT の署名・有効期限・Cognito audience と
issuer の検証は us-east-1 の Lambda@Edge が行います。ログイン可能なアカウントの制限は
Google OAuth 側で設定します。Lambda@Edge は
署名検証した ID token の `email` と `email_verified` を確認し、`/subscriptions` では
メールアドレスを内部ヘッダーに設定して OAC で保護された origin request policy を
通じてこの Lambda に転送します。この Lambda は JWT を検証しません。

この Lambda は `ALLOWED_EMAILS_PARAMETER_NAME` の SSM SecureString を読み、
検証済みメールアドレスに対応するカード番号を取得します。購読先はこの対応表で特定し、
リクエスト本文から利用者IDを受け取らないため、別利用者の購読を登録・解除できません。

| Method   | Path             | JSON body                                                                                           | 動作                               |
| -------- | ---------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `POST`   | `/subscriptions` | `{"deviceId":"...","subscription":{"endpoint":"https://...","keys":{"p256dh":"...","auth":"..."}}}` | 購読の登録・更新                   |
| `DELETE` | `/subscriptions` | `{"deviceId":"..."}`                                                                                | ログイン中ユーザーの端末購読を解除 |

成功応答は JSON で返ります。入力不正は `400`、CloudFront から認証済み identity header
が渡されない場合は `401`、未対応ルート・method は `404/405` です。DynamoDB への
アクセス失敗などの内部エラーは Lambda のエラーとして表面化します。
SSM の値は `{"member@example.com":"2010610570"}` の形式です。メールアドレスは
大文字・小文字を区別せず照合します。

## 設定

| 環境変数                        | 用途                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| `SUBSCRIPTIONS_TABLE`           | 購読情報 DynamoDB テーブル名（パーティションキー `id`）       |
| `ALLOWED_EMAILS_PARAMETER_NAME` | 許可メールアドレスとカード番号の対応表を含む SSM SecureString |
| `AWS_REGION`                    | Lambda の標準リージョン設定を使用                             |

購読レコードは `id=USER#<cardNo>#DEVICE#<deviceId>` をキーとして保存されます。
属性は `cardNo`, `deviceId`, `endpoint`, `keys.p256dh`, `keys.auth`, `updatedAt` です。
Lambda 実行ロールにはテーブルへの `dynamodb:PutItem` と `dynamodb:DeleteItem`
権限が必要です。状態 JSON は Push Lambda ではなく、CloudFront の `/status` behavior
から OAC で非公開 S3 bucket より配信します。

## 送信モジュール

`DynamoDbPushSender` を各バッチから利用し、対象 `cardNo` に登録されたすべての
端末へ通知を送れます。VAPID 資格情報は Parameter Store から読み込み、
`{ subject, publicKey, privateKey }` として渡してください。

```ts
const pushSender = new DynamoDbPushSender(
  dynamodbClient,
  subscriptionsTable,
  vapidCredentials,
);

await pushSender.send(cardNo, {
  type: 'reservation-ready',
  title: '予約した本が取置済みです',
  message: '取置期限を確認してください。',
  bookTitle: '書名',
  date: '2026-10-30',
});
```

## ビルド・テスト

```sh
pnpm --filter @higalibra/push build
pnpm --filter @higalibra/push lint
pnpm --filter @higalibra/push test
```

ビルド成果物の `dist/index.js` が Lambda の ESM エントリポイントで、ハンドラーは
`dist/index.handler` に設定します。CloudFormation は AWS Lambda の Node.js 24
ランタイムを使用します。
