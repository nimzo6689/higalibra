# ライブラリスクレイパー

図書館サイトへのログイン、利用者のアカウント状況確認、新着本一覧取得、
貸出延長、予約処理を行うための Node.js パッケージです。

## セットアップ

`mise` が必要です。Node.js と pnpm のバージョンは `mise.toml` で固定されています。
このディレクトリで以下を実行して、必要なツールと依存関係をインストールしてください。
ESLint と Prettier の設定はリポジトリルートで管理しています。

```sh
mise install
pnpm install
```

## Node.js からの利用方法

```ts
import { createScraper } from '@higalibra/scraping';

const scraper = createScraper({
  'https://xxxxx/opw/OPW',
  cardNo: '利用者カード番号',
  password: 'パスワード',
});
const status = await scraper.getUserStatus();
const newBooks = await scraper.getNewBooks();
```

`extendLoan(barcode)` と `reserveBook(bookNo)` は、図書館アカウントに変更を加える
処理です。実際にその操作を行う意図がある場合にだけ実行してください。

## 対話型チェック

対話型の Node.js REPL を使って、Scraper の動作を確認できます。
`.env` ファイルを作成して、`HIGALIBRA_BASE_URL` を設定してください。

```env
HIGALIBRA_BASE_URL=https://xxxxx/opw/OPW
```

```sh
pnpm repl
```

プロンプトで `scraper = createScraper({ cardNo: '利用者カード番号', password: 'パスワード' })`
を実行してから、`await scraper.getUserStatus()` や `await scraper.getNewBooks()` を実行できます。
最初のリクエスト時にログインが行われます。
貸出延長や予約も同様に実行できますが、図書館アカウントに変更が加えられます。

## パッケージコマンド

- `pnpm build` は ESM パッケージと TypeScript の宣言ファイルを
  `dist/` にビルドします。
- `pnpm dev` はソースファイルに変更があるたびにパッケージを再ビルドします。
- `pnpm lint` と `pnpm format:check` はソースコードの
  整形と lint 規則をチェックします。
