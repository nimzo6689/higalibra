# 図書館ダッシュボード

利用者の貸出・予約状況を管理する PWA です。Cognito Hosted UI の Google 認証を使い、
Authorization Code Grant + PKCE でログインして状態 JSON と Web Push 購読 API を利用します。

## 設定

開発時は `.env.example` を `.env.local` にコピーし、値を設定してください。

| 変数                        | 用途                                                          |
| --------------------------- | ------------------------------------------------------------- |
| `VITE_COGNITO_DOMAIN`       | Cognito Hosted UI のドメイン (`https://` を含む)              |
| `VITE_COGNITO_CLIENT_ID`    | Cognito の公開 App Client ID                                  |
| `VITE_COGNITO_REDIRECT_URI` | Hosted UI に登録したコールバック URL。未指定時は現在の origin |
| `VITE_STATUS_URL`           | 同一 CloudFront origin の `/status` URL                       |
| `VITE_KEEPER_API_URL`       | `/keeper` を配信する CloudFront の同一 origin                 |
| `VITE_PUSH_API_URL`         | `/subscriptions` を配信する CloudFront の同一 origin          |
| `VITE_VAPID_PUBLIC_KEY`     | Push API と対になる VAPID 公開鍵                              |

Cognito App Client は秘密鍵なしの public client とし、Google Identity Provider と
Authorization Code Grant、`openid email profile` スコープを有効にしてください。
Google OAuth クライアントのリダイレクト URI には
`https://<Cognito Hosted UI domain>/oauth2/idpresponse` を登録します。Cognito の
コールバック URL とサインアウト URL には `VITE_COGNITO_REDIRECT_URI` を登録します。
利用状況 JSON は同一 CloudFront origin の `/status` から取得します。CloudFront の
Lambda@Edge が Cognito ID token を検証した後、非公開 StatusBucket の
`user_status.json` を OAC 経由で返します。購読の POST / DELETE は同一 origin の
`/subscriptions` behavior から Push Lambda に転送します。ブラウザーと API は同一 origin
なので CORS は使用しません。`/status` は画面側が取得し、Service Worker の fetch 中継を
通しません。購読登録 POST の本文は SHA-256 を計算して
`x-amz-content-sha256` として送信し、CloudFront の OAC 署名を検証可能にします。
購読解除 DELETE は本文を送らず、端末IDをパスに含めます。
SPA の画面遷移は CloudFront Function が HTML ナビゲーションを
`/index.html` に書き換えて処理し、API の origin エラーを SPA の成功応答に置き換えません。
ログイン時にはブラウザーに残っている購読情報を再度 POST し、
Push Lambda 側の購読状態と同期します。画面の同期ボタンは認証済み `POST /keeper` で Keeper を実行し、
完了後に `/status` から S3 の最新データを取得します。ログイン後、表示中の定期更新、
画面復帰時の更新、および再試行では引き続き `/status` のみを取得します。
認証付き API が HTTP 401 を返した場合は、保存済み refresh token で ID token を更新し、
失敗したリクエストを一度だけ再試行します。

利用状況データは Keeper の `UserStatusSnapshot` 形式を使用します。利用者データに
`cardNo` または `cardNumber` を含めるとバーコードを表示できます。貸出データに
HTTPS の `coverImageUrl` があれば表紙として表示し、ない場合はジャンルに応じた
プレースホルダーを表示します。

未インストールのブラウザーでは起動時に PWA のインストール案内を表示します。
インストール可能なブラウザーでは案内からインストールでき、iOS などでは
ホーム画面への追加手順を案内します。インストール済みの場合は案内を表示しません。

## 開発・ビルド

```sh
pnpm install
pnpm --filter @higalibra/mesh dev
pnpm --filter @higalibra/mesh build
pnpm --filter @higalibra/mesh lint
```

デプロイ時は CloudFront で SPA の未知パスを `/index.html` にフォールバックさせ、
`sw.js`、`manifest.webmanifest`、`icon.svg` を同一 origin から配信してください。
