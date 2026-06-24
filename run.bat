@echo off
title Underdog Quant Terminal
color 0A
setlocal EnableDelayedExpansion

:: ============================================
::  UNDERDOG QUANT TERMINAL - ONE-CLICK LAUNCHER
::  Backend + Frontend (Binance Testnet)
:: ============================================

:: --- Kill any old instances first ---
echo [CLEANUP] Stopping old processes...
taskkill /F /FI "WINDOWTITLE eq UD Backend*" >nul 2>nul
taskkill /F /FI "WINDOWTITLE eq UD Frontend*" >nul 2>nul
timeout /t 1 /nobreak >nul

:: --- Check Node.js ---
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Node.js is NOT installed!
    echo  Download from: https://nodejs.org
    pause
    exit /b 1
)

:: --- Check if project folder exists ---
if not exist "%~dp0backend\server.js" (
    echo  [ERROR] Project files missing!
    pause
    exit /b 1
)

:: --- Install backend dependencies if missing ---
if not exist "%~dp0backend\node_modules" (
    echo  [SETUP] Installing backend dependencies...
    cd /d "%~dp0backend"
    call npm install
    if %errorlevel% neq 0 (
        echo  [ERROR] Backend install failed!
        pause
        exit /b 1
    )
)

:: --- Install frontend dependencies if missing ---
if not exist "%~dp0frontend\node_modules" (
    echo  [SETUP] Installing frontend dependencies...
    cd /d "%~dp0frontend"
    call npm install
    if %errorlevel% neq 0 (
        echo  [ERROR] Frontend install failed!
        pause
        exit /b 1
    )
)

:: --- Kill old processes again ---
taskkill /F /FI "WINDOWTITLE eq UD Backend*" >nul 2>nul
taskkill /F /FI "WINDOWTITLE eq UD Frontend*" >nul 2>nul
timeout /t 1 /nobreak >nul

echo.
echo  ========================================
echo   UNDERDOG QUANT TERMINAL v1.0.0
echo   Binance Testnet Execution
echo  ========================================
echo.

:: --- Start Backend ---
echo  [1/2] Starting Backend Engine...
start "UD Backend" cmd /k "cd /d "%~dp0backend" && title UD Backend && node server.js && pause"

:: --- Wait for backend ---
echo  [WAIT] Waiting for backend...
set /a attempts=0
:waitloop
timeout /t 1 /nobreak >nul
set /a attempts+=1
curl -s http://localhost:3900/api/status >nul 2>nul
if %errorlevel% neq 0 (
    if !attempts! lss 15 goto waitloop
    echo  [WARN] Backend may not be ready yet, continuing...
) else (
    echo  [OK] Backend is online!
)

:: --- Start Frontend ---
echo  [2/2] Starting Frontend Dashboard...
start "UD Frontend" cmd /k "cd /d "%~dp0frontend" && title UD Frontend && npm run dev && pause"
timeout /t 5 /nobreak >nul

:: --- Open Browser ---
echo  [READY] Opening browser...
start http://localhost:5173

:: --- Done ---
echo.
echo  ========================================
echo   TERMINAL IS LIVE
echo  ========================================
echo   Dashboard:  http://localhost:5173
echo   API:        http://localhost:3900
echo   Exchange:   Binance Testnet
echo  ========================================
echo.
echo  Press any key to close this launcher...
pause >nul
