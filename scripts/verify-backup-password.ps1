$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'private-dialog.ps1')
Initialize-TaskMallPrivateDialog
$source = Join-Path $PSScriptRoot 'backup-password.ps1'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref] $tokens, [ref] $errors)
if ($errors.Count -gt 0) { throw 'Password helper syntax failed.' }
$definition = $ast.Find({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'New-BackupPasswordForm'
}, $false)
if ($null -eq $definition) { throw 'Password form constructor unavailable.' }
# Load only the constructor; never execute the private password-entry handler in tests.
. ([scriptblock]::Create($definition.Extent.Text))

foreach ($context in @('original', 'returned', 'retry', 'new')) {
    $controls = New-BackupPasswordForm $context
    try {
        $controls.Form.ShowInTaskbar = $false
        $controls.Form.Opacity = 0
        $probe = New-Object System.Windows.Forms.Timer
        $probe.Interval = 400
        $visible = @{ Value = $false }
        $probe.Add_Tick({
            $visible.Value = [TaskMallPrivateDialogNative]::IsWindowVisible($controls.Form.Handle)
            $controls.Form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
            $probe.Stop()
        }.GetNewClosure())
        $probe.Start()
        try { Show-TaskMallPrivateDialog $controls.Form.Text { $controls.Form.ShowDialog() } | Out-Null }
        finally { $probe.Stop(); $probe.Dispose() }
        if (-not $visible.Value) { throw 'Hidden child-process launch must display the actual modal password form.' }
        $controls.Form.Show()
        [System.Windows.Forms.Application]::DoEvents()
        if (-not [TaskMallPrivateDialogNative]::IsWindowVisible($controls.Form.Handle)) {
            throw 'The OS must show the private dialog even when PowerShell launches hidden.'
        }
        if (-not $controls.PasswordBox.Visible -or $controls.PasswordBox.Width -lt 400 -or $controls.PasswordBox.Height -lt 20) {
            throw 'Password input must actually render at usable dimensions.'
        }
        if ($context -eq 'new' -and (-not $controls.ConfirmationBox.Visible -or $controls.ConfirmationBox.Width -lt 400 -or $controls.ConfirmationBox.Height -lt 20)) {
            throw 'Both new-password fields must actually render at usable dimensions.'
        }
        if (-not $controls.PasswordBox.UseSystemPasswordChar -or $controls.ShowPassword.Checked -or $controls.ContinueButton.Enabled) {
            throw 'Password must start masked with empty submission disabled.'
        }
        if ($controls.PasswordBox.MaxLength -ne 128 -or $controls.Form.AcceptButton -ne $controls.ContinueButton) {
            throw 'Password input bounds and Enter action must be stable.'
        }
        $controls.PasswordBox.Text = 'PublicFixtureOnly123!'
        if ($context -eq 'new') {
            $controls.PasswordBox.Text = 'short'
            if ($controls.ValidationLabel.Text -notmatch 'at least 20') { throw 'Short passwords need visible feedback.' }
            $controls.PasswordBox.Text = 'PublicFixtureOnly123!'
            if ($controls.ContinueButton.Enabled -or -not $controls.ConfirmationBox.UseSystemPasswordChar) { throw 'New password requires masked confirmation.' }
            if ($controls.ValidationLabel.Text -notmatch 'Repeat') { throw 'Missing confirmation needs visible feedback.' }
            $controls.ConfirmationBox.Text = 'PublicFixtureOnly123!'
            if (-not $controls.ContinueButton.Enabled) { throw 'Matching strong confirmation should enable Continue.' }
            if ($controls.ValidationLabel.Text -notmatch 'Ready') { throw 'Valid input must explain how to continue.' }
            $controls.ConfirmationBox.Text = 'publicfixtureonly123!'
            if ($controls.ContinueButton.Enabled) { throw 'Password confirmation must be case-sensitive.' }
            if ($controls.ValidationLabel.Text -notmatch 'do not match') { throw 'Mismatched confirmation needs visible feedback.' }
            $controls.PasswordBox.Text = '9876543210987654321098'
            $controls.ConfirmationBox.Text = $controls.PasswordBox.Text
            if ($controls.ContinueButton.Enabled) { throw 'An all-numeric new password must be rejected.' }
            if ($controls.ValidationLabel.Text -notmatch 'digits-only') { throw 'Numeric passwords need visible feedback.' }
            $controls.PasswordBox.Text = 'PublicFixtureOnly123!'
            $controls.ConfirmationBox.Text = $controls.PasswordBox.Text
        }
        if (-not $controls.ContinueButton.Enabled) { throw 'Nonempty input must enable Continue.' }
        $controls.ShowPassword.Checked = $true
        if ($controls.PasswordBox.UseSystemPasswordChar) { throw 'Explicit local visibility toggle failed.' }
        if ($context -eq 'new' -and $controls.ConfirmationBox.UseSystemPasswordChar) { throw 'Confirmation visibility must follow the explicit toggle.' }
        $controls.ShowPassword.Checked = $false
        if (-not $controls.PasswordBox.UseSystemPasswordChar) { throw 'Password remasking failed.' }
        if ($context -eq 'new' -and -not $controls.ConfirmationBox.UseSystemPasswordChar) { throw 'Confirmation must be remasked.' }
        $controls.PasswordBox.Clear()
        if ($controls.ContinueButton.Enabled) { throw 'Empty submission must stay disabled.' }
        if ($controls.Form.CancelButton.DialogResult -ne [System.Windows.Forms.DialogResult]::Cancel) { throw 'Cancel must not submit.' }
    } finally {
        $controls.PasswordBox.Clear()
        $controls.Form.Hide()
        $controls.Form.Dispose()
    }
}
$confirmationSource = Join-Path $PSScriptRoot 'iphone-confirm.ps1'
$ast = [System.Management.Automation.Language.Parser]::ParseFile($confirmationSource, [ref] $tokens, [ref] $errors)
if ($errors.Count -gt 0) { throw 'Phone confirmation helper syntax failed.' }
$definition = $ast.Find({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'New-IphoneConfirmationForm'
}, $false)
if ($null -eq $definition) { throw 'Phone confirmation constructor unavailable.' }
. ([scriptblock]::Create($definition.Extent.Text))
$controls = New-IphoneConfirmationForm
try {
    $controls.Form.ShowInTaskbar = $false
    $controls.Form.Opacity = 0
    $probe = New-Object System.Windows.Forms.Timer
    $probe.Interval = 400
    $visible = @{ Value = $false }
    $probe.Add_Tick({
        $visible.Value = [TaskMallPrivateDialogNative]::IsWindowVisible($controls.Form.Handle)
        $controls.Form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
        $probe.Stop()
    }.GetNewClosure())
    $probe.Start()
    try { Show-TaskMallPrivateDialog $controls.Form.Text { $controls.Form.ShowDialog() } | Out-Null }
    finally { $probe.Stop(); $probe.Dispose() }
    if (-not $visible.Value) { throw 'Hidden child-process launch must display the actual modal confirmation form.' }
    $controls.Form.Show()
    [System.Windows.Forms.Application]::DoEvents()
    if (-not [TaskMallPrivateDialogNative]::IsWindowVisible($controls.Form.Handle)) { throw 'The OS must show the confirmation form.' }
    if (-not $controls.Entry.Visible -or $controls.Confirm.Enabled) { throw 'Storage confirmation must render but start disabled.' }
    $controls.Entry.Text = 'IPHONE'
    if ($controls.Confirm.Enabled) { throw 'Typing alone does not attest local storage and separate password.' }
    $controls.LocalCopy.Checked = $true
    if ($controls.Confirm.Enabled) { throw 'A separately stored password also requires operator attestation.' }
    $controls.SeparatePassword.Checked = $true
    if (-not $controls.Confirm.Enabled) { throw 'Both attestations and exact keyword must allow confirmation.' }
    $controls.Entry.Text = 'iphone'
    if ($controls.Confirm.Enabled) { throw 'Storage acknowledgement must be explicit and case-sensitive.' }
    $controls.Entry.Text = 'IPHONE'
    $controls.LocalCopy.Checked = $false
    if ($controls.Confirm.Enabled) { throw 'Withdrawing an attestation must disable confirmation.' }
} finally { $controls.Entry.Clear(); $controls.Form.Hide(); $controls.Form.Dispose() }
Write-Output 'BACKUP_PASSWORD_FORM_TESTS_PASSED'
