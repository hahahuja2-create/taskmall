function Initialize-TaskMallPrivateDialog {
    Add-Type -AssemblyName System.Windows.Forms
    if ($null -eq ('TaskMallPrivateDialogNative' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TaskMallPrivateDialogNative {
    private delegate bool Callback(IntPtr window, IntPtr unused);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Callback callback, IntPtr unused);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, System.Text.StringBuilder title, int length);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    public static IntPtr FindOwnedWindow(string title, uint expectedProcess) {
        IntPtr result = IntPtr.Zero;
        EnumWindows((window, unused) => {
            uint process;
            GetWindowThreadProcessId(window, out process);
            if (process != expectedProcess) return true;
            var text = new System.Text.StringBuilder(256);
            GetWindowText(window, text, text.Capacity);
            if (text.ToString() == title) { result = window; return false; }
            return true;
        }, IntPtr.Zero);
        return result;
    }
}
'@
    }
}

function Show-TaskMallPrivateDialog([string] $Title, [scriptblock] $Show) {
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 100
    $ownerProcess = [uint32] $PID
    # Restore only this process's intended dialog after the modal message loop starts.
    $timer.Add_Tick({
        $window = [TaskMallPrivateDialogNative]::FindOwnedWindow($Title, $ownerProcess)
        if ($window -ne [IntPtr]::Zero) {
            $owner = [uint32] 0
            [TaskMallPrivateDialogNative]::GetWindowThreadProcessId($window, [ref] $owner) | Out-Null
            if ($owner -eq $ownerProcess) {
                if (-not [TaskMallPrivateDialogNative]::IsWindowVisible($window)) {
                    [TaskMallPrivateDialogNative]::ShowWindow($window, 9) | Out-Null
                }
                if ([TaskMallPrivateDialogNative]::IsWindowVisible($window)) {
                    [TaskMallPrivateDialogNative]::SetForegroundWindow($window) | Out-Null
                    $timer.Stop()
                }
            }
        }
    }.GetNewClosure())
    $timer.Start()
    try { & $Show }
    finally { $timer.Stop(); $timer.Dispose() }
}
