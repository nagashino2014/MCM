# Illustrator 2026 COM 으로 ai_to_pdf.jsx 를 실행한다. asset_matcher.py convert 가 호출한다.
# 사용: powershell -NoProfile -ExecutionPolicy Bypass -File ai_to_pdf.ps1 -JobFile <job.js>
param(
    [Parameter(Mandatory = $true)][string]$JobFile
)

$ErrorActionPreference = 'Stop'
$jsx = Join-Path $PSScriptRoot 'ai_to_pdf.jsx'
$jobPath = (Resolve-Path -LiteralPath $JobFile).Path -replace '\\', '/'
$code = 'var JOB_FILE = "' + $jobPath + '";' + "`n" + [System.IO.File]::ReadAllText($jsx, [System.Text.Encoding]::UTF8)

$ai = New-Object -ComObject Illustrator.Application
$result = $ai.DoJavaScript($code)
Write-Output "jsx: $result"
