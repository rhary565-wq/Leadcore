@echo off
REM Starts the Leadcore backend (port 8080) and frontend (port 3000) in two windows.
cd /d "%~dp0"
if not exist backend\node_modules (cd backend && call npm install && cd ..)
if not exist frontend\node_modules (cd frontend && call npm install && cd ..)
start "Leadcore Backend" cmd /k "cd backend && npm run dev"
start "Leadcore Frontend" cmd /k "cd frontend && npm run dev"
timeout /t 5 >nul
start http://localhost:3000
