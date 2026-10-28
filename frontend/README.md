# Mesh

家族向けの貸出・予約状況 PWA です。Cognito Hosted UI の Google 認証を使い、
Authorization Code Grant + PKCE でログインして状態 JSON と Web Push 購読 API を利用します。

## 設定

開発時は `.env.example` を `.env.local` にコピーし、値を設定してください。

| 変数                        | 用途                                                          |
| --------------------------- | ------------------------------------------------------------- |
| `VITE_COGNITO_DOMAIN`       | Cognito Hosted UI のドメイン (`https://` を含む)              |
| `VITE_COGNITO_CLIENT_ID`    | Cognito の公開 App Client ID                                  |
| `VITE_COGNITO_REDIRECT_URI` | Hosted UI に登録したコールバック URL。未指定時は現在の origin |
| `VITE_STATUS_URL`           | ID トークン認証付き `/status` API の URL                      |
| `VITE_PUSH_API_URL`         | Push Function URL のベース URL                                |
| `VITE_VAPID_PUBLIC_KEY`     | Push API と対になる VAPID 公開鍵                              |

Cognito App Client は秘密鍵なしの public client とし、Google Identity Provider と
Authorization Code Grant、`openid email profile` スコープを有効にしてください。
Google OAuth クライアントのリダイレクト URI には
`https://<Cognito Hosted UI domain>/oauth2/idpresponse` を登録します。Cognito の
コールバック URL とサインアウト URL には `VITE_COGNITO_REDIRECT_URI` を登録します。
利用状況 JSON は、Push Function URL の `/status` から ID トークンで認証して取得します。
Mesh から S3 バケットを直接公開・参照せず、Push API が認証後に非公開 S3 オブジェクトを
読み込みます。アプリはログイン時に取得し、表示中の定期更新と画面復帰時にも再取得します。
Push Function URL は `/subscriptions` へ POST / DELETE を転送し、
`x-cognito-id-token` ヘッダーを Lambda に渡します。

利用状況データは Keeper の `UserStatusSnapshot` 形式を使用します。利用者データに
`cardNo` または `cardNumber` を含めるとバーコードを表示できます。貸出データに
HTTPS の `coverImageUrl` があれば表紙として表示し、ない場合はジャンルに応じた
プレースホルダーを表示します。

## 開発・ビルド

```sh
pnpm install
pnpm --filter @higalibra/mesh dev
pnpm --filter @higalibra/mesh build
pnpm --filter @higalibra/mesh lint
```

デプロイ時は CloudFront で SPA の未知パスを `/index.html` にフォールバックさせ、
`sw.js`、`manifest.webmanifest`、`icon.svg` を同一 origin から配信してください。
