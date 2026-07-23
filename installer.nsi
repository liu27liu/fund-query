; NSIS Install Script - Fund Stock Query Platform
; Requires NSIS 3.x: https://nsis.sourceforge.io/Download

!define APP_NAME "FundStockQuery"
!define APP_DISPLAY_NAME "基金股票查询平台"
!define APP_VERSION "1.0.0"
!define APP_PUBLISHER "FundStockQuery"
!define APP_EXE "FundStockQuery.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"

; Basic settings
OutFile "output\FundStockQuery_Setup_${APP_VERSION}.exe"
InstallDir "$PROGRAMFILES64\${APP_NAME}"
InstallDirRegKey HKLM "${UNINSTALL_KEY}" "InstallLocation"
RequestExecutionLevel admin

; UI settings
!include "MUI2.nsh"
!define MUI_ICON "assets\logo.ico"
!define MUI_UNICON "assets\logo.ico"
!define MUI_ABORTWARNING

; Welcome page
!define MUI_WELCOMEPAGE_TITLE "${APP_DISPLAY_NAME}"
!define MUI_WELCOMEPAGE_TEXT "即将安装 ${APP_DISPLAY_NAME} $\n$\n 全市场基金实时估值 · A股行情 · 主力资金流向 $\n$\n 点击 [安装] 开始安装"
!insertmacro MUI_PAGE_WELCOME

; License page (optional)
!insertmacro MUI_PAGE_DIRECTORY

; Install files page
!insertmacro MUI_PAGE_INSTFILES

; Finish page
!define MUI_FINISHPAGE_TITLE "安装完成"
!define MUI_FINISHPAGE_TEXT "安装已完成！$\n$\n点击 [完成] 启动 ${APP_DISPLAY_NAME}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "启动 ${APP_DISPLAY_NAME}"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

; Version info
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName" "${APP_DISPLAY_NAME}"
VIAddVersionKey "CompanyName" "${APP_PUBLISHER}"
VIAddVersionKey "FileDescription" "${APP_DISPLAY_NAME} - Desktop App"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "(C) 2024 ${APP_PUBLISHER}"

; Install section
Section "Install"
    SetOutPath "$INSTDIR"

    ; Main exe
    File "dist\${APP_EXE}"

    ; Set app icon
    WriteRegStr HKCR "${APP_NAME}.exe" "" "${APP_DISPLAY_NAME}"
    WriteRegStr HKCR "${APP_NAME}.exe\DefaultIcon" "" "$INSTDIR\${APP_EXE},0"

    ; Create shortcuts
    CreateDirectory "$SMPROGRAMS\${APP_DISPLAY_NAME}"
    CreateShortCut "$SMPROGRAMS\${APP_DISPLAY_NAME}\${APP_DISPLAY_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
    CreateShortCut "$DESKTOP\${APP_DISPLAY_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0

    ; Uninstall info
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayName" "${APP_DISPLAY_NAME}"
    WriteRegStr HKLM "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegStr HKLM "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
    WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
    WriteRegStr HKLM "${UNINSTALL_KEY}" "Publisher" "${APP_PUBLISHER}"
    WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify" 1
    WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair" 1

    ; Calculate install size
    ${GetSize} "$INSTDIR" "" "" $0
    IntFmt $0 "0x%08X" $0
    WriteRegDWORD HKLM "${UNINSTALL_KEY}" "EstimatedSize" $0
SectionEnd

; Uninstall section
Section "Uninstall"
    ; Kill running process
    nsExec::ExecToLog 'taskkill /F /IM ${APP_EXE}'

    ; Delete files
    Delete "$INSTDIR\${APP_EXE}"
    Delete "$INSTDIR\Uninstall.exe"
    Delete "$INSTDIR\users.json"
    Delete "$INSTDIR\deleted_users.json"
    Delete "$INSTDIR\admin.db"
    Delete "$INSTDIR\admin.db-wal"
    Delete "$INSTDIR\admin.db-shm"
    Delete "$INSTDIR\server.log"

    ; Delete shortcuts
    Delete "$DESKTOP\${APP_DISPLAY_NAME}.lnk"
    Delete "$SMPROGRAMS\${APP_DISPLAY_NAME}\${APP_DISPLAY_NAME}.lnk"
    RMDir "$SMPROGRAMS\${APP_DISPLAY_NAME}"

    ; Clean up directory
    RMDir "$INSTDIR"

    ; Delete registry
    DeleteRegKey HKLM "${UNINSTALL_KEY}"
    DeleteRegKey HKCR "${APP_NAME}.exe"
SectionEnd
