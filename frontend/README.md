# Mesh

家族向けの貸出・予約状況 PWA です。Cognito Hosted UI の Authorization Code
Grant + PKCE でログインし、状態 JSON と Web Push 購読 API を利用します。

## 設定

開発時は `.env.example` を `.env.local` にコピーし、値を設定してください。

| 変数                        | 用途                                                          |
| --------------------------- | ------------------------------------------------------------- |
| `VITE_COGNITO_DOMAIN`       | Cognito Hosted UI のドメイン (`https://` を含む)              |
| `VITE_COGNITO_CLIENT_ID`    | Cognito の公開 App Client ID                                  |
| `VITE_COGNITO_REDIRECT_URI` | Hosted UI に登録したコールバック URL。未指定時は現在の origin |
| `VITE_STATUS_URL`           | `lastUpdated` と `users` を返す利用状況 JSON の URL           |
| `VITE_PUSH_API_URL`         | Push Function URL のベース URL                                |
| `VITE_VAPID_PUBLIC_KEY`     | Push API と対になる VAPID 公開鍵                              |

Cognito App Client は秘密鍵なしの public client とし、Authorization Code Grant と
`openid email profile` スコープを有効にしてください。コールバック URL とサインアウト
URL には `VITE_COGNITO_REDIRECT_URI` を登録します。状態 JSON の配信元は、このアプリの
origin からの CORS と `Authorization` ヘッダーを許可し、ID トークンで利用者を認証
してください。Push Function URL は `/subscriptions` へ POST / DELETE を転送し、
`x-cognito-id-token` ヘッダーを Lambda に渡す設定が必要です。

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
