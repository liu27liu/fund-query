@echo off
title Fund Query Platform
echo ==========================================
echo    Fund Query Platform Launcher
echo ==========================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found.
    echo Please install Python 3.11+ from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)

echo [OK] Python found
python --version

echo.
echo Checking dependencies...

if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate.bat

pip show flask requests >nul 2>&1
if errorlevel 1 (
    echo Installing dependencies...
    pip install -r requirements.txt
)

echo [OK] Dependencies ready

echo.
echo Starting server...
start /B python server.py > server.log 2>&1

echo Waiting for server...
timeout /t 4 /nobreak >nul

echo.
echo Opening browser...
start http://127.0.0.1:8080

echo.
echo ==========================================
echo    Server running at http://127.0.0.1:8080
echo    DO NOT CLOSE THIS WINDOW
echo ==========================================
echo.
pause
