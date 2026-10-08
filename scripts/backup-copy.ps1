$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding -ArgumentList $false
$dialog = $null

try {
    $source = [System.IO.Path]::GetFullPath($env:TASKMALL_ENCRYPTED_BACKUP_SOURCE)
    $sourceInfo = Get-Item -LiteralPath $source -ErrorAction Stop
    if ($sourceInfo.PSIsContainer -or $sourceInfo.Length -lt 1 -or $sourceInfo.Length -gt 1000000 -or
        -not $source.EndsWith('.keystore.json', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Invalid encrypted backup.'
    }

    Add-Type -AssemblyName System.Windows.Forms
    $drives = @([System.IO.DriveInfo]::GetDrives() | Where-Object {
        $_.DriveType -eq [System.IO.DriveType]::Removable -and $_.IsReady
    })
    if ($drives.Count -eq 0) {
        [void][System.Windows.Forms.MessageBox]::Show('Insert a USB flash drive, then reopen TaskMall Payment Setup. No transfer was started.',
            'TaskMall - USB Backup', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)
        throw 'Removable storage required.'
    }

    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Select a folder on your USB flash drive for the encrypted TaskMall recovery backup.'
    $dialog.SelectedPath = $drives[0].RootDirectory.FullName
    $dialog.ShowNewFolderButton = $true
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw 'Cancelled.' }

    $folder = [System.IO.Path]::GetFullPath($dialog.SelectedPath)
    $root = [System.IO.Path]::GetPathRoot($folder)
    $drive = New-Object System.IO.DriveInfo -ArgumentList $root
    if ($drive.DriveType -ne [System.IO.DriveType]::Removable -or -not $drive.IsReady) { throw 'Select removable storage only.' }
    $folderInfo = Get-Item -LiteralPath $folder -ErrorAction Stop
    if (-not $folderInfo.PSIsContainer) { throw 'Select an existing folder.' }

    # Reject directory links that could redirect the backup onto the local system disk.
    for ($item = $folderInfo; $null -ne $item; $item = $item.Parent) {
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked folders are not allowed.' }
    }
    $name = 'TaskMall-recovery-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [System.Guid]::NewGuid().ToString('N').Substring(0, 8) + '.keystore.json'
    $destination = [System.IO.Path]::Combine($folder, $name)
    $inputFile = $null
    $outputFile = $null
    try {
        $inputFile = [System.IO.File]::Open($source, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
        $outputFile = [System.IO.File]::Open($destination, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        $inputFile.CopyTo($outputFile)
        $outputFile.Flush($true)
    } finally {
        if ($null -ne $outputFile) { $outputFile.Dispose() }
        if ($null -ne $inputFile) { $inputFile.Dispose() }
    }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash) {
        throw 'Copy verification failed.'
    }
    @{ status = 'copied'; file = $destination } | ConvertTo-Json -Compress
} catch {
    @{ status = 'not-copied' } | ConvertTo-Json -Compress
    exit 1
} finally {
    if ($null -ne $dialog) { $dialog.Dispose() }
}
