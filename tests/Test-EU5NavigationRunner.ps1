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
$runner = Join-Path $projectRoot 'scripts\Invoke-EU5Navigation.ps1'
$catalogDocument = Join-Path $projectRoot 'docs\EU5-COMMAND-CATALOG.md'
$runnerText = Get-Content -LiteralPath $runner -Raw
$catalogText = Get-Content -LiteralPath $catalogDocument -Raw
$parseErrors = $null
$tokens = $null
[void] [System.Management.Automation.Language.Parser]::ParseFile(
    $runner,
    [ref] $tokens,
    [ref] $parseErrors
)
Assert-True ($parseErrors.Count -eq 0) 'runner must parse without PowerShell syntax errors'

$allowedCommands = @(
    'focus_capital',
    'open_economy',
    'open_diplomacy',
    'open_military',
    'open_alerts',
    'find_province'
)
$expectedHotkeys = @{
    focus_capital  = 'ctrl+f11'
    open_economy   = 'ctrl+f2'
    open_diplomacy = 'ctrl+f5'
    open_military  = 'ctrl+f6'
    open_alerts    = 'ctrl+f9'
    find_province  = 'ctrl+f10'
}

# Dot-sourcing compiles the Win32 declarations but deliberately does not run
# the UI workflow.
. $runner -Command focus_capital

Assert-True ($null -ne ('EU5Navigation.Win32' -as [type])) 'native Win32 declarations must compile'
Assert-True (
    @($script:EU5NavigationCatalog.Keys).Count -eq $allowedCommands.Count
) 'catalog must contain only the reviewed commands'
foreach ($commandName in $allowedCommands) {
    Assert-True (
        $script:EU5NavigationCatalog.Contains($commandName)
    ) "catalog must contain $commandName"
    Assert-True (
        $script:EU5NavigationCatalog[$commandName].hotkey -eq $expectedHotkeys[$commandName]
    ) "$commandName must retain its fixed hotkey"
    Assert-True (
        $catalogText.Contains("``$commandName``")
    ) "documentation must name $commandName"
    Assert-True (
        $catalogText.Contains("``$($expectedHotkeys[$commandName].Replace('ctrl', 'Ctrl').Replace('f', 'F'))``")
    ) "documentation must list the fixed hotkey for $commandName"
}

$rejected = $false
try {
    . $runner -Command save_game 2>$null
}
catch {
    $rejected = $true
}
Assert-True $rejected 'PowerShell parameter binding must reject commands outside the allowlist'

Assert-True (
    $runnerText -notmatch '(?im)\b(SendKeys|mouse_event|SetCursorPos|SendMessage|PostMessage)\b'
) 'runner must not contain alternate key, mouse, coordinate, or message injection paths'
Assert-True (
    ([regex]::Matches($runnerText, '\bSendInput\s*\(')).Count -eq 2
) 'runner must contain only the SendInput declaration and one fixed-array call'
Assert-True (
    $runnerText -match 'IsExpectedForeground\(expectedWindow,\s*expectedProcessId\)'
) 'native input path must verify the expected foreground window and PID'
Assert-True (
    $runnerText -match 'Get-Process\s+-Name\s+''eu5'''
) 'runner must use the fixed eu5.exe process name'

Write-Output 'PASS: EU5 navigation runner compiles, rejects unknown commands, documents the catalog, and exposes only fixed Win32 chords.'
