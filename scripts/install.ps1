# One-line install of OmO UI Windows together with omo (Windows PowerShell 5.1 and PowerShell 7+):
#   irm https://raw.githubusercontent.com/purrbeard/omo-ui-windows/windows-support/scripts/install.ps1 | iex
# Installs omo with the official installer when omo.exe is missing, then downloads the newest OmO UI Windows
# release (prereleases included) from this repository, verifies its SHA-256 and runs the per-user installer silently.
#   OMO_UI_VERSION=0.1.4-win.18  install that release instead of the newest one
#   OMO_UI_SKIP_OMO=1            never install omo
#   OMO_UI_NO_LAUNCH=1           do not open the app after installing
# The whole body runs from Install-OmoUi on the last line, so a truncated download never runs half a script.

function Install-OmoUi {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $Repo = 'purrbeard/omo-ui-windows'
  $OmoInstaller = 'https://get.omo.dev/install.ps1'
  $UserAgent = 'omo-ui-windows-install.ps1/1'
  $AppDir = Join-Path $env:LOCALAPPDATA 'Programs\OmO UI Windows'
  $AppExe = Join-Path $AppDir 'OmO UI Windows.exe'

  function Say([string]$Message) { Write-Host "omo-ui: $Message" }
  function Fail([string]$Message) { throw "omo-ui install: $Message" }

  if (-not [Environment]::Is64BitOperatingSystem) { Fail 'OmO UI Windows needs 64-bit Windows (x64)' }

  # 1. omo: the same discovery order the app uses (install.json, ~/.local/bin, PATH).
  $omo = $null
  $installJson = Join-Path $HOME '.omo\install.json'
  if (Test-Path -LiteralPath $installJson) {
    try { $bin = [string](Get-Content -LiteralPath $installJson -Raw | ConvertFrom-Json).binPath; if ($bin -and (Test-Path -LiteralPath $bin)) { $omo = $bin } } catch { }
  }
  if (-not $omo) { $candidate = Join-Path $HOME '.local\bin\omo.exe'; if (Test-Path -LiteralPath $candidate) { $omo = $candidate } }
  if (-not $omo) { $cmd = Get-Command omo.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; if ($cmd) { $omo = $cmd.Path } }
  if ($omo) {
    Say "omo found at $omo"
  } elseif ($env:OMO_UI_SKIP_OMO -eq '1') {
    Say 'omo is not installed; skipped because OMO_UI_SKIP_OMO=1 (the app can install it on first launch)'
  } else {
    Say "omo not found; running the official installer ($OmoInstaller)"
    $script = (Invoke-WebRequest -UseBasicParsing -Uri $OmoInstaller -UserAgent $UserAgent).Content
    & ([scriptblock]::Create($script)) latest
    $omo = Join-Path $HOME '.local\bin\omo.exe'
    if (-not (Test-Path -LiteralPath $omo)) { Fail "the omo installer finished but $omo is missing" }
    Say "omo installed: $(& $omo --version)"
  }

  # 2. Pick the release: newest non-draft release of this repository with a Windows installer.
  $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases?per_page=30" -UserAgent $UserAgent -Headers @{ Accept = 'application/vnd.github+json' }
  $release = $null
  $asset = $null
  foreach ($candidate in $releases) {
    if ($candidate.draft) { continue }
    $version = ([string]$candidate.tag_name) -replace '^v', ''
    if ($env:OMO_UI_VERSION -and $version -ne $env:OMO_UI_VERSION) { continue }
    $found = $candidate.assets | Where-Object { $_.name -ceq "OmO.UI.Windows.Setup.$version.exe" } | Select-Object -First 1
    if ($found) { $release = $candidate; $asset = $found; break }
  }
  if (-not $release) {
    if ($env:OMO_UI_VERSION) { Fail "release v$($env:OMO_UI_VERSION) with a Windows installer was not found in $Repo" }
    Fail "no release of $Repo has a Windows installer yet"
  }
  $version = ([string]$release.tag_name) -replace '^v', ''

  # 3. The expected hash: GitHub's asset digest, else the SHA256SUMS line naming the installer.
  $expected = ''
  if ([string]$asset.digest -match '^sha256:([0-9a-fA-F]{64})$') { $expected = $Matches[1].ToLowerInvariant() }
  if (-not $expected) {
    $sums = $release.assets | Where-Object { $_.name -ceq 'SHA256SUMS' } | Select-Object -First 1
    if (-not $sums) { Fail "release v$version has neither an asset digest nor SHA256SUMS" }
    $text = (Invoke-WebRequest -UseBasicParsing -Uri $sums.browser_download_url -UserAgent $UserAgent).Content
    if ($text -is [byte[]]) { $text = [Text.Encoding]::UTF8.GetString($text) }
    foreach ($line in ($text -split "\r?\n")) {
      $fields = $line.Trim() -split '\s+', 2
      if ($fields.Count -eq 2 -and $fields[1].TrimStart('*') -ceq "OmO UI Windows Setup $version.exe" -and $fields[0] -match '^[0-9A-Fa-f]{64}$') { $expected = $fields[0].ToLowerInvariant() }
    }
    if (-not $expected) { Fail "SHA256SUMS of v$version does not name the installer" }
  }

  $running = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -ieq $AppExe }
  if ($running) { Fail 'OmO UI Windows is running; quit it (finish active turns first) and run this again' }

  # 4. Download, verify, install silently for the current user.
  $work = Join-Path ([IO.Path]::GetTempPath()) ("omo-ui-install-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    $setup = Join-Path $work "OmO UI Windows Setup $version.exe"
    Say "downloading v$version ($([math]::Round($asset.size / 1MB)) MB)"
    Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $setup -UserAgent $UserAgent
    $actual = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { Fail "SHA-256 mismatch for the installer (expected $expected, got $actual)" }
    Say "SHA-256 verified ($expected)"
    Say 'installing for the current user'
    $process = Start-Process -FilePath $setup -ArgumentList '/S', '/currentuser' -Wait -PassThru
    if ($process.ExitCode -ne 0) { Fail "the installer exited with code $($process.ExitCode)" }
  } finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (-not (Test-Path -LiteralPath $AppExe)) { Fail "the installer finished but $AppExe is missing" }
  Say "installed OmO UI Windows $version at $AppDir"

  if ($env:OMO_UI_NO_LAUNCH -ne '1') {
    Start-Process -FilePath $AppExe | Out-Null
    Say 'opened OmO UI Windows'
  }
}

Install-OmoUi
