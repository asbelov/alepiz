#define   Version    "0.0.12"
#define   AppName    "ALEPIZ"
#define   AppId     "{EABD44EE-0DAD-4337-ADC6-A37A930BADC7}"
#define   AppCopyright  "Copyright (c) 2022 Alexander Belov <asbel@alepiz.com>"
#define	  InstallerVersion	"1.0"

[Setup]
AppId={{#AppId}
AppCopyright={#AppCopyright}
AppName={#AppName}
AppVersion={#Version}
AppVerName=Alepiz
AppPublisher={#AppName}
AppPublisherURL=https://alepiz.com/
VersionInfoVersion={#InstallerVersion}
DefaultDirName={commonpf64}\{#AppName}
DefaultGroupName={#AppName}
AllowNoIcons=yes
LicenseFile=C:\Users\asbel\WebstormProjects\distr\alepiz\LICENSE
OutputDir=C:\Users\asbel\WebstormProjects\alepiz
OutputBaseFilename=alepizSetup-{#Version}
SetupIconFile=C:\Users\asbel\WebstormProjects\distr\alepiz\public\favicon.ico
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=admin

[Files]
Source: "C:\Users\asbel\WebstormProjects\alepiz\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: ".*, config\*, logs\*, DB\*, private\*, tests, *.zip, *.7z, copyLog.cmd, sign.cmd, mk7z*.bat, alepizSetup*.exe, *.iss, *.~is, *.heapsnapshot, bin\install_build_tools.cmd, communication\telegram\config.json, actions\qmonitor, actions\procdump, actions\ARQA*, collectors\qmz"
Source: "C:\Users\asbel\WebstormProjects\alepiz\.distr\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Run]
Filename: "{app}\nodejs\alepiz.exe"; Parameters: "bin\alepiz.js --install"; WorkingDir: "{app}"; Description: "Install as service"; Flags: postinstall runhidden runascurrentuser
Filename: "{sys}\net.exe"; Parameters: "start alepiz"; Description: "Launch ALEPIZ"; Flags: postinstall runhidden runascurrentuser
Filename: "{win}\explorer.exe"; Parameters: "http://localhost:88/"; Description: "Launch a browser and connect to ALEPIZ (http://localhost:88/)"; Flags: postinstall shellexec skipifsilent runasoriginaluser

[UninstallRun]
Filename: "{sys}\net.exe"; Parameters: "stop alepiz"; Flags: runhidden
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM:alepiz.exe"; Flags: runhidden
Filename: "{app}\nodejs\alepiz.exe"; Parameters: "bin\alepiz.js --remove"; WorkingDir: "{app}"; Flags: runhidden

[Code]
{ ///////////////////////////////////////////////////////////////////// }
function GetUninstallString(): String;
var
  sUnInstPath: String;
  sUnInstallString: String;
begin
  sUnInstPath := ExpandConstant('Software\Microsoft\Windows\CurrentVersion\Uninstall\{#emit SetupSetting("AppId")}_is1');
  sUnInstallString := '';
  if not RegQueryStringValue(HKLM, sUnInstPath, 'UninstallString', sUnInstallString) then
    RegQueryStringValue(HKCU, sUnInstPath, 'UninstallString', sUnInstallString);
  Result := sUnInstallString;
end;


{ ///////////////////////////////////////////////////////////////////// }
function IsUpgrade(): Boolean;
begin
  Result := (GetUninstallString() <> '');
end;


{ ///////////////////////////////////////////////////////////////////// }
function UnInstallOldVersion(): Integer;
var
  sUnInstallString: String;
  iResultCode: Integer;
begin
{ Return Values: }
{ 1 - uninstall string is empty }
{ 2 - error executing the UnInstallString }
{ 3 - successfully executed the UnInstallString }

  { default return value }
  Result := 0;

  { get the uninstall string of the old app }
  sUnInstallString := GetUninstallString();
  if sUnInstallString <> '' then begin
    sUnInstallString := RemoveQuotes(sUnInstallString);
    if Exec(sUnInstallString, '/SILENT /NORESTART /SUPPRESSMSGBOXES','', SW_HIDE, ewWaitUntilTerminated, iResultCode) then
      Result := 3
    else
      Result := 2;
  end else
    Result := 1;
end;

{ ///////////////////////////////////////////////////////////////////// }
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep=ssInstall) then
  begin
    if (IsUpgrade()) AND (msgbox('Do you want to uninstall another ALEPIZ instance before installing this instance? Configuration, logs and databases will be saved', mbConfirmation, MB_YESNO) = IDYES) then
    begin
      UnInstallOldVersion();
    end;
  end;
end;