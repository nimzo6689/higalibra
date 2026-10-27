# Higalibra

家族の図書館利用状況を管理する、個人用の Web アプリと自動化ツールです。
図書館の貸出・予約状況の同期、新着本の調査・予約、Web Push 通知を行います。

## 構成

| パッケージ         | 役割                                 |
| ------------------ | ------------------------------------ |
| `frontend/`        | 貸出・予約状況を確認する PWA（Mesh） |
| `backend/keeper/`  | 利用状況の同期、自動延長、通知       |
| `backend/dash/`    | 新着本の調査・予約、通知             |
| `backend/push/`    | Push 購読 API と通知送信             |
| `backend/scraper/` | 図書館サイトとの通信                 |
| `infra.yaml`       | AWS リソース定義                     |

## 開発環境

Node.js と pnpm のバージョンは [mise.toml](./mise.toml) で管理しています。

```sh
mise install
pnpm install
```

### PWA の起動

`frontend/.env.example` を `.env.local` にコピーし、Cognito、利用状況 API、Push API などの値を設定してから起動します。

```sh
pnpm --filter @higalibra/mesh dev
```

### ビルド・テスト

```sh
pnpm --filter @higalibra/mesh build
pnpm --filter @higalibra/keeper build
pnpm --filter @higalibra/keeper test
pnpm --filter @higalibra/dash build
pnpm --filter @higalibra/dash test
pnpm --filter @higalibra/push build
pnpm --filter @higalibra/push test
```

各パッケージの lint など、個別の開発手順や設定については、それぞれの README を参照してください。

## デプロイ

AWS への初回セットアップ、GitHub Actions の設定、デプロイ手順は [DEPLOYMENT.md](./DEPLOYMENT.md) を参照してください。

## 資格情報

図書館のログイン情報や API キーなどの秘密情報は、リポジトリに登録せず、各環境の `.env` または AWS Secrets Manager で管理しています。
