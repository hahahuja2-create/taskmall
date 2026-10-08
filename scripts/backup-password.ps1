$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding -ArgumentList $false
. (Join-Path $PSScriptRoot 'private-dialog.ps1')
Initialize-TaskMallPrivateDialog
function New-BackupPasswordForm([string] $Context) {
    if ($Context -notin @('original', 'returned', 'retry', 'new')) { throw 'Invalid password dialog context.' }
    $newPassword = $Context -eq 'new'
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()

    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'TaskMall - Private Backup Password'
    $form.StartPosition = 'CenterScreen'
    $form.ClientSize = New-Object System.Drawing.Size -ArgumentList 520, 278
    if ($newPassword) {
        $form.Text = 'TaskMall - Secure Backup'
        $form.ClientSize = New-Object System.Drawing.Size -ArgumentList 520, 414
    }
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.TopMost = $true
    $form.AutoScaleMode = 'Dpi'
    $form.Font = New-Object System.Drawing.Font -ArgumentList 'Segoe UI', 10

    $label = New-Object System.Windows.Forms.Label
    $label.Location = New-Object System.Drawing.Point -ArgumentList 20, 18
    $label.Size = New-Object System.Drawing.Size -ArgumentList 480, 78
    $label.Text = "Enter your ORIGINAL encrypted backup password.`r`nNot your TaskMall login, Windows password or iPhone passcode.`r`nCheck the keyboard language. Nothing is sent to TaskMall."
    if ($Context -eq 'returned') {
        $label.Text = "Enter the SAME backup password to check the returned copy.`r`nNot your TaskMall login, Windows password or iPhone passcode.`r`nCheck the keyboard language. Nothing is sent to TaskMall."
    }
    if ($Context -eq 'retry') {
        $label.Text = "That password did not unlock this backup. Try again.`r`nUse the ORIGINAL encrypted backup password, not your login.`r`nCheck the keyboard language, Caps Lock and spaces."
    }
    if ($newPassword) {
        $label.Text = "Choose a NEW password that has never been shared in chat.`r`nUse at least 20 characters including letters (several words).`r`nEnter it twice below. Your wallet addresses will not change."
    }
    $form.Controls.Add($label)

    $passwordBox = New-Object System.Windows.Forms.TextBox
    $passwordBox.Location = New-Object System.Drawing.Point -ArgumentList 20, 106
    if ($newPassword) {
        $passwordLabel = New-Object System.Windows.Forms.Label
        $passwordLabel.Location = New-Object System.Drawing.Point -ArgumentList 20, 102
        $passwordLabel.Size = New-Object System.Drawing.Size -ArgumentList 480, 24
        $passwordLabel.Text = 'New backup password'
        $form.Controls.Add($passwordLabel)
        $passwordBox.Location = New-Object System.Drawing.Point -ArgumentList 20, 130
    }
    $passwordBox.Size = New-Object System.Drawing.Size -ArgumentList 480, 30
    $passwordBox.UseSystemPasswordChar = $true
    $passwordBox.MaxLength = 128
    $form.Controls.Add($passwordBox)

    $confirmationBox = $null
    if ($newPassword) {
        $confirmationLabel = New-Object System.Windows.Forms.Label
        $confirmationLabel.Location = New-Object System.Drawing.Point -ArgumentList 20, 167
        $confirmationLabel.Size = New-Object System.Drawing.Size -ArgumentList 480, 24
        $confirmationLabel.Text = 'Confirm the new password'
        $form.Controls.Add($confirmationLabel)
        $confirmationBox = New-Object System.Windows.Forms.TextBox
        $confirmationBox.Location = New-Object System.Drawing.Point -ArgumentList 20, 195
        $confirmationBox.Size = New-Object System.Drawing.Size -ArgumentList 480, 30
        $confirmationBox.UseSystemPasswordChar = $true
        $confirmationBox.MaxLength = 128
        $form.Controls.Add($confirmationBox)
    }

    $validationLabel = $null
    if ($newPassword) {
        $validationLabel = New-Object System.Windows.Forms.Label
        $validationLabel.Location = New-Object System.Drawing.Point -ArgumentList 20, 232
        $validationLabel.Size = New-Object System.Drawing.Size -ArgumentList 480, 42
        $validationLabel.Text = 'Enter a new password here, not in the black terminal.'
        $validationLabel.ForeColor = [System.Drawing.Color]::DarkRed
        $form.Controls.Add($validationLabel)
    }

    $show = New-Object System.Windows.Forms.CheckBox
    $show.Location = New-Object System.Drawing.Point -ArgumentList 20, 148
    if ($newPassword) { $show.Location = New-Object System.Drawing.Point -ArgumentList 20, 279 }
    $show.Size = New-Object System.Drawing.Size -ArgumentList 480, 28
    $show.Text = 'Show password on this computer only'
    $show.Checked = $false
    $show.Add_CheckedChanged({
        $passwordBox.UseSystemPasswordChar = -not $show.Checked
        if ($null -ne $confirmationBox) { $confirmationBox.UseSystemPasswordChar = -not $show.Checked }
    }.GetNewClosure())
    $form.Controls.Add($show)

    $note = New-Object System.Windows.Forms.Label
    $note.Location = New-Object System.Drawing.Point -ArgumentList 20, 181
    if ($newPassword) { $note.Location = New-Object System.Drawing.Point -ArgumentList 20, 317 }
    $note.Size = New-Object System.Drawing.Size -ArgumentList 480, 24
    $note.Text = 'Keep this private. No funds are sent by this check.'
    $form.Controls.Add($note)

    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Location = New-Object System.Drawing.Point -ArgumentList 280, 225
    if ($newPassword) { $cancel.Location = New-Object System.Drawing.Point -ArgumentList 280, 361 }
    $cancel.Size = New-Object System.Drawing.Size -ArgumentList 104, 34
    $cancel.Text = 'Cancel'
    $cancel.DialogResult = 'Cancel'
    $form.Controls.Add($cancel)
    $form.CancelButton = $cancel

    $confirm = New-Object System.Windows.Forms.Button
    $confirm.Location = New-Object System.Drawing.Point -ArgumentList 396, 225
    if ($newPassword) { $confirm.Location = New-Object System.Drawing.Point -ArgumentList 396, 361 }
    $confirm.Size = New-Object System.Drawing.Size -ArgumentList 104, 34
    $confirm.Text = 'Continue'
    $confirm.Enabled = $false
    $confirm.DialogResult = 'OK'
    $changed = {
        $valid = $passwordBox.Text.Length -gt 0
        if ($newPassword) {
            $valid = $passwordBox.Text.Length -ge 20 -and $passwordBox.Text -match '\p{L}' -and $passwordBox.Text -ceq $confirmationBox.Text
            $validationLabel.ForeColor = [System.Drawing.Color]::DarkRed
            if ($passwordBox.Text.Length -eq 0) { $validationLabel.Text = 'Enter a new password here, not in the black terminal.' }
            elseif ($passwordBox.Text.Length -lt 20) { $validationLabel.Text = 'Use at least 20 characters. Current length: ' + $passwordBox.Text.Length + '.' }
            elseif ($passwordBox.Text -notmatch '\p{L}') { $validationLabel.Text = 'Include letters. A digits-only password is not accepted.' }
            elseif ($confirmationBox.Text.Length -eq 0) { $validationLabel.Text = 'Repeat the same password in Confirm the new password.' }
            elseif ($passwordBox.Text -cne $confirmationBox.Text) { $validationLabel.Text = 'The two passwords do not match. Check letter case too.' }
            else {
                $validationLabel.Text = 'Ready. Click Continue to verify your backup.'
                $validationLabel.ForeColor = [System.Drawing.Color]::DarkGreen
            }
        }
        $confirm.Enabled = $valid
    }.GetNewClosure()
    $passwordBox.Add_TextChanged($changed)
    if ($null -ne $confirmationBox) { $confirmationBox.Add_TextChanged($changed) }
    $form.Controls.Add($confirm)
    $form.AcceptButton = $confirm
    $form.Add_Shown({ $passwordBox.Focus() | Out-Null }.GetNewClosure())
    return @{ Form = $form; PasswordBox = $passwordBox; ConfirmationBox = $confirmationBox; ValidationLabel = $validationLabel; ShowPassword = $show; ContinueButton = $confirm }
}

$form = $null
$passwordBox = $null
try {
    $controls = New-BackupPasswordForm $env:TASKMALL_BACKUP_PASSWORD_CONTEXT
    $form = $controls.Form
    $passwordBox = $controls.PasswordBox
    $answer = Show-TaskMallPrivateDialog $form.Text { $form.ShowDialog() }
    if ($answer -eq [System.Windows.Forms.DialogResult]::OK -and $controls.ContinueButton.Enabled) {
        @{ status = 'entered'; password = $passwordBox.Text } | ConvertTo-Json -Compress
    } else {
        @{ status = 'cancelled' } | ConvertTo-Json -Compress
    }
} catch {
    @{ status = 'failed' } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $passwordBox) { $passwordBox.Clear() }
    if ($null -ne $controls -and $null -ne $controls.ConfirmationBox) { $controls.ConfirmationBox.Clear() }
    if ($null -ne $form) { $form.Dispose() }
}
