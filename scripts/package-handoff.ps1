param(
  [string]$OutputName = ""
)

$ErrorActionPreference = "Stop"
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$workspaceRoot = Split-Path (Split-Path $sourceRoot -Parent) -Parent
$outputRoot = Join-Path $workspaceRoot "outputs"
if ([string]::IsNullOrWhiteSpace($OutputName)) {
  $OutputName = "sac-flow-handoff-$(Get-Date -Format 'yyyyMMdd-HHmmss').zip"
}
$outputPath = Join-Path $outputRoot $OutputName

if (Test-Path -LiteralPath $outputPath) {
  throw "El paquete ya existe: $outputPath"
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$excludedDirectoryPattern = '^(node_modules|dist|dist-api|data|logs|coverage|work|\.git)(\\|$)'
$excludedExtensions = @(".zip", ".xlsx", ".log", ".tsbuildinfo")
$files = Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | Where-Object {
  $relative = [System.IO.Path]::GetRelativePath($sourceRoot, $_.FullName)
  $name = $_.Name
  $isPrivateEnv = $name -like ".env*" -and $name -ne ".env.example"
  $relative -notmatch $excludedDirectoryPattern `
    -and -not $isPrivateEnv `
    -and $_.Extension -notin $excludedExtensions `
    -and $name -ne ".DS_Store"
}

$archive = [System.IO.Compression.ZipFile]::Open(
  $outputPath,
  [System.IO.Compression.ZipArchiveMode]::Create
)
try {
  foreach ($file in $files) {
    $relative = [System.IO.Path]::GetRelativePath($sourceRoot, $file.FullName).Replace("\", "/")
    $entry = $archive.CreateEntry("sac-flow/$relative", [System.IO.Compression.CompressionLevel]::Optimal)
    $entryStream = $entry.Open()
    $fileStream = [System.IO.File]::OpenRead($file.FullName)
    try {
      $fileStream.CopyTo($entryStream)
    } finally {
      $fileStream.Dispose()
      $entryStream.Dispose()
    }
  }
} finally {
  $archive.Dispose()
}

Write-Output "Created $outputPath with $($files.Count) files."
