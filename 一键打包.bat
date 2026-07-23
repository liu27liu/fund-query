@echo off
title Build Desktop App
echo ==========================================
echo   Build Desktop App - One Click
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
pip install pyinstaller pywebview flask requests --quiet

:: Clean old builds
echo [2/4] Cleaning old builds...
if exist "dist" rmdir /s /q "dist"
if exist "build" rmdir /s /q "build"
if exist "output" rmdir /s /q "output"

:: Build exe with PyInstaller
echo [3/4] Building desktop app (this may take 2-3 minutes)...
pyinstaller --noconfirm --onefile --windowed --name "FundStockQuery" ^
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

:: Copy to output
echo [4/4] Packaging...
mkdir "output"
copy /Y "dist\FundStockQuery.exe" "output\FundStockQuery.exe" >nul

echo.
echo ==========================================
echo   BUILD SUCCESS!
echo.
echo   Output: output\FundStockQuery.exe
echo.
echo   Just double-click to run!
echo   - Native desktop window
echo   - No browser needed
echo   - No Python needed
echo   - No command line needed
echo ==========================================
echo.
echo Opening output folder...
start explorer "output"
pause
