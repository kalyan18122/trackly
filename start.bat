@echo off
cd /d "%~dp0"
echo Starting Trackly... two windows will open.
start "Trackly Backend" /d "%~dp0backend" cmd /k "npm install && npm start"
start "Trackly Frontend" /d "%~dp0frontend" cmd /k "npm start"
echo Waiting for the servers to start...
timeout /t 20 /nobreak >nul
start http://localhost:5500
