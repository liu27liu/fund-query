@echo off
chcp 65001 >nul
title Build Desktop App
echo ==========================================
echo   Fund Stock Query - Build
echo ==========================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found!
    echo Please install Python 3.11+ from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH"
    pause
    exit /b 1
)
python --version

:: Install dependencies
echo.
echo [1/3] Installing dependencies...
pip install pyinstaller pywebview flask requests pillow --quiet

:: Clean old builds
echo [2/3] Building app (may take 2-3 minutes)...
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
    echo [ERROR] Build failed!
    pause
    exit /b 1
)
echo [OK] App built

:: Build installer
echo Building installer...
pyinstaller --noconfirm --onefile --windowed --name "Setup" ^
    --icon "assets\logo.ico" ^
    installer_gui.py

:: Create output folder
echo [3/3] Packaging...
mkdir "output"
copy /Y "dist\FundStockQuery.exe" "output\" >nul
copy /Y "dist\Setup.exe" "output\" >nul 2>nul
if not exist "output\Setup.exe" (
    echo [WARN] Setup.exe build failed
    pause
    exit /b 1
)

:: Delete standalone exe, only keep Setup
del /q "output\FundStockQuery.exe" >nul 2>nul

echo.
echo ==========================================
echo   BUILD SUCCESS!
echo.
echo   output\Setup.exe - Double-click to install
echo ==========================================
echo.
start explorer "output"
pause
