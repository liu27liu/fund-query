@echo off
chcp 65001 >nul
title Uninstall Fund Stock Query

:: Request admin privileges
net session >nul 2>&1
if errorlevel 1 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo ==========================================
echo   Uninstalling Fund Stock Query...
echo ==========================================
echo.

echo [1/4] Killing process...
taskkill /F /IM FundStockQuery.exe 2>nul
taskkill /F /IM Setup.exe 2>nul
timeout /t 1 /nobreak >nul

echo [2/4] Deleting files...

if exist "D:\Program Files\FundStockQuery" (
    echo Found: D:\Program Files\FundStockQuery
    rmdir /s /q "D:\Program Files\FundStockQuery" 2>nul
)

if exist "%PROGRAMFILES%\FundStockQuery" (
    echo Found: %PROGRAMFILES%\FundStockQuery
    rmdir /s /q "%PROGRAMFILES%\FundStockQuery" 2>nul
)

if exist "%PROGRAMFILES(X86)%\FundStockQuery" (
    echo Found: %PROGRAMFILES(X86)%\FundStockQuery
    rmdir /s /q "%PROGRAMFILES(X86)%\FundStockQuery" 2>nul
)

if exist "%LOCALAPPDATA%\Programs\FundStockQuery" (
    echo Found: %LOCALAPPDATA%\Programs\FundStockQuery
    rmdir /s /q "%LOCALAPPDATA%\Programs\FundStockQuery" 2>nul
)

if exist "%USERPROFILE%\FundStockQuery" (
    echo Found: %USERPROFILE%\FundStockQuery
    rmdir /s /q "%USERPROFILE%\FundStockQuery" 2>nul
)

echo [3/4] Deleting shortcuts...
del /q "%USERPROFILE%\Desktop\Fund Stock Query.lnk" 2>nul
del /q "%USERPROFILE%\Desktop\净值通.lnk" 2>nul
del /q "%PUBLIC%\Desktop\Fund Stock Query.lnk" 2>nul
del /q "%PUBLIC%\Desktop\净值通.lnk" 2>nul

echo [4/4] Cleaning registry...
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\FundStockQuery" /f 2>nul
reg delete "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\FundStockQuery" /f 2>nul
reg delete "HKLM\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\FundStockQuery" /f 2>nul

rmdir /s /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Fund Stock Query" 2>nul
rmdir /s /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\净值通" 2>nul
rmdir /s /q "%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\Fund Stock Query" 2>nul
rmdir /s /q "%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\净值通" 2>nul

echo.
echo ==========================================
echo   Uninstall Complete!
echo ==========================================
echo.
pause
