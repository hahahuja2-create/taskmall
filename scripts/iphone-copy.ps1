$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding -ArgumentList $false
$dialog = $null
$mode = $env:TASKMALL_IPHONE_MODE
if ([string]::IsNullOrWhiteSpace($mode)) { $mode = 'transfer' }

try {
    . (Join-Path $PSScriptRoot 'private-dialog.ps1')
    Initialize-TaskMallPrivateDialog
    if ($mode -notin @('transfer', 'verify-return')) { throw 'Invalid dialog mode.' }
    $outgoing = [System.IO.Path]::GetFullPath($env:TASKMALL_IPHONE_OUTGOING)
    $incoming = [System.IO.Path]::GetFullPath($env:TASKMALL_IPHONE_INCOMING)
    if (-not (Test-Path -LiteralPath $outgoing -PathType Container) -or -not (Test-Path -LiteralPath $incoming -PathType Container)) {
        throw 'Transfer folders unavailable.'
    }
    Add-Type -AssemblyName System.Windows.Forms
    if ($mode -eq 'transfer') {
        Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $outgoing + '"') -WindowStyle Normal | Out-Null
        $message = @'
1. Connect and unlock your iPhone. Accept Trust on the iPhone if prompted.
2. In Apple Devices > Files (or iTunes > File Sharing), select a trusted app that can store JSON files locally.
3. Add the encrypted .keystore.json file from the opened To-iPhone folder.
4. Confirm the file is actually stored on your iPhone, not only in a cloud account or message.
5. Save the file BACK from the iPhone to the From-iPhone folder below.

Do not remove the file from your iPhone. Keep its password separately.
Do not erase, restore or sync other phone content for this step.
Press OK only after saving the copy back. Cancel stops verification.

Return folder:
'@
        $answer = Show-TaskMallPrivateDialog 'TaskMall - Private iPhone Backup' {
            [System.Windows.Forms.MessageBox]::Show($message + [Environment]::NewLine + $incoming,
                'TaskMall - Private iPhone Backup', [System.Windows.Forms.MessageBoxButtons]::OKCancel, [System.Windows.Forms.MessageBoxIcon]::Information)
        }
        if ($answer -ne [System.Windows.Forms.DialogResult]::OK) {
            @{ status = 'cancelled'; reason = 'IPHONE_TRANSFER_CANCELLED' } | ConvertTo-Json -Compress
            exit 0
        }
    }
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'Select the encrypted copy saved BACK from your iPhone'
    $dialog.InitialDirectory = $incoming
    $dialog.Filter = 'Encrypted wallet backups (*.keystore.json)|*.keystore.json'
    $dialog.CheckFileExists = $true
    $dialog.Multiselect = $false
    $answer = Show-TaskMallPrivateDialog $dialog.Title { $dialog.ShowDialog() }
    if ($answer -ne [System.Windows.Forms.DialogResult]::OK) {
        @{ status = 'cancelled'; reason = 'IPHONE_RETURN_SELECTION_CANCELLED' } | ConvertTo-Json -Compress
        exit 0
    }
    @{ status = 'selected'; file = $dialog.FileName } | ConvertTo-Json -Compress
} catch {
    @{ status = 'failed'; reason = 'IPHONE_BACKUP_DIALOG_FAILED' } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $dialog) { $dialog.Dispose() }
}
