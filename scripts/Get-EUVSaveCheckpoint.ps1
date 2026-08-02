<#
.SYNOPSIS
Creates a read-only JSON inventory of EUV save files.

.DESCRIPTION
Reads only files with explicitly allowed save extensions from a folder whose
resolved path is repeated in ConfirmedSaveFolder. It writes nothing: JSON is
emitted to stdout so the caller controls whether and where it is stored.

Reparse points (junctions and symbolic links) are skipped so enumeration cannot
leave the confirmed folder through a linked path. Subfolders are ignored unless
IncludeSubfolders is supplied.

.EXAMPLE
.\Get-EUVSaveCheckpoint.ps1 `
  -SaveFolder 'C:\path\confirmed-by-user' `
  -ConfirmedSaveFolder 'C:\path\confirmed-by-user'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string] $SaveFolder,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string] $ConfirmedSaveFolder,

    [ValidateNotNullOrEmpty()]
    [string[]] $SaveExtension = @('.eu5'),

    [switch] $IncludeSubfolders
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-FileSystemFolder {
    param([Parameter(Mandatory = $true)][string] $LiteralPath)

    $resolved = Resolve-Path -LiteralPath $LiteralPath -ErrorAction Stop
    if ($resolved.Provider.Name -ne 'FileSystem') {
        throw "The path must use the FileSystem provider: $LiteralPath"
    }

    $item = Get-Item -LiteralPath $resolved.ProviderPath -Force
    if (-not $item.PSIsContainer) {
        throw "The path must be a folder: $LiteralPath"
    }

    return [System.IO.Path]::GetFullPath($item.FullName).TrimEnd('\', '/')
}

function Get-ConfirmedFiles {
    param(
        [Parameter(Mandatory = $true)][string] $Root,
        [Parameter(Mandatory = $true)][bool] $Recurse
    )

    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($Root)

    while ($pending.Count -gt 0) {
        $current = $pending.Pop()
        foreach ($item in Get-ChildItem -LiteralPath $current -Force) {
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                continue
            }

            if ($item.PSIsContainer) {
                if ($Recurse) {
                    $pending.Push($item.FullName)
                }
                continue
            }

            Write-Output $item
        }
    }
}

$resolvedSaveFolder = Resolve-FileSystemFolder -LiteralPath $SaveFolder
$resolvedConfirmation = Resolve-FileSystemFolder -LiteralPath $ConfirmedSaveFolder
if (-not [string]::Equals(
        $resolvedSaveFolder,
        $resolvedConfirmation,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
    throw 'SaveFolder and ConfirmedSaveFolder must resolve to the same folder.'
}

$extensions = New-Object 'System.Collections.Generic.HashSet[string]' (
    [System.StringComparer]::OrdinalIgnoreCase
)
foreach ($extension in $SaveExtension) {
    if (-not $extension.StartsWith('.') -or $extension.IndexOfAny(
            [System.IO.Path]::GetInvalidFileNameChars()
        ) -ge 0) {
        throw "Invalid save extension: $extension"
    }
    [void] $extensions.Add($extension)
}

$files = @(
    Get-ConfirmedFiles `
        -Root $resolvedSaveFolder `
        -Recurse ([bool] $IncludeSubfolders) |
    Where-Object { $extensions.Contains($_.Extension) } |
    Sort-Object FullName
)

$entries = @(
    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($resolvedSaveFolder.Length).TrimStart('\', '/')
        $hash = Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256
        [pscustomobject]@{
            relativePath     = $relativePath
            bytes            = [long] $file.Length
            lastWriteTimeUtc = $file.LastWriteTimeUtc.ToString('o')
            sha256           = $hash.Hash.ToLowerInvariant()
        }
    }
)

[pscustomobject]@{
    schemaVersion  = 1
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    saveFolder     = $resolvedSaveFolder
    scope          = if ($IncludeSubfolders) { 'recursive' } else { 'direct-children' }
    extensions     = @($extensions | Sort-Object)
    fileCount      = $entries.Count
    totalBytes     = [long] (($entries | Measure-Object -Property bytes -Sum).Sum)
    files          = $entries
} | ConvertTo-Json -Depth 5
