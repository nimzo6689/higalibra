def main [subject_arg?: string] {
  let parameter_name = '/higalibra/keeper'
  let region = ($env.AWS_REGION? | default 'ap-northeast-1')
  let subject = (
    if ($subject_arg | is-empty) {
      input 'VAPID subject (mailto:email@example.com or https://example.com): '
    } else {
      $subject_arg
    } | str trim
  )
  if not ($subject starts-with 'mailto:' or $subject starts-with 'https://') {
    error make { msg: 'VAPID subject must start with mailto: or https://.' }
  }

  let generated = (^pnpm --filter @higalibra/push exec web-push generate-vapid-keys --json | complete)
  if $generated.exit_code != 0 {
    print $generated.stderr
    error make { msg: 'Could not generate VAPID keys with web-push.' }
  }
  let keys = ($generated.stdout | from json)

  let current = (^aws ssm get-parameter --region $region --name $parameter_name --with-decryption --output json | complete)
  if $current.exit_code != 0 {
    print $current.stderr
    error make { msg: $"Could not read SSM parameter ($parameter_name)." }
  }
  let parameter = ($current.stdout | from json | get Parameter)
  if $parameter.Type != 'SecureString' {
    error make { msg: $"SSM parameter ($parameter_name) must be a SecureString." }
  }

  let config = ($parameter.Value | from json)
  if (($config.users? | length) != 4) {
    error make { msg: 'SSM configuration is missing users; no parameter changes were made.' }
  }
  let updated_config = (
    $config
    | upsert vapid {
      subject: $subject
      publicKey: $keys.publicKey
      privateKey: $keys.privateKey
    }
  )

  let temp_path = (^mktemp | str trim)
  ^chmod 600 $temp_path
  let request = {
    Name: $parameter_name
    Type: SecureString
    Value: ($updated_config | to json -r)
    Overwrite: true
  }
  let request = if ($parameter.KeyId? | is-empty) {
    $request
  } else {
    $request | upsert KeyId $parameter.KeyId
  }
  $request | to json -r | save --force $temp_path
  let updated = (^aws ssm put-parameter --region $region --cli-input-json $"file://($temp_path)" | complete)
  rm $temp_path
  if $updated.exit_code != 0 {
    print $updated.stderr
    error make { msg: $"Could not update SSM parameter ($parameter_name)." }
  }

  print $"VAPID key pair saved to SSM SecureString: ($parameter_name)"
  let gh_available = (which gh | is-not-empty)
  let gh_authenticated = if $gh_available {
    (^gh auth status | complete).exit_code == 0
  } else {
    false
  }
  if $gh_authenticated {
    let gh_result = (^gh secret set VAPID_PUBLIC_KEY --body $keys.publicKey | complete)
    if $gh_result.exit_code == 0 {
      print 'GitHub Actions secret VAPID_PUBLIC_KEY was updated.'
    } else {
      print $gh_result.stderr
      print 'Could not update the GitHub secret; set it manually with the public key below.'
    }
  } else {
    print 'Set this public key as the GitHub Actions secret VAPID_PUBLIC_KEY:'
  }
  print $keys.publicKey
}
