# Push

CloudFront 経由で呼び出す Web Push 購読 API と、Keeper / Dash から利用する
Web Push 送信モジュールです。

## API

`/subscriptions` は CloudFront の Lambda URL origin からこの Lambda を呼び出します。
Function URL は `AWS_IAM` と Origin Access Control (OAC) で保護し、CloudFront
ディストリビューションだけが呼び出せます。JWT の署名・有効期限・Cognito audience と
`ALLOWED_USER_IDS` の検証は us-east-1 の Lambda@Edge が行います。Lambda@Edge は
検証した `sub` と `custom:cardNo` を内部ヘッダーに設定し、OAC で保護された origin
request policy を通じてこの Lambda に転送します。この Lambda は JWT を検証しません。

4人分の Cognito `sub` を GitHub Actions secret `COGNITO_ALLOWED_USER_IDS` に指定します。
各 Cognito ユーザーには図書館カード番号を `custom:cardNo` 属性として設定してください。
購読先は Lambda@Edge
が JWT の署名を検証して作成した `x-authenticated-card-no` で特定し、リクエスト本文から
利用者IDを受け取らないため、別利用者の購読を登録・解除できません。

| Method   | Path             | JSON body                                                                                           | 動作                               |
| -------- | ---------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `POST`   | `/subscriptions` | `{"deviceId":"...","subscription":{"endpoint":"https://...","keys":{"p256dh":"...","auth":"..."}}}` | 購読の登録・更新                   |
| `DELETE` | `/subscriptions` | `{"deviceId":"..."}`                                                                                | ログイン中ユーザーの端末購読を解除 |

成功応答は JSON で返ります。入力不正は `400`、CloudFront から認証済み identity header
が渡されない場合は `401`、未対応ルート・method は `404/405` です。DynamoDB への
アクセス失敗などの内部エラーは Lambda のエラーとして表面化します。

## 設定

| 環境変数               | 用途                                                    |
| ---------------------- | ------------------------------------------------------- |
| `SUBSCRIPTIONS_TABLE`  | 購読情報 DynamoDB テーブル名（パーティションキー `id`） |
| `AWS_REGION`           | Lambda の標準リージョン設定を使用                       |

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
