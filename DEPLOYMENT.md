# AWS へのデプロイ

`.github/workflows/cicd.yaml` は Keeper、Dash、Push の各パッケージと Mesh PWA
をビルド・テストし、Lambda パッケージと CloudFormation スタックをデプロイした後、
CloudFront 配下の非公開 S3 バケットに PWA を公開します。ワークフローのコマンドには
Nushell を使用します。デプロイは `main` への push 時に実行されるほか、
`workflow_dispatch` から手動で開始できます。

## 初回セットアップ

1. GitHub Actions の OIDC 用に AWS IAM ロールを作成し、リポジトリ変数
   `AWS_ROLE_ARN` にその ARN を設定します。ロールの信頼ポリシーは、このリポジトリと
   `main` ブランチ（GitHub environment を使用する場合はその environment も）に限定して
   ください。ロールには、成果物バケットの作成・読み取り、Lambda zip のアップロード、
   `infra.yaml` の CloudFormation リソースのデプロイ、Lambda 実行ロールの
   `iam:PassRole`、Mesh バケットへの同期、CloudFront ディストリビューションの
   キャッシュ無効化に必要な権限を付与します。
2. [backend/keeper/README.md](./backend/keeper/README.md) と
   [backend/dash/README.md](./backend/dash/README.md) に記載された JSON 形式に従って、
   Keeper と Dash 用の Secrets Manager シークレットを作成します。リポジトリ変数
   `KEEPER_SECRET_ARN` にその ARN を設定してください。シークレットには、図書館の
   4 アカウント分の情報、VAPID 認証情報、Google AI Studio API キー、および Dash が
   予約に使用できるアカウントを1つ選択する `reservationUserId` を含めます。
3. リポジトリ変数を設定します。
   - `AWS_REGION`（省略可。既定値は `ap-northeast-1`）
   - `COGNITO_DOMAIN_PREFIX`（必須。全体で一意な小文字の Cognito ドメイン）
   - `VAPID_PUBLIC_KEY`（必須。Keeper のシークレットに設定した鍵と対になる公開鍵）
   - `COGNITO_ALLOWED_USER_IDS`（Cognito ユーザー作成後に設定。下記参照）
4. ワークフローを一度実行します。Cognito ユーザープールと Hosted UI、利用状況および
   購読情報の保存先、PWA 配信環境、Keeper・Dash・Push の各 Lambda、毎日の Keeper
   スケジュール、および毎週水曜日 16:00（日本時間）の Dash スケジュールが作成されます。
   初回実行では、許可リストが設定されるまで API リクエストを拒否する初期値が使われます。
   そのため、家族の利用者 ID を設定するまで API リクエストは拒否されます。
5. AWS CLI または Cognito コンソールを使って、家族それぞれの Cognito ユーザーを作成
   します。例：

   ```sh
   aws cognito-idp admin-create-user \
     --user-pool-id <CognitoUserPoolId output> \
     --username member@example.com
   ```

   各ユーザーの `sub` 属性を取得し、4人分の `sub` をカンマ区切りで
   `COGNITO_ALLOWED_USER_IDS` に設定します。Keeper のシークレットにある `userId` にも
   同じ ID を使用し、ワークフローをもう一度実行してください。ユーザーの恒久パスワードは
   Cognito コンソールまたは `admin-set-user-password` で設定します。

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
