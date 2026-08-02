[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][bool] $Condition,
        [Parameter(Mandatory = $true)][string] $Message
    )
    if (-not $Condition) {
        throw "Assertion failed: $Message"
    }
}

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$helper = Join-Path $projectRoot 'scripts\Get-EUVSaveCheckpoint.ps1'
$testRoot = Join-Path $projectRoot ('.checkpoint-test-' + [guid]::NewGuid().ToString('N'))
$saveRoot = Join-Path $testRoot 'save games'

try {
    New-Item -ItemType Directory -Path (Join-Path $saveRoot 'nested') | Out-Null
    Set-Content -LiteralPath (Join-Path $saveRoot 'holland-test.eu5') -Value 'sample-one'
    Set-Content -LiteralPath (Join-Path $saveRoot 'ignored.txt') -Value 'not-a-save'
    Set-Content -LiteralPath (Join-Path $saveRoot 'nested\holland-two.eu5') -Value 'sample-two'

    $before = @(
        Get-ChildItem -LiteralPath $saveRoot -File -Recurse |
        Sort-Object FullName |
        ForEach-Object {
            [pscustomobject]@{
                path  = $_.FullName
                bytes = $_.Length
                hash  = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
            }
        }
    )

    $rejected = $false
    try {
        & $helper `
            -SaveFolder $saveRoot `
            -ConfirmedSaveFolder $testRoot 2>$null | Out-Null
    }
    catch {
        $rejected = $true
    }
    Assert-True $rejected 'a mismatched confirmation path must be rejected'

    $direct = (
        & $helper -SaveFolder $saveRoot -ConfirmedSaveFolder $saveRoot |
        Out-String |
        ConvertFrom-Json
    )
    Assert-True ($direct.fileCount -eq 1) 'default scope must include one direct .eu5 file'
    Assert-True (
        $direct.files[0].relativePath -eq 'holland-test.eu5'
    ) 'default scope must report the direct save'

    $recursive = (
        & $helper `
            -SaveFolder $saveRoot `
            -ConfirmedSaveFolder $saveRoot `
            -IncludeSubfolders |
        Out-String |
        ConvertFrom-Json
    )
    Assert-True ($recursive.fileCount -eq 2) 'recursive scope must include both .eu5 files'
    Assert-True (
        @($recursive.files | Where-Object { $_.relativePath -like '*.txt' }).Count -eq 0
    ) 'non-save extensions must be ignored'

    $after = @(
        Get-ChildItem -LiteralPath $saveRoot -File -Recurse |
        Sort-Object FullName |
        ForEach-Object {
            [pscustomobject]@{
                path  = $_.FullName
                bytes = $_.Length
                hash  = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
            }
        }
    )
    Assert-True (
        (ConvertTo-Json $before -Compress) -eq (ConvertTo-Json $after -Compress)
    ) 'checkpointing must not alter fixture files'

    Write-Output 'PASS: checkpoint helper is confirmation-gated, extension-limited, and read-only.'
}
finally {
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
    $expectedPrefix = $projectRoot.TrimEnd('\') + '\.checkpoint-test-'
    if (
        (Test-Path -LiteralPath $resolvedTestRoot) -and
        $resolvedTestRoot.StartsWith(
            $expectedPrefix,
            [System.StringComparison]::OrdinalIgnoreCase
        )
    ) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
