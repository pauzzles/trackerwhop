Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

If FSO.FileExists(scriptDir & "\monitor.js") Then
    WshShell.Run "node monitor.js --loop 30m", 0, False
ElseIf FSO.FileExists(scriptDir & "\files\monitor.js") Then
    WshShell.Run "node files\monitor.js --loop 30m", 0, False
Else
    WshShell.Run "python monitor.py --loop 30m --notify discord", 0, False
End If
