$ErrorActionPreference = 'Stop'
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$desktop = [Environment]::GetFolderPath('Desktop')
if ([string]::IsNullOrWhiteSpace($desktop) -or -not (Test-Path -LiteralPath $desktop -PathType Container)) {
    throw 'Windows desktop is not available.'
}
$shell = New-Object -ComObject WScript.Shell
$items = @(
    @{ Name = 'TaskMall Payment Setup'; Script = 'payments-prepare.cmd'; Description = 'Private local backup preparation. No money is signed or sent.' },
    @{ Name = 'TaskMall USB Backup'; Script = 'payments-backup-usb.cmd'; Description = 'Copy and verify an encrypted backup on USB. No money is signed or sent.' },
    @{ Name = 'TaskMall iPhone Backup'; Script = 'payments-backup-iphone.cmd'; Description = 'Prepare an encrypted iPhone copy and verify a returned file. No money is signed or sent.' },
    @{ Name = 'TaskMall Verify iPhone Backup'; Script = 'payments-verify-iphone.cmd'; Description = 'Resume the returned iPhone file check privately. No money is signed or sent.' },
    @{ Name = 'TaskMall Secure Backup'; Script = 'payments-secure-backup.cmd'; Description = 'Change the backup password privately after verifying a new phone copy. No money is signed or sent.' },
    @{ Name = 'TaskMall Finish Phone Backup'; Script = 'payments-finish-backup.cmd'; Description = 'Verify and finish the existing pending phone backup. No money is signed or sent.' }
)

foreach ($item in $items) {
    $script = Join-Path $PSScriptRoot $item.Script
    if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw 'Payment preparation launcher is missing.' }
    $linkPath = Join-Path $desktop ($item.Name + '.lnk')
    $arguments = '/d /c ""' + $script + '""'
    $shortcut = $shell.CreateShortcut($linkPath)
    if ((Test-Path -LiteralPath $linkPath) -and
        ($shortcut.TargetPath -ne $env:ComSpec -or $shortcut.Arguments -ne $arguments)) {
        throw 'An unrelated desktop shortcut already uses this name; it was not changed.'
    }
    $shortcut.TargetPath = $env:ComSpec
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $workspace
    $shortcut.Description = $item.Description
    $shortcut.WindowStyle = if ($item.Name -in @('TaskMall Secure Backup', 'TaskMall Finish Phone Backup')) { 7 } else { 1 }
    $shortcut.Save()
    [PSCustomObject]@{ Name = $item.Name; Path = $linkPath; Mode = 'Preparation only; no transfers' }
}
