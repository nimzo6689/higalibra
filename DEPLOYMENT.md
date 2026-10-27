# AWS へのデプロイ

`.github/workflows/cicd.yaml` は Keeper、Dash、Push の各パッケージと Mesh PWA
をビルド・テストし、Lambda パッケージと CloudFormation スタックをデプロイした後、
CloudFront 配下の非公開 S3 バケットに PWA を公開します。ワークフローのコマンドには
Nushell を使用します。デプロイは `main` への push 時に実行されるほか、
`workflow_dispatch` から手動で開始できます。

## 初回セットアップ

1. GitHub Actions の OIDC 用に AWS IAM ロールを作成し、リポジトリ Secret
   `AWS_ROLE_ARN` にその ARN を設定します。ロールの信頼ポリシーは、このリポジトリと
   `main` ブランチに限定してください。
2. [backend/keeper/README.md](./backend/keeper/README.md) と
   [backend/dash/README.md](./backend/dash/README.md) に記載された JSON 形式に従って、
   Systems Manager Parameter Store に `/higalibra/keeper` という名前で
   `SecureString` パラメーターを作成します。リポジトリ Secret
   `KEEPER_PARAMETER_NAME` に `/higalibra/keeper` を設定してください。
   パラメーターには、図書館の4アカウント分の情報、VAPID 認証情報、Google AI Studio
   API キー、および Dash が予約に使用するカード番号を示す `reservationCardNo` を含めます。
3. VAPID の鍵ペアを生成して SecureString に保存します。リポジトリルートで次を
   実行し、管理者の連絡先メールアドレスを指定します。

   ```sh
   nu .github/scripts/setup-vapid.nu mailto:admin@example.com
   ```

   スクリプトは `web-push` で鍵を生成し、秘密鍵を表示せずに `/higalibra/keeper`
   の `vapid` 設定を更新します。`gh` が認証済みなら GitHub Actions の Secret
   `VAPID_PUBLIC_KEY` も自動更新します。`gh` がない場合は表示された公開鍵を
   Secret に手動登録してください。実行環境には pnpm の依存関係と、対象 AWS
   アカウントの SSM SecureString 読み書き権限が必要です。

4. 次の GitHub Actions リポジトリ Secrets を設定します。
   - `AWS_REGION`（省略可。既定値は `ap-northeast-1`）
   - `COGNITO_DOMAIN_PREFIX`（必須。全体で一意な小文字の Cognito ドメイン）
   - `VAPID_PUBLIC_KEY`（必須。Parameter Store に設定した鍵と対になる公開鍵）
   - `COGNITO_ALLOWED_USER_IDS`（Cognito ユーザー作成後に設定。下記参照）
5. ワークフローを一度実行します。Cognito ユーザープールと Hosted UI、利用状況および
   購読情報の保存先、PWA 配信環境、Keeper・Dash・Push の各 Lambda、毎日の Keeper
   スケジュール、および毎週水曜日 16:00（日本時間）の Dash スケジュールが作成されます。
   初回実行では、許可リストが設定されるまで API リクエストを拒否する初期値が使われます。
   そのため、家族の利用者 ID を設定するまで API リクエストは拒否されます。
6. AWS CLI または Cognito コンソールを使って、家族それぞれの Cognito ユーザーを
   作成し、対応する図書館カード番号を `custom:cardNo` 属性に設定します。CLI の例：

   ```sh
   aws cognito-idp admin-create-user \
     --user-pool-id <CognitoUserPoolId output> \
     --username member@example.com
   aws cognito-idp admin-update-user-attributes \
     --user-pool-id <CognitoUserPoolId output> \
     --username member@example.com \
     --user-attributes Name=custom:cardNo,Value=<cardNo>
   ```

   各ユーザーの `sub` を取得し、4人分の `sub` をカンマ区切りで
   `COGNITO_ALLOWED_USER_IDS` Secret に設定して、ワークフローをもう一度実行してください。
   `custom:cardNo` はアプリから変更できず、Cognito ID トークンに含まれます。
   必ず管理者権限で設定してください。
   ユーザーの恒久パスワードは Cognito コンソールまたは `admin-set-user-password` で設定します。

コールバック URL とサインアウト URL には、スタックが出力する CloudFront URL を使用します。
PWA はその URL と同一のオリジン、Cognito Hosted UI、および認証済みの Push Function URL
を `/status` と `/subscriptions` の両方で使用します。利用状況を保存する S3 バケットは
パブリックアクセスをブロックします。スナップショットを読み書きできるのは Keeper のみで、
Push API は許可リストに含まれる Cognito ID トークンを検証した後に読み取れます。

## Dash のローカルテスト

Dash は Google 検索によるグラウンディングを有効にした Gemini Flash で新着本を評価します。
安全にローカル評価できるよう、REPL は既定で dry-run になっており、本番用とは別の
ローカル履歴ファイルに書き込みます。実際に予約するには、明示的に dry-run を無効に
する必要があります。
