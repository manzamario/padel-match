param(
  [Parameter(Mandatory)]
  [string]$ApiKey,
  [string]$ServiceId = "srv-cm0np8d2iqrc73c3npdg"
)

$envFile = "$PSScriptRoot\..\render-env.json"
$body = Get-Content $envFile -Raw

Write-Host "Actualizando variables de entorno en Render..."
try {
  $resp = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$ServiceId/env-vars" -Method Put -Body $body -ContentType "application/json" -Headers @{ Authorization = "Bearer $ApiKey" }
  Write-Host "OK! Variables actualizadas:" -ForegroundColor Green
  $resp | ConvertTo-Json -Depth 5
}
catch {
  Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host ""
  Write-Host "Para encontrar el Service ID:"
  Write-Host "  1. Andá a https://dashboard.render.com"
  Write-Host "  2. Hacé clic en tu servicio 'padel-match'"
  Write-Host "  3. Fijate en la URL del navegador:"
  Write-Host "     https://dashboard.render.com/web/SRV_ID"
  Write-Host "  4. Copiá ese SRV_ID y ejecutá:"
  Write-Host "     .\scripts\set-render-env.ps1 -ApiKey TU_KEY -ServiceId SRV_ID"
}
