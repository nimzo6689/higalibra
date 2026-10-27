# Push

Web Push 購読の登録・解除を行う Lambda Function URL API と、Keeper / Dash
から利用する Web Push 送信モジュールです。

## API

Function URL (`AuthType: NONE`) を公開 API エンドポイントとして使います。
各リクエストは Cognito ID トークンを検証し、`ALLOWED_USER_IDS` に指定した
`sub` だけを許可します。AWS の Function URL CORS 設定で PWA の origin のみを
許可してください。

4人分の Cognito `sub` を `ALLOWED_USER_IDS` に指定します。各 Cognito ユーザーには
図書館カード番号を `custom:cardNo` 属性として設定してください。ID トークン中の
署名済み `custom:cardNo` を Push 購読の利用者IDとして使い、リクエスト本文から
利用者IDを受け取らないため、別利用者の購読を登録・解除できません。

| Method   | Path             | JSON body                                                                                           | 動作                               |
| -------- | ---------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `POST`   | `/subscriptions` | `{"deviceId":"...","subscription":{"endpoint":"https://...","keys":{"p256dh":"...","auth":"..."}}}` | 購読の登録・更新                   |
| `DELETE` | `/subscriptions` | `{"deviceId":"..."}`                                                                                | ログイン中ユーザーの端末購読を解除 |
| `GET`    | `/status`        | —                                                                                                   | S3 の利用状況 JSON を返す          |

`x-cognito-id-token` に Cognito ID トークンを指定します。成功応答は JSON で返り、
入力不正・認証失敗・未対応ルートはそれぞれ `400`・`401`・`404/405` になります。
DynamoDB へのアクセス失敗などの内部エラーは Lambda のエラーとして表面化します。

## 設定

| 環境変数               | 用途                                                    |
| ---------------------- | ------------------------------------------------------- |
| `SUBSCRIPTIONS_TABLE`  | 購読情報 DynamoDB テーブル名（パーティションキー `id`） |
| `STATUS_BUCKET`        | `user_status.json` を保管する非公開 S3 バケット名       |
| `STATUS_KEY`           | 状態 JSON の S3 キー（省略時 `user_status.json`）       |
| `COGNITO_USER_POOL_ID` | Cognito User Pool ID                                    |
| `COGNITO_CLIENT_ID`    | Cognito App Client ID                                   |
| `ALLOWED_USER_IDS`     | 許可する Cognito `sub` をカンマ区切りで指定             |
| `AWS_REGION`           | Lambda の標準リージョン設定を使用                       |

購読レコードは `id=USER#<cardNo>#DEVICE#<deviceId>` をキーとして保存されます。
属性は `cardNo`, `deviceId`, `endpoint`, `keys.p256dh`, `keys.auth`, `updatedAt` です。
Lambda 実行ロールにはテーブルへの `dynamodb:PutItem` と `dynamodb:DeleteItem`
権限と、状態 JSON の `s3:GetObject` 権限が必要です。Keeper / Dash の送信ロールには同じテーブルへの
`dynamodb:Scan` 権限と Parameter Store の `SecureString` 読み取り権限が必要です。

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
