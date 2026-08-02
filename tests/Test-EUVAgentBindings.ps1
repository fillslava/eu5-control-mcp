[CmdletBinding()]
param(
    [string] $Candidate = '',
    [string] $Backup = '',
    [string] $LiveProfile = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $Candidate) {
    $Candidate = Join-Path $PSScriptRoot '..\profiles\agent-navigation.bindings'
}
if (-not $Backup) {
    $Backup = Join-Path $PSScriptRoot '..\profiles\original-user.bindings.backup'
}

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][bool] $Condition,
        [Parameter(Mandatory = $true)][string] $Message
    )
    if (-not $Condition) {
        throw "Assertion failed: $Message"
    }
}

$expectedBackupHash = 'b70e703a5e2c278556b6ef7753813494b06dbc3721399084be9d5e1d7acfb9d3'
$allowedActions = @(
    'max_zoom_out',
    'close_window_left',
    'close_window_right',
    'previous_window',
    'next_window',
    'toggle_window_collapse',
    'top_left_1',
    'top_left_2',
    'top_left_3',
    'top_left_4',
    'top_left_5',
    'top_left_6',
    'top_left_7',
    'top_left_8',
    'toggle_alert_stash',
    'find_province',
    'go_to_capital',
    'mapmode_menu',
    'mapmode_slot_1',
    'mapmode_slot_2',
    'mapmode_slot_3',
    'mapmode_slot_4',
    'mapmode_slot_5',
    'mapmode_slot_6',
    'mapmode_slot_7',
    'mapmode_slot_8',
    'mapmode_slot_9',
    'mapmode_slot_10',
    'mapmode_slot_11',
    'mapmode_slot_12'
)
$reservedScancodes = @(7, 9, 12, 15, 16, 21, 40, 43, 44, 45, 76, 79, 80, 81, 82)

$candidateText = Get-Content -LiteralPath $Candidate -Raw
Assert-True ($candidateText -match '(?m)^version=4\s*$') 'candidate must declare version=4'
Assert-True (
    ([regex]::Matches($candidateText, '\{')).Count -eq
    ([regex]::Matches($candidateText, '\}')).Count
) 'candidate braces must balance'

$blocks = @(
    [regex]::Matches(
        $candidateText,
        'binding\s*=\s*\{(?<body>[^{}]*)\}',
        [System.Text.RegularExpressions.RegexOptions]::Singleline
    )
)
Assert-True ($blocks.Count -eq 30) 'candidate must contain 30 flat binding blocks'

$seenActions = @{}
$seenChords = @{}
foreach ($block in $blocks) {
    $body = $block.Groups['body'].Value
    $actionMatch = [regex]::Match($body, 'input_action\s*=\s*"(?<value>[^"]+)"')
    $scanMatch = [regex]::Match($body, 'scancode\s*=\s*(?<value>\d+)')
    Assert-True $actionMatch.Success 'every block must contain one input_action'
    Assert-True $scanMatch.Success 'every block must contain one numeric scancode'

    $action = $actionMatch.Groups['value'].Value
    $scan = [int] $scanMatch.Groups['value'].Value
    Assert-True ($allowedActions -contains $action) "action is not on the safe allowlist: $action"
    Assert-True (-not $seenActions.ContainsKey($action)) "duplicate action: $action"
    $seenActions[$action] = $true

    $modifiers = @(
        [regex]::Matches($body, 'modifier\s*=\s*(?<value>[a-z]+)') |
        ForEach-Object { $_.Groups['value'].Value }
    )
    if ($action -eq 'max_zoom_out') {
        Assert-True ($scan -eq 43) 'original max_zoom_out scancode must remain 43'
        Assert-True ($modifiers.Count -eq 0) 'original max_zoom_out must remain unmodified'
        continue
    }

    Assert-True (
        $modifiers.Count -eq 2 -and
        $modifiers -contains 'ctrl' -and
        $modifiers -contains 'alt'
    ) "added action must use exactly Ctrl+Alt: $action"
    Assert-True (
        $reservedScancodes -notcontains $scan
    ) "added action uses a reserved/system-risk key: $action"

    $chord = "ctrl+alt+$scan"
    Assert-True (-not $seenChords.ContainsKey($chord)) "duplicate chord: $chord"
    $seenChords[$chord] = $action
}

foreach ($allowedAction in $allowedActions) {
    Assert-True $seenActions.ContainsKey($allowedAction) "missing allowlisted action: $allowedAction"
}

$backupHash = (Get-FileHash -LiteralPath $Backup -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-True ($backupHash -eq $expectedBackupHash) 'project backup hash must match recorded original hash'

if ($LiveProfile) {
    $liveHash = (Get-FileHash -LiteralPath $LiveProfile -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-True ($liveHash -eq $backupHash) 'live profile changed after backup; review must stop'
}

Write-Output 'PASS: backup identity, version-4 structure, safe actions, unique chords, and Ctrl+Alt policy validated.'
