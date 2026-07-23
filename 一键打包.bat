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
echo [1/4] Installing dependencies...
pip install pyinstaller pywebview flask requests pillow --quiet

:: Clean old builds
echo [2/4] Building main app exe (may take 2-3 minutes)...
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
    echo [ERROR] Build main exe failed!
    pause
    exit /b 1
)
echo [OK] Main exe built

:: Build installer exe
echo [3/4] Building installer...
pyinstaller --noconfirm --onefile --windowed --name "Setup" ^
    --icon "assets\logo.ico" ^
    installer_gui.py

if errorlevel 1 (
    echo [WARN] Installer build failed, using bat installer instead
)

:: Create output
echo [4/4] Packaging...
mkdir "output"
copy /Y "dist\FundStockQuery.exe" "output\" >nul
copy /Y "dist\Setup.exe" "output\" >nul 2>nul
if not exist "output\Setup.exe" (
    copy /Y "安装到电脑.bat" "output\" >nul
)

echo.
echo ==========================================
echo   BUILD SUCCESS!
echo.
echo   output\Setup.exe          - Installer (double-click to install)
echo   output\FundStockQuery.exe - Standalone (double-click to run)
echo.
echo   To install: Double-click Setup.exe
echo   To run:     Double-click FundStockQuery.exe
echo ==========================================
echo.
start explorer "output"
pause
