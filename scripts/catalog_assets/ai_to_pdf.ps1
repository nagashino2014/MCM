# Illustrator 2026 COM 으로 ai_to_pdf.jsx(기본) 또는 -Script 로 준 jsx 를 실행한다.
# asset_matcher.py convert(PDF)·export(SVG, ai_to_svg.jsx)가 호출한다.
# 사용: powershell -NoProfile -ExecutionPolicy Bypass -File ai_to_pdf.ps1 -JobFile <job.js> [-Script ai_to_svg.jsx]
param(
    [Parameter(Mandatory = $true)][string]$JobFile,
    [string]$Script = 'ai_to_pdf.jsx'
)

$ErrorActionPreference = 'Stop'
$jsx = Join-Path $PSScriptRoot (Split-Path -Leaf $Script)
$jobPath = (Resolve-Path -LiteralPath $JobFile).Path -replace '\\', '/'
$code = 'var JOB_FILE = "' + $jobPath + '";' + "`n" + [System.IO.File]::ReadAllText($jsx, [System.Text.Encoding]::UTF8)

$ai = New-Object -ComObject Illustrator.Application
$result = $ai.DoJavaScript($code)
Write-Output "jsx: $result"
