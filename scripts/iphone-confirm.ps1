$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding -ArgumentList $false
. (Join-Path $PSScriptRoot 'private-dialog.ps1')
Initialize-TaskMallPrivateDialog
function New-IphoneConfirmationForm {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'TaskMall - Confirm iPhone Backup'
    $form.StartPosition = 'CenterScreen'
    $form.ClientSize = New-Object System.Drawing.Size -ArgumentList 530, 338
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.TopMost = $true
    $form.AutoScaleMode = 'Dpi'
    $form.Font = New-Object System.Drawing.Font -ArgumentList 'Segoe UI', 10

    $label = New-Object System.Windows.Forms.Label
    $label.Location = New-Object System.Drawing.Point -ArgumentList 20, 16
    $label.Size = New-Object System.Drawing.Size -ArgumentList 490, 66
    $label.Text = "The returned file and wallet recovery match.`r`nOnly you can confirm where the phone copy is stored.`r`nThis confirmation does NOT enable payments."
    $form.Controls.Add($label)

    $local = New-Object System.Windows.Forms.CheckBox
    $local.Location = New-Object System.Drawing.Point -ArgumentList 20, 88
    $local.Size = New-Object System.Drawing.Size -ArgumentList 490, 56
    $local.Text = 'The encrypted file remains LOCAL on my passcode-protected iPhone and is available without this PC or cloud.'
    $form.Controls.Add($local)

    $separate = New-Object System.Windows.Forms.CheckBox
    $separate.Location = New-Object System.Drawing.Point -ArgumentList 20, 150
    $separate.Size = New-Object System.Drawing.Size -ArgumentList 490, 38
    $separate.Text = 'I keep the backup password separately from the file.'
    $form.Controls.Add($separate)

    $instruction = New-Object System.Windows.Forms.Label
    $instruction.Location = New-Object System.Drawing.Point -ArgumentList 20, 199
    $instruction.Size = New-Object System.Drawing.Size -ArgumentList 490, 24
    $instruction.Text = 'Type IPHONE below to confirm. Do not enter a password.'
    $form.Controls.Add($instruction)
    $entry = New-Object System.Windows.Forms.TextBox
    $entry.Location = New-Object System.Drawing.Point -ArgumentList 20, 232
    $entry.Size = New-Object System.Drawing.Size -ArgumentList 490, 30
    $entry.MaxLength = 6
    $form.Controls.Add($entry)

    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Location = New-Object System.Drawing.Point -ArgumentList 290, 286
    $cancel.Size = New-Object System.Drawing.Size -ArgumentList 104, 34
    $cancel.Text = 'Cancel'
    $cancel.DialogResult = 'Cancel'
    $form.Controls.Add($cancel)
    $form.CancelButton = $cancel
    $confirm = New-Object System.Windows.Forms.Button
    $confirm.Location = New-Object System.Drawing.Point -ArgumentList 406, 286
    $confirm.Size = New-Object System.Drawing.Size -ArgumentList 104, 34
    $confirm.Text = 'Confirm'
    $confirm.Enabled = $false
    $confirm.DialogResult = 'OK'
    $changed = { $confirm.Enabled = $local.Checked -and $separate.Checked -and $entry.Text -ceq 'IPHONE' }.GetNewClosure()
    $local.Add_CheckedChanged($changed)
    $separate.Add_CheckedChanged($changed)
    $entry.Add_TextChanged($changed)
    $form.Controls.Add($confirm)
    $form.AcceptButton = $confirm
    return @{ Form = $form; LocalCopy = $local; SeparatePassword = $separate; Entry = $entry; Confirm = $confirm }
}

$controls = $null
try {
    $controls = New-IphoneConfirmationForm
    $answer = Show-TaskMallPrivateDialog $controls.Form.Text { $controls.Form.ShowDialog() }
    if ($answer -eq [System.Windows.Forms.DialogResult]::OK -and $controls.Confirm.Enabled) {
        @{ status = 'confirmed' } | ConvertTo-Json -Compress
    } else {
        @{ status = 'cancelled' } | ConvertTo-Json -Compress
    }
} catch {
    @{ status = 'failed' } | ConvertTo-Json -Compress
} finally {
    if ($null -ne $controls) { $controls.Entry.Clear(); $controls.Form.Dispose() }
}
