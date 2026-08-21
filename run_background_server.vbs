Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

' Launch mobile_server.js completely hidden in background (0)
WshShell.Run "node mobile_server.js", 0, False
WshShell.Popup "Content Rewards AI Mobile Server is now running silently in the background!" & vbCrLf & "You can access it from your phone without keeping any window open.", 4, "Content Rewards AI", 64
