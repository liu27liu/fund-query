@echo off
chcp 65001 >nul
title Install Fund Stock Query

echo ==========================================
echo   Installing Fund Stock Query...
echo ==========================================
echo.

:: Install to user directory (no admin needed)
set "INSTALL_DIR=%LOCALAPPDATA%\Programs\FundStockQuery"
echo Installing to: %INSTALL_DIR%

:: Create directory
mkdir "%INSTALL_DIR%" 2>nul

:: Copy exe
echo Copying files...
copy /Y "FundStockQuery.exe" "%INSTALL_DIR%\FundStockQuery.exe" >nul
if errorlevel 1 (
    echo [ERROR] Copy failed! Trying alternative location...
    set "INSTALL_DIR=%USERPROFILE%\FundStockQuery"
    mkdir "%INSTALL_DIR%" 2>nul
    copy /Y "FundStockQuery.exe" "%INSTALL_DIR%\FundStockQuery.exe" >nul
    if errorlevel 1 (
        echo [ERROR] Cannot copy file. Please copy manually.
        pause
        exit /b 1
    )
)
echo [OK] Files copied

:: Create desktop shortcut with icon
echo Creating desktop shortcut...
powershell -Command " = New-Object -ComObject WScript.Shell;  = .CreateShortcut([System.IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'Fund Stock Query.lnk')); .TargetPath = '%INSTALL_DIR%\FundStockQuery.exe'; .IconLocation = '%INSTALL_DIR%\FundStockQuery.exe,0'; .Description = 'Fund Stock Query Platform'; .WorkingDirectory = '%INSTALL_DIR%'; .Save()"

:: Create start menu shortcut
echo Creating start menu shortcut...
powershell -Command " = New-Object -ComObject WScript.Shell;  = [System.IO.Path]::Combine([Environment]::GetFolderPath('Programs'), 'Fund Stock Query'); if (!(Test-Path )) { New-Item -ItemType Directory -Path  | Out-Null };  = .CreateShortcut([System.IO.Path]::Combine(, 'Fund Stock Query.lnk')); .TargetPath = '%INSTALL_DIR%\FundStockQuery.exe'; .IconLocation = '%INSTALL_DIR%\FundStockQuery.exe,0'; .Description = 'Fund Stock Query Platform'; .WorkingDirectory = '%INSTALL_DIR%'; .Save()"

:: Create uninstaller
echo Creating uninstaller...
(
echo @echo off
echo chcp 65001 ^>nul
echo title Uninstall Fund Stock Query
echo echo Uninstalling...
echo taskkill /F /IM FundStockQuery.exe 2^>nul
echo del /q "%INSTALL_DIR%\FundStockQuery.exe" 2^>nul
echo del /q "%INSTALL_DIR%\users.json" 2^>nul
echo del /q "%INSTALL_DIR%\admin.db" 2^>nul
echo del /q "%INSTALL_DIR%\Uninstall.bat" 2^>nul
echo rmdir "%INSTALL_DIR%" 2^>nul
echo del /q "%USERPROFILE%\Desktop\Fund Stock Query.lnk" 2^>nul
echo rmdir /s /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Fund Stock Query" 2^>nul
echo echo Uninstalled!
echo pause
) > "%INSTALL_DIR%\Uninstall.bat"

:: Register in Add/Remove Programs (current user)
echo Registering...
powershell -Command " = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\FundStockQuery'; New-Item -Path  -Force | Out-Null; Set-ItemProperty -Path  -Name 'DisplayName' -Value 'Fund Stock Query'; Set-ItemProperty -Path  -Name 'DisplayVersion' -Value '1.0.0'; Set-ItemProperty -Path  -Name 'Publisher' -Value 'FundStockQuery'; Set-ItemProperty -Path  -Name 'InstallLocation' -Value '%INSTALL_DIR%'; Set-ItemProperty -Path  -Name 'DisplayIcon' -Value '%INSTALL_DIR%\FundStockQuery.exe'; Set-ItemProperty -Path  -Name 'UninstallString' -Value '%INSTALL_DIR%\Uninstall.bat'; Set-ItemProperty -Path  -Name 'NoModify' -Value 1 -Type DWord; Set-ItemProperty -Path  -Name 'NoRepair' -Value 1 -Type DWord"

echo.
echo ==========================================
echo   INSTALL SUCCESS!
echo.
echo   Desktop shortcut: Fund Stock Query
echo   Start menu: Fund Stock Query
echo   Location: %INSTALL_DIR%
echo.
echo   Double-click desktop icon to start!
echo ==========================================
echo.

:: Launch app
set /p LAUNCH="Launch now? (Y/N): "
if /i "%LAUNCH%"=="Y" start "" "%INSTALL_DIR%\FundStockQuery.exe"
if /i "%LAUNCH%"=="y" start "" "%INSTALL_DIR%\FundStockQuery.exe"

pause
