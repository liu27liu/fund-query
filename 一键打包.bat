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
    echo Please install Python from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH"
    pause
    exit /b 1
)
python --version

:: Install build tools
echo.
echo [1/3] Installing build tools...
pip install pyinstaller flask requests --quiet

:: Build exe (single file, include all web files)
echo [2/3] Building exe (this may take a minute)...
pyinstaller --onefile --windowed --name "FundStockQuery" ^
    --add-data "index.html;." ^
    --add-data "admin.html;." ^
    --add-data "css;css" ^
    --add-data "js;js" ^
    --add-data "assets;assets" ^
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
    --hidden-import allowed_sectors ^
    --hidden-import sector_categories ^
    --hidden-import yangjibao_sectors ^
    --hidden-import admin_api ^
    --hidden-import admin_db ^
    server.py

if errorlevel 1 (
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

:: Copy to output
echo [3/3] Packaging...
if not exist "output" mkdir output
copy /Y "dist\FundStockQuery.exe" "output\FundStockQuery.exe" >nul

echo.
echo ==========================================
echo   BUILD SUCCESS!
echo   Output: output\FundStockQuery.exe
echo   Double-click to run the app!
echo ==========================================
echo.
echo Opening output folder...
start explorer "output"
pause
