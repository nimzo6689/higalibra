# ビルド成果物の出力先を用意します。
mkdir .artifacts

# 各パッケージのビルド・テスト・Lintを実行します。
let tasks = [
  { package: '@higalibra/keeper', command: build }
  { package: '@higalibra/dash', command: build }
  { package: '@higalibra/push', command: build }
  { package: '@higalibra/mesh', command: build }
  { package: '@higalibra/keeper', command: test }
  { package: '@higalibra/dash', command: test }
  { package: '@higalibra/push', command: test }
  { package: '@higalibra/keeper', command: lint }
  { package: '@higalibra/dash', command: lint }
  { package: '@higalibra/scraping', command: lint }
  { package: '@higalibra/push', command: lint }
  { package: '@higalibra/mesh', command: lint }
]
for task in $tasks {
  ^pnpm --filter $task.package $task.command
}
^pnpm exec eslint backend/edge-auth
^node --test backend/edge-auth/test/handler.test.mjs

# Lambda関数を本番依存関係のみで配置し、ZIPにまとめます。
let artifacts = [
  { package: '@higalibra/keeper', path: '.artifacts/keeper', name: 'keeper' }
  { package: '@higalibra/dash', path: '.artifacts/dash', name: 'dash' }
  { package: '@higalibra/push', path: '.artifacts/push', name: 'push' }
]
for artifact in $artifacts {
  ^pnpm --filter $artifact.package deploy --prod $artifact.path --config.node-linker=hoisted
  '{"type":"module"}' | save --force $"($artifact.path)/package.json"
  do {
    cd $artifact.path
    ^zip -qr $"../($artifact.name).zip" .
  }
}

# アカウントIDとリージョンから成果物用S3バケットを特定し、なければ作成します。
let account_id = (^aws sts get-caller-identity --query Account --output text | str trim)
let bucket = $"higalibra-artifacts-($account_id)-($env.AWS_REGION)"
let bucket_check = (^aws s3api head-bucket --bucket $bucket | complete)
if $bucket_check.exit_code != 0 {
  ^aws s3 mb $"s3://($bucket)" --region $env.AWS_REGION
}

# 成果物用バケットのパブリックアクセスをすべて禁止します。
let public_access_block = {
  BlockPublicAcls: true
  IgnorePublicAcls: true
  BlockPublicPolicy: true
  RestrictPublicBuckets: true
}
^aws s3api put-public-access-block --bucket $bucket --public-access-block-configuration ($public_access_block | to json -r)

# 成果物用バケットのデフォルト暗号化を有効にします。
let encryption = {
  Rules: [{
    ApplyServerSideEncryptionByDefault: {
      SSEAlgorithm: AES256
    }
  }]
}
(
  ^aws s3api put-bucket-encryption
      --bucket $bucket
      --server-side-encryption-configuration ($encryption | to json -r)
)

# ZIPをコミットSHAごとのキーで成果物用バケットへアップロードします。
let uploads = $artifacts | each {|artifact|
  {
    file: $"($artifact.path).zip"
    destination: $"s3://($bucket)/($env.GITHUB_SHA)/($artifact.name).zip"
  }
}
for upload in $uploads {
  ^aws s3 cp $upload.file $upload.destination
}

# インフラのデプロイに必要なGitHub Actions Secretが設定されているか確認します。
let required_variables = [
  { name: KEEPER_PARAMETER_NAME, value: $env.KEEPER_PARAMETER_NAME }
  { name: ALLOWED_EMAILS_PARAMETER_NAME, value: $env.ALLOWED_EMAILS_PARAMETER_NAME }
  { name: COGNITO_DOMAIN_PREFIX, value: $env.COGNITO_DOMAIN_PREFIX }
  { name: GOOGLE_OAUTH_CLIENT_ID, value: $env.GOOGLE_OAUTH_CLIENT_ID }
  { name: GOOGLE_OAUTH_CLIENT_SECRET, value: $env.GOOGLE_OAUTH_CLIENT_SECRET }
  { name: VAPID_PUBLIC_KEY, value: $env.VAPID_PUBLIC_KEY }
]
let missing = $required_variables | where {|variable| $variable.value | is-empty }
if not ($missing | is-empty) {
  let names = $missing | get name | str join ', '
  error make { msg: $"Set the required GitHub Actions repository secrets: ($names)." }
}

# 成果物の配置先や認証情報をCloudFormationのパラメーターに変換します。
let current_stack_status = (
  ^aws cloudformation list-stacks
      --query $"StackSummaries[?StackName=='($env.STACK_NAME)' && StackStatus!='DELETE_COMPLETE'] | [0].StackStatus"
      --output text
      | str trim
)
let current_edge_auth_arn = if $current_stack_status == 'None' {
  'NONE'
} else {
  (
    ^aws cloudformation describe-stacks
        --stack-name $env.STACK_NAME
        --query 'Stacks[0].Parameters[?ParameterKey==`EdgeAuthFunctionVersionArn`] | [0].ParameterValue'
        --output text
        | str trim
  )
}
let current_edge_auth_arn = if $current_edge_auth_arn == 'None' {
  'NONE'
} else {
  $current_edge_auth_arn
}
let parameters = [
  { name: ArtifactBucketName, value: $bucket }
  { name: KeeperObjectKey, value: $"($env.GITHUB_SHA)/keeper.zip" }
  { name: DashObjectKey, value: $"($env.GITHUB_SHA)/dash.zip" }
  { name: PushObjectKey, value: $"($env.GITHUB_SHA)/push.zip" }
  { name: KeeperParameterName, value: $env.KEEPER_PARAMETER_NAME }
  { name: AllowedEmailsParameterName, value: $env.ALLOWED_EMAILS_PARAMETER_NAME }
  { name: HostedUiDomainPrefix, value: $env.COGNITO_DOMAIN_PREFIX }
  { name: GoogleOAuthClientId, value: $env.GOOGLE_OAUTH_CLIENT_ID }
  { name: GoogleOAuthClientSecret, value: $env.GOOGLE_OAUTH_CLIENT_SECRET }
  { name: EdgeAuthFunctionVersionArn, value: $current_edge_auth_arn }
] | each {|parameter| $"($parameter.name)=($parameter.value)" }

# CloudFormationスタックとLambda関数をデプロイします。
(
  ^aws cloudformation deploy
      --template-file infra.yaml
      --stack-name $env.STACK_NAME
      --capabilities CAPABILITY_NAMED_IAM
      --no-fail-on-empty-changeset
      --parameter-overrides ...$parameters
)

# スタック出力を取得します。
let stack_outputs = (
  (
    ^aws cloudformation describe-stacks
        --stack-name $env.STACK_NAME
        --query 'Stacks[0].Outputs' --output json
        | from json
        | reduce --fold {} {|output, result|
            $result | insert $output.OutputKey $output.OutputValue
          }
  )
)

# Lambda@Edgeはus-east-1に配置し、Cognitoの公開設定をコードと一緒に発行します。
mkdir .artifacts/edge-auth
let edge_configuration = {
  region: $env.AWS_REGION
  userPoolId: $stack_outputs.CognitoUserPoolId
  clientId: $stack_outputs.CognitoUserPoolClientId
  statusKey: $stack_outputs.StatusKey
}
$edge_configuration | to json -r | save --force .artifacts/edge-auth/config.json
cp backend/edge-auth/handler.mjs .artifacts/edge-auth/handler.mjs
cp backend/edge-auth/index.mjs .artifacts/edge-auth/index.mjs
do {
  cd .artifacts/edge-auth
  ^zip -q ../edge-auth.zip index.mjs handler.mjs config.json
}

(
  ^aws cloudformation deploy
      --region us-east-1
      --template-file backend/edge-auth/infra.yaml
      --stack-name $"($env.STACK_NAME)-edge-auth"
      --capabilities CAPABILITY_NAMED_IAM
      --no-fail-on-empty-changeset
)
let edge_role_arn = (
  ^aws cloudformation describe-stacks
      --region us-east-1
      --stack-name $"($env.STACK_NAME)-edge-auth"
      --query 'Stacks[0].Outputs[?OutputKey==`EdgeAuthExecutionRoleArn`].OutputValue | [0]'
      --output text
      | str trim
)
let edge_function_name = $"($env.STACK_NAME)-edge-auth"
let edge_function_check = (
  ^aws lambda get-function-configuration
      --region us-east-1
      --function-name $edge_function_name
      | complete
)
let edge_deployment = if $edge_function_check.exit_code == 0 {
  (
    ^aws lambda update-function-code
        --region us-east-1
        --function-name $edge_function_name
        --zip-file fileb://.artifacts/edge-auth.zip
        --publish
      | from json
  )
} else {
  (
    ^aws lambda create-function
        --region us-east-1
        --function-name $edge_function_name
        --runtime nodejs22.x
        --handler index.handler
        --role $edge_role_arn
        --timeout 5
        --memory-size 128
        --publish
        --zip-file fileb://.artifacts/edge-auth.zip
      | from json
  )
}
^aws lambda wait function-active-v2 --region us-east-1 --function-name $edge_function_name
let edge_function_arn = (
  ^aws lambda get-function-configuration
      --region us-east-1
      --function-name $edge_function_name
      --query FunctionArn
      --output text
      | str trim
)
let edge_function = $"($edge_function_arn):($edge_deployment.Version)"
let activated_parameters = $parameters
  | where {|parameter| not ($parameter | str starts-with 'EdgeAuthFunctionVersionArn=') }
  | append $"EdgeAuthFunctionVersionArn=($edge_function)"
(
  ^aws cloudformation deploy
      --template-file infra.yaml
      --stack-name $env.STACK_NAME
      --capabilities CAPABILITY_NAMED_IAM
      --no-fail-on-empty-changeset
      --parameter-overrides ...$activated_parameters
)

let frontend_environment = {
  VITE_COGNITO_DOMAIN: $stack_outputs.CognitoHostedUiDomain
  VITE_COGNITO_CLIENT_ID: $stack_outputs.CognitoUserPoolClientId
  VITE_COGNITO_REDIRECT_URI: $stack_outputs.MeshUrl
  VITE_STATUS_URL: $"($stack_outputs.MeshUrl)status"
  VITE_PUSH_API_URL: $stack_outputs.MeshUrl
  VITE_VAPID_PUBLIC_KEY: $env.VAPID_PUBLIC_KEY
}

# PWAをスタック固有の設定でビルドしてS3へ公開し、CloudFrontのキャッシュを無効化します。
with-env $frontend_environment {
  ^pnpm --filter @higalibra/mesh build
}
let deployment = {
  bucket: $"s3://($stack_outputs.MeshBucketName)"
  distribution_id: $stack_outputs.MeshDistributionId
}
^aws s3 sync frontend/dist $deployment.bucket --delete
^aws cloudfront create-invalidation --distribution-id $deployment.distribution_id --paths '/*'
