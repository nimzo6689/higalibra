# AWS へのデプロイ

`.github/workflows/cicd.yaml` は Keeper、Dash、Push の各パッケージと Mesh PWA
をビルド・テストし、Lambda パッケージと CloudFormation スタックをデプロイした後、
CloudFront 配下の非公開 S3 バケットに PWA を公開します。ワークフローのコマンドには
Nushell を使用します。デプロイは `main` への push 時に実行されるほか、
`workflow_dispatch` から手動で開始できます。

Lambda の production dependencies は `node-linker=hoisted` で配置します。これにより、
Scraping や Push などの workspace package が使う依存関係も Lambda の `node_modules`
直下から解決できます。

Lambda の IAM 権限を変更した場合は、GitHub Actions のデプロイを再実行して
CloudFormation スタックを更新してください。Lambda ZIP のみを差し替えても IAM
ロールのポリシーは更新されません。Keeper / Dash は状態・調査履歴を扱う各 S3 bucket の
`s3:ListBucket` と object 権限を使います。Mesh のデータ API は同一 CloudFront
origin にまとめ、`/status` は OAC で保護した StatusBucket origin、`/subscriptions` は
OAC で保護した Push Lambda URL origin にルーティングします。

CloudFront の viewer-request Lambda@Edge は必ず us-east-1 に作成し、Cognito ID token の
署名・audience・期限を検証します。ログイン可能なアカウントの制限は Google OAuth 側で
設定します。GitHub Actions の AWS role には
us-east-1 の Lambda@Edge 関数発行権限と、CloudFront / IAM / Lambda / CloudFormation の
更新権限も必要です。Push Lambda URL は `AWS_IAM` にし、CloudFront OAC のみが呼び出せる
ようにします。認証は同一 origin の CloudFront data paths で行うため CORS は設定しません。

## 初回セットアップ

1. GitHub Actions の OIDC 用に AWS IAM ロールを作成し、リポジトリ Secret
   `AWS_ROLE_ARN` にその ARN を設定します。ロールの信頼ポリシーは、このリポジトリと
   `main` ブランチに限定してください。
2. [backend/keeper/README.md](./backend/keeper/README.md) と
   [backend/dash/README.md](./backend/dash/README.md) に記載された JSON 形式に従って、
   Systems Manager Parameter Store に `/higalibra/keeper` という名前で
   `SecureString` パラメーターを作成します。リポジトリ Secret
   `KEEPER_PARAMETER_NAME` には `/higalibra/keeper` またはその完全な ARN を設定します。
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

4. Google Cloud Console で Web application の OAuth クライアントを作成します。
   承認済みのリダイレクト URI に
   `https://<COGNITO_DOMAIN_PREFIX>.auth.<AWS_REGION>.amazoncognito.com/oauth2/idpresponse`
   を登録します（AWS リージョンを省略した場合は `ap-northeast-1`）。
   発行されたクライアント ID とクライアント シークレットを、それぞれ
   `GOOGLE_OAUTH_CLIENT_ID` と `GOOGLE_OAUTH_CLIENT_SECRET` として GitHub Actions
   リポジトリ Secrets に登録してください。許可するメールアドレスを Google OAuth
   側でも制限してください。OAuth クライアント ID とシークレットだけでは通常、
   ログイン可能なメールアドレスは限定されません。Google OAuth の Audience が
   Testing の場合は Test users のみが利用できますが、アプリを Production に切り替えると
   この制限がなくなるため、Google Workspace の Internal 設定など別の制限を確認してください。
5. 次の GitHub Actions リポジトリ Secrets を設定します。
   - `AWS_REGION`（省略可。既定値は `ap-northeast-1`）
   - `COGNITO_DOMAIN_PREFIX`（必須。全体で一意な小文字の Cognito ドメイン）
   - `GOOGLE_OAUTH_CLIENT_ID`（必須。Google OAuth クライアント ID）
   - `GOOGLE_OAUTH_CLIENT_SECRET`（必須。Google OAuth クライアント シークレット）
   - `VAPID_PUBLIC_KEY`（必須。Parameter Store に設定した鍵と対になる公開鍵）
6. ワークフローを一度実行します。Cognito ユーザープールと Hosted UI、利用状況および
   購読情報の保存先、PWA 配信環境、Keeper・Dash・Push の各 Lambda、毎日の Keeper
   スケジュール、および毎週水曜日 16:00（日本時間）の Dash スケジュールが作成されます。
7. AWS CLI または Cognito コンソールを使って、家族それぞれの Cognito ユーザーを
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

   Google ログインを既存の Cognito ユーザーに紐付ける場合は、
   `admin-link-provider-for-user` を使い、Google アカウントの `sub` を既存ユーザーに
   リンクしてください。リンク後も既存ユーザーの `sub` と `custom:cardNo` が維持されます。
   例では Google の `sub` を `GOOGLE_SUB`、既存ユーザーのメールアドレスを
   `MEMBER_EMAIL` としています。

   ```sh
   aws cognito-idp admin-link-provider-for-user \
     --user-pool-id <CognitoUserPoolId output> \
     --destination-user ProviderName=Cognito,ProviderAttributeValue=MEMBER_EMAIL \
     --source-user ProviderName=Google,ProviderAttributeName=Cognito_Subject,ProviderAttributeValue=GOOGLE_SUB
   ```

   Google アカウントの `sub` は Google の OpenID Connect ユーザー情報から確認します。
   Google アカウントのメールアドレスと既存ユーザーのメールアドレスが一致することを
   確認してください。リンクしない場合は Google ログイン時に別ユーザーが作成され、
   `custom:cardNo` が設定されていないため Push 通知を登録できません。

   `custom:cardNo` はアプリから変更できず、Push API が購読先を利用者に紐付けるために
   Cognito ID トークンから検証します。`/status` と `/subscriptions` は Cognito ID token
   の署名・issuer・audience・期限を検証しますが、Cognito `sub` による個別許可リストは
   使用しません。ユーザー属性の設定と Google アカウントのリンクは、必ず管理者権限で行ってください。

コールバック URL とサインアウト URL には、スタックが出力する CloudFront URL を使用します。
PWA はその CloudFront origin から `/status` と `/subscriptions` を呼びます。Cognito
Hosted UI はログイン画面の表示と PKCE code exchange に使用します。状態 S3 bucket は
パブリックアクセスをブロックし、CloudFront OAC からのみ読み出せます。`/status` と
`/subscriptions` の認証は Lambda@Edge が行い、静的なログイン画面と SPA shell はログイン前にも
配信されます。

## Dash のローカルテスト

Dash は Google 検索によるグラウンディングを有効にした Gemini Flash で新着本を評価します。
安全にローカル評価できるよう、REPL は既定で dry-run になっており、本番用とは別の
ローカル履歴ファイルに書き込みます。実際に予約するには、明示的に dry-run を無効に
する必要があります。
