@echo off
:: DevPilot - Simple Windows Launcher
:: Double-click this file to start DevPilot, or run from Command Prompt.
:: For full setup (venv + ingestion), use setup.ps1 instead.

title DevPilot API

echo.
echo  DevPilot - AI Developer Onboarding Assistant
echo  -----------------------------------------------

:: Check for .env file
if not exist ".env" (
    if exist ".env.example" (
        copy .env.example .env >nul
        echo  [!!] .env created from .env.example
        echo       Open .env and set OPENAI_API_KEY for full RAG mode.
    ) else (
        echo  [!!] No .env file found. Running in mock mode.
    )
) else (
    echo  [OK] .env found
)

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    py --version >nul 2>&1
    if errorlevel 1 (
        echo  [X] Python not found. Install from https://www.python.org/downloads/
        pause
        exit /b 1
    )
    set PYTHON=py
) else (
    set PYTHON=python
)

:: Check if venv exists, use it
if exist ".venv\Scripts\python.exe" (
    set PYTHON=.venv\Scripts\python.exe
    echo  [OK] Using virtual environment
) else (
    echo  [!!] No .venv found. Installing deps globally...
    %PYTHON% -m pip install -r backend\requirements.txt --quiet
)

echo.
echo  Starting API at http://localhost:8000
echo  Swagger UI:    http://localhost:8000/docs
echo  Press Ctrl+C to stop.
echo.

cd backend
%PYTHON% -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

pause
