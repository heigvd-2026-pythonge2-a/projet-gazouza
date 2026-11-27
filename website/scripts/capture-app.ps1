# Takes again the screenshots of the home page (src/assets/psice-app-light.png and
# psice-app-dark.png) from the online demo: the voltage divider of shared/fixtures/, simulated,
# with the results panel open, once in each theme of the app. The site shows the one of its theme.
#
# Run from website/ after `pnpm build:demo` in frontend/:
#   .\scripts\capture-app.ps1
# Needs Microsoft Edge (installed with Windows). Nothing is served: Edge opens the built files.

$ErrorActionPreference = "Stop"
$demo = Join-Path $PSScriptRoot "..\public\demo" | Resolve-Path
$assets = Join-Path $PSScriptRoot "..\src\assets" | Resolve-Path
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
# The theme is the one chosen with the toolbar button (store/theme.ts), stored before the app
# starts: an inline script runs before the module of the page.
$index = Get-Content "$demo\index.html" -Raw -Encoding UTF8
$page = Join-Path $demo "capture.html"
$url = "file:///" + ($page -replace "\\", "/") + "?demo=divider_op"
try {
  foreach ($theme in "light", "dark") {
    $out = Join-Path $assets "psice-app-$theme.png"
    $setTheme = "<head>`n<script>localStorage.setItem('psice.theme', '$theme');</script>"
    $index.Replace("<head>", $setTheme).Replace("</body>", $clicks) |
      Set-Content $page -Encoding UTF8 -NoNewline

    # A new profile for each theme, so nothing is left from the previous capture.
    $edgeProfile = Join-Path ([IO.Path]::GetTempPath()) "psice-capture-$(Get-Random)"
    try {
      $edgeArgs = @(
        "--headless", "--hide-scrollbars", "--no-first-run", "--allow-file-access-from-files",
        "--user-data-dir=$edgeProfile", "--window-size=1280,760", "--force-device-scale-factor=2",
        "--virtual-time-budget=5000", "--run-all-compositor-stages-before-draw",
        "--screenshot=$out", $url
      )
      Start-Process -FilePath $edge -ArgumentList $edgeArgs -Wait -NoNewWindow
      Write-Host "Screenshot ($theme) written to $out"
    } finally {
      Remove-Item $edgeProfile -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
} finally {
  Remove-Item $page -ErrorAction SilentlyContinue
}
