param(
  [string]$OutputPath = ".env.production",
  [string]$SiteApiKey = "",
  [string]$SiteOrigin = ""
)

$ErrorActionPreference = "Stop"
$resolved = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
if (Test-Path -LiteralPath $resolved) {
  throw "El archivo $resolved ya existe; no se sobrescribirá."
}

function New-RandomSecret([int]$Bytes = 32) {
  $buffer = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return [Convert]::ToBase64String($buffer).Replace("+", "-").Replace("/", "_").TrimEnd("=")
}

$apiKey = if ($SiteApiKey.Trim()) { $SiteApiKey.Trim() } else { New-RandomSecret 32 }
$postgresPassword = New-RandomSecret 36
$encryptionKey = New-RandomSecret 48
$credentialEncryptionKey = New-RandomSecret 48
$origin = $SiteOrigin.Trim()

$content = @"
# Generated locally by scripts/bootstrap-production.ps1. Do not commit.
SAC_FLOW_API_KEY=$apiKey
SAC_FLOW_POSTGRES_PASSWORD=$postgresPassword
SAC_FLOW_POSTGRES_ENCRYPTION_KEY=$encryptionKey
SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY=$credentialEncryptionKey
SAC_FLOW_CORS_ORIGINS=$origin
SAC_FLOW_DISABLE_OUTBOUND_SENDS=true
SAC_FLOW_DISABLE_EXTERNAL_NODES=true
SAC_FLOW_DISABLE_METRICOOL_MUTATIONS=true
SAC_FLOW_AUTO_REPLY_DISPATCH_MODE=shadow
SAC_FLOW_AUTO_REPLY_MAX_PENDING=1000
SAC_FLOW_POSTGRES_SEED_DEMO=false
METRICOOL_MODE=live
METRICOOL_API_TOKEN=
METRICOOL_ACCOUNTS_JSON=
"@

[System.IO.File]::WriteAllText($resolved, $content, [System.Text.UTF8Encoding]::new($false))
Write-Host "Configuración creada en $resolved"
Write-Host "Complete el token y las cuentas autorizadas antes de iniciar; mantenga el cortacorriente activo durante UAT."
