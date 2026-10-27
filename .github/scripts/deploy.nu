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

# Lambda関数を本番依存関係のみで配置し、ZIPにまとめます。
let artifacts = [
  { package: '@higalibra/keeper', path: '.artifacts/keeper', name: 'keeper' }
  { package: '@higalibra/dash', path: '.artifacts/dash', name: 'dash' }
  { package: '@higalibra/push', path: '.artifacts/push', name: 'push' }
]
for artifact in $artifacts {
  ^pnpm --filter $artifact.package deploy --prod $artifact.path
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
^aws s3api put-bucket-encryption --bucket $bucket --server-side-encryption-configuration ($encryption | to json -r)

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
  { name: COGNITO_DOMAIN_PREFIX, value: $env.COGNITO_DOMAIN_PREFIX }
  { name: VAPID_PUBLIC_KEY, value: $env.VAPID_PUBLIC_KEY }
]
let missing = $required_variables | where {|variable| $variable.value | is-empty }
if not ($missing | is-empty) {
  let names = $missing | get name | str join ', '
  error make { msg: $"Set the required GitHub Actions repository secrets: ($names)." }
}

# 成果物の配置先や認証情報をCloudFormationのパラメーターに変換します。
let parameters = [
  { name: ArtifactBucketName, value: $bucket }
  { name: KeeperObjectKey, value: $"($env.GITHUB_SHA)/keeper.zip" }
  { name: DashObjectKey, value: $"($env.GITHUB_SHA)/dash.zip" }
  { name: PushObjectKey, value: $"($env.GITHUB_SHA)/push.zip" }
  { name: KeeperParameterName, value: $env.KEEPER_PARAMETER_NAME }
  { name: AllowedUserIds, value: $env.ALLOWED_USER_IDS }
  { name: HostedUiDomainPrefix, value: $env.COGNITO_DOMAIN_PREFIX }
] | each {|parameter| $"($parameter.name)=($parameter.value)" }

# CloudFormationスタックとLambda関数をデプロイします。
^aws cloudformation deploy --template-file infra.yaml --stack-name $env.STACK_NAME --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset --parameter-overrides ...$parameters

# スタック出力を取得し、後続ステップで使う環境変数としてGitHub Actionsに渡します。
let stack_outputs = (
  ^aws cloudformation describe-stacks --stack-name $env.STACK_NAME --query 'Stacks[0].Outputs' --output json |
    from json |
    reduce --fold {} {|output, result|
      $result | insert $output.OutputKey $output.OutputValue
    }
)
let environment = {
  DEPLOY_BUCKET: $bucket
  MESH_BUCKET: $stack_outputs.MeshBucketName
  DISTRIBUTION_ID: $stack_outputs.MeshDistributionId
  VITE_COGNITO_DOMAIN: $stack_outputs.CognitoHostedUiDomain
  VITE_COGNITO_CLIENT_ID: $stack_outputs.CognitoUserPoolClientId
  VITE_COGNITO_REDIRECT_URI: $stack_outputs.MeshUrl
  VITE_STATUS_URL: $"($stack_outputs.PushFunctionUrl)status"
  VITE_PUSH_API_URL: $stack_outputs.PushFunctionUrl
  VITE_VAPID_PUBLIC_KEY: $env.VAPID_PUBLIC_KEY
}
$environment |
  transpose name value |
  each {|entry| $"($entry.name)=($entry.value)"} |
  str join (char newline) |
  $"($in)(char newline)" |
  save --append $env.GITHUB_ENV

# PWAをビルドしてS3へ公開し、CloudFrontのキャッシュを無効化します。
^pnpm --filter @higalibra/mesh build
let deployment = {
  bucket: $"s3://($stack_outputs.MeshBucketName)"
  distribution_id: $stack_outputs.MeshDistributionId
}
^aws s3 sync frontend/dist $deployment.bucket --delete
^aws cloudfront create-invalidation --distribution-id $deployment.distribution_id --paths '/*'
