@echo off
chcp 65001 >nul
title Install Fund Stock Query

:: Request admin privileges
net session >nul 2>&1
if errorlevel 1 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo ==========================================
echo   Installing Fund Stock Query...
echo ==========================================
echo.

:: Install directory
set "INSTALL_DIR=%PROGRAMFILES%\FundStockQuery"
echo Installing to: %INSTALL_DIR%

:: Create directory
mkdir "%INSTALL_DIR%" 2>nul

:: Copy exe
echo Copying files...
copy /Y "FundStockQuery.exe" "%INSTALL_DIR%\FundStockQuery.exe" >nul
if errorlevel 1 (
    echo [ERROR] Copy failed!
    pause
    exit /b 1
)

:: Create desktop shortcut with icon
echo Creating desktop shortcut...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut([System.IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'Fund Stock Query.lnk')); $sc.TargetPath = '%INSTALL_DIR%\FundStockQuery.exe'; $sc.IconLocation = '%INSTALL_DIR%\FundStockQuery.exe,0'; $sc.Description = 'Fund Stock Query Platform'; $sc.WorkingDirectory = '%INSTALL_DIR%'; $sc.Save()"

:: Create start menu shortcut
echo Creating start menu shortcut...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $smDir = [System.IO.Path]::Combine([Environment]::GetFolderPath('Programs'), 'Fund Stock Query'); if (!(Test-Path $smDir)) { New-Item -ItemType Directory -Path $smDir | Out-Null }; $sc = $ws.CreateShortcut([System.IO.Path]::Combine($smDir, 'Fund Stock Query.lnk')); $sc.TargetPath = '%INSTALL_DIR%\FundStockQuery.exe'; $sc.IconLocation = '%INSTALL_DIR%\FundStockQuery.exe,0'; $sc.Description = 'Fund Stock Query Platform'; $sc.WorkingDirectory = '%INSTALL_DIR%'; $sc.Save()"

:: Create uninstaller
echo Creating uninstaller...
(
echo @echo off
echo chcp 65001 ^>nul
echo title Uninstall Fund Stock Query
echo net session ^>nul 2^>^&1
echo if errorlevel 1 (
echo     powershell -Command "Start-Process '%%~f0' -Verb RunAs"
echo     exit /b
echo ^)
echo echo Uninstalling...
echo taskkill /F /IM FundStockQuery.exe 2^>nul
echo del /q "%INSTALL_DIR%\FundStockQuery.exe" 2^>nul
echo del /q "%INSTALL_DIR%\users.json" 2^>nul
echo del /q "%INSTALL_DIR%\deleted_users.json" 2^>nul
echo del /q "%INSTALL_DIR%\admin.db" 2^>nul
echo del /q "%INSTALL_DIR%\admin.db-wal" 2^>nul
echo del /q "%INSTALL_DIR%\admin.db-shm" 2^>nul
echo del /q "%INSTALL_DIR%\server.log" 2^>nul
echo del /q "%INSTALL_DIR%\Uninstall.bat" 2^>nul
echo rmdir "%INSTALL_DIR%" 2^>nul
echo del /q "%USERPROFILE%\Desktop\Fund Stock Query.lnk" 2^>nul
echo rmdir /s /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Fund Stock Query" 2^>nul
echo echo Uninstalled successfully!
echo pause
) > "%INSTALL_DIR%\Uninstall.bat"

:: Register in Add/Remove Programs
echo Registering in Windows...
powershell -Command "$key = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\FundStockQuery'; New-Item -Path $key -Force | Out-Null; Set-ItemProperty -Path $key -Name 'DisplayName' -Value 'Fund Stock Query'; Set-ItemProperty -Path $key -Name 'DisplayVersion' -Value '1.0.0'; Set-ItemProperty -Path $key -Name 'Publisher' -Value 'FundStockQuery'; Set-ItemProperty -Path $key -Name 'InstallLocation' -Value '%INSTALL_DIR%'; Set-ItemProperty -Path $key -Name 'DisplayIcon' -Value '%INSTALL_DIR%\FundStockQuery.exe'; Set-ItemProperty -Path $key -Name 'UninstallString' -Value '%INSTALL_DIR%\Uninstall.bat'; Set-ItemProperty -Path $key -Name 'NoModify' -Value 1 -Type DWord; Set-ItemProperty -Path $key -Name 'NoRepair' -Value 1 -Type DWord"

echo.
echo ==========================================
echo   INSTALL SUCCESS!
echo.
echo   Desktop shortcut created
echo   Start menu shortcut created
echo   Uninstaller available in Control Panel
echo.
echo   Double-click desktop icon to start!
echo ==========================================
echo.

:: Launch app
set /p LAUNCH="Launch now? (Y/N): "
if /i "%LAUNCH%"=="Y" start "" "%INSTALL_DIR%\FundStockQuery.exe"
if /i "%LAUNCH%"=="y" start "" "%INSTALL_DIR%\FundStockQuery.exe"

pause
