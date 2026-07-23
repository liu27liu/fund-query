@echo off
chcp 65001 >nul
title Build Installer
echo ==========================================
echo   Fund Stock Query - Build Installer
echo ==========================================
echo.

:: Step 1: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found!
    echo Please install Python 3.11+ from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH"
    pause
    exit /b 1
)
python --version

:: Step 2: Install Python dependencies
echo.
echo [1/4] Installing Python dependencies...
pip install pyinstaller pywebview flask requests pillow --quiet

:: Step 3: Check NSIS
echo [2/4] Checking NSIS (installer maker)...
where makensis >nul 2>&1
if errorlevel 1 (
    echo [WARN] NSIS not found, downloading...
    curl -L -o nsis-setup.exe "https://nsis.sourceforge.io/Download" 2>nul
    if exist nsis-setup.exe (
        echo Please install NSIS from the downloaded file, then re-run this script.
        echo Download: https://nsis.sourceforge.io/Download
        start nsis-setup.exe
        pause
        exit /b 1
    )
    echo [ERROR] NSIS is required but not found.
    echo Download and install NSIS from: https://nsis.sourceforge.io/Download
    echo After installation, re-run this script.
    pause
    exit /b 1
)
echo [OK] NSIS found

:: Step 4: Build exe
echo [3/4] Building desktop exe (may take 2-3 minutes)...
if exist "dist" rmdir /s /q "dist"
if exist "build" rmdir /s /q "build"
if exist "output" rmdir /s /q "output"

pyinstaller --noconfirm --onefile --windowed --name "FundStockQuery" ^
    --icon "assets\logo.ico" ^
    --add-data "index.html;." ^
    --add-data "admin.html;." ^
    --add-data "css;css" ^
    --add-data "js;js" ^
    --add-data "assets;assets" ^
    --add-data "allowed_sectors.py;." ^
    --add-data "sector_categories.py;." ^
    --add-data "yangjibao_sectors.py;." ^
    --add-data "admin_api.py;." ^
    --add-data "admin_db.py;." ^
    --hidden-import flask ^
    --hidden-import requests ^
    --hidden-import werkzeug ^
    --hidden-import jinja2 ^
    --hidden-import markupsafe ^
    --hidden-import itsdangerous ^
    --hidden-import click ^
    --hidden-import charset_normalizer ^
    --hidden-import urllib3 ^
    --hidden-import certifi ^
    --hidden-import idna ^
    --hidden-import sqlite3 ^
    --hidden-import webview ^
    --hidden-import webview.platforms.edgechromium ^
    --hidden-import webview.platforms.winforms ^
    --hidden-import webview.platforms.mshtml ^
    --hidden-import allowed_sectors ^
    --hidden-import sector_categories ^
    --hidden-import yangjibao_sectors ^
    --hidden-import admin_api ^
    --hidden-import admin_db ^
    desktop.py

if errorlevel 1 (
    echo [ERROR] Build exe failed!
    pause
    exit /b 1
)
echo [OK] Exe built successfully

:: Step 5: Build NSIS installer
echo [4/4] Building installer package...
mkdir "output"
makensis /DVERSION=1.0.0 installer.nsi

if errorlevel 1 (
    echo [ERROR] Build installer failed!
    pause
    exit /b 1
)

echo.
echo ==========================================
echo   BUILD SUCCESS!
echo.
echo   Installer: output\FundStockQuery_Setup.exe
echo.
echo   Features:
echo   - Native desktop window (not browser)
echo   - Desktop shortcut with app icon
echo   - Start menu shortcut
echo   - Add/Remove Programs entry
echo   - Uninstaller included
echo   - No Python needed to run
echo ==========================================
echo.
echo Opening output folder...
start explorer "output"
pause
