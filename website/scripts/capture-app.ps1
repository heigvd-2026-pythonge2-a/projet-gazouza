# Takes again the screenshot of the home page (src/assets/psice-app.png) from the online demo:
# the voltage divider of shared/fixtures/, simulated, with the results panel open.
#
# Run from website/ after `pnpm build:demo` in frontend/:
#   .\scripts\capture-app.ps1
# Needs Microsoft Edge (installed with Windows). Nothing is served: Edge opens the built files.

$ErrorActionPreference = "Stop"
$demo = Join-Path $PSScriptRoot "..\public\demo" | Resolve-Path
$out = Join-Path $PSScriptRoot "..\src\assets\psice-app.png"
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path "$demo\index.html")) { throw "Demo not built: run 'pnpm build:demo' in frontend/ first." }

# A copy of the demo page that simulates the example, hides the properties panel and fits the view.
$clicks = @'
<script>
  const click = (selector) => document.querySelector(selector)?.click();
  setTimeout(() => click('button[title="Lancer la simulation"]'), 1500);
  setTimeout(() => click('button[title="Masquer le panneau des propriétés"]'), 2000);
  setTimeout(() => click('[aria-label="Ajuster la vue au circuit (F)"]'), 2500);
</script>
</body>
'@
$page = Join-Path $demo "capture.html"
(Get-Content "$demo\index.html" -Raw -Encoding UTF8).Replace("</body>", $clicks) |
  Set-Content $page -Encoding UTF8 -NoNewline

$edgeProfile = Join-Path ([IO.Path]::GetTempPath()) "psice-capture-$(Get-Random)"
$url = "file:///" + ($page -replace "\\", "/") + "?demo=divider_op"
try {
  $edgeArgs = @(
    "--headless", "--hide-scrollbars", "--no-first-run", "--allow-file-access-from-files",
    "--user-data-dir=$edgeProfile", "--window-size=1280,760", "--force-device-scale-factor=2",
    "--virtual-time-budget=5000", "--run-all-compositor-stages-before-draw",
    "--screenshot=$out", $url
  )
  Start-Process -FilePath $edge -ArgumentList $edgeArgs -Wait -NoNewWindow
  Write-Host "Screenshot written to $out"
} finally {
  Remove-Item $page -ErrorAction SilentlyContinue
  Remove-Item $edgeProfile -Recurse -Force -ErrorAction SilentlyContinue
}
