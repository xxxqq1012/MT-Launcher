; MT Launcher NSIS 扩展：安装时选择数据目录，并写入引导配置文件。
; 数据根目录（插件/设置/剪贴板/日志）由 mt-data-path.txt 引导，便携版无引导文件时默认程序根目录 data/。

!ifndef MTL_DATA_PAGE_INCLUDED
!define MTL_DATA_PAGE_INCLUDED
!include "nsDialogs.nsh"
!include "MUI2.nsh"

Var MtlDataDialog
Var MtlDataEdit
Var MtlDataBrowse
Var MtlDataPath

Page custom MtlDataPage MtlDataPageLeave

Function MtlDataPage
  !insertmacro MUI_HEADER_TEXT "数据目录" "选择 MT Launcher 数据存储位置（插件、设置、剪贴板、日志）"
  nsDialogs::Create 1018
  Pop $MtlDataDialog
  ${If} $MtlDataDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 12u "数据将保存在此目录："
  Pop $0
  ${NSD_CreateDirRequest} 0 14u 80% 13u "$INSTDIR\data"
  Pop $MtlDataEdit
  ${NSD_CreateBrowseButton} 82% 14u 18% 14u "浏览..."
  Pop $MtlDataBrowse
  ${NSD_OnClick} $MtlDataBrowse MtlDataBrowseClicked

  ${NSD_CreateLabel} 0 32u 100% 40u "修改数据目录不会自动迁移已有数据。卸载 MT Launcher 时不会删除该目录中的数据。"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function MtlDataBrowseClicked
  ${NSD_GetText} $MtlDataEdit $MtlDataPath
  nsDialogs::SelectFolderDialog "选择数据目录" "$MtlDataPath"
  Pop $MtlDataPath
  ${If} $MtlDataPath != error
    ${NSD_SetText} $MtlDataEdit "$MtlDataPath"
  ${EndIf}
FunctionEnd

Function MtlDataPageLeave
  ${NSD_GetText} $MtlDataEdit $MtlDataPath
  ${If} $MtlDataPath == ""
    MessageBox MB_ICONEXCLAMATION "请选择数据目录，或使用默认位置。" /SD IDOK
    Abort
  ${EndIf}
  StrCpy $MtlDataPath "$MtlDataPath"
FunctionEnd

!endif

!macro customInstall
  Delete "$INSTDIR\ztools-agent.exe"
  Delete "$INSTDIR\ztools-updater.exe"
  FileOpen $0 "$INSTDIR\resources\.ztools-nsis-installed" w
  FileWrite $0 "electron-updater-nsis"
  FileClose $0

  # 写入数据目录引导文件（默认 $INSTDIR\data；安装页未打开时兜底）
  StrCmp $MtlDataPath "" 0 +2
    StrCpy $MtlDataPath "$INSTDIR\data"
  FileOpen $0 "$INSTDIR\mt-data-path.txt" w
  FileWrite $0 "$MtlDataPath$\r$\n"
  FileClose $0
!macroend

!macro customUnInstall
  # 覆盖升级也会执行卸载段，仅在用户主动卸载时清理开机启动项。
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${APP_ID}"

    # 清理由旧版 AppUserModelID 写入的开机启动项。
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "link.eiot.ztools"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "link.eiot.ztools"

    # 卸载仅移除引导文件，保留数据目录（含用户数据），便于重装或迁移。
    Delete "$INSTDIR\mt-data-path.txt"
  ${endIf}
!macroend
