@echo off
TITLE IMFSMA - Control Panel
COLOR 09

:menu
cls
echo =======================================================
echo          IMFSMA - Stock Analysis Framework
echo =======================================================
echo.
echo What would you like to do?
echo.
echo    [1] Start Application (Starts Server ^& Opens Browser)
echo    [2] Stop Application  (Shuts down the Server)
echo    [3] Exit
echo.
set /p choice="Enter a number (1, 2, or 3): "

if "%choice%"=="1" goto start
if "%choice%"=="2" goto stop
if "%choice%"=="3" goto exit

goto menu

:start
echo.
echo Starting the Flask Server...
:: Open the server in a new separate CMD window so this panel stays open 
start "IMFSMA_Server_Window" cmd /k "python app.py"

echo Waiting for server to spin up...
:: Wait 3 seconds to let Python load
timeout /t 3 /nobreak >nul

:: Automatically open the default web browser
echo Opening browser...
start http://127.0.0.1:5000
timeout /t 2 >nul
goto menu

:stop
echo.
echo Stopping the IMFSMA Server...
:: Force kill the specific application window we created
taskkill /F /FI "WINDOWTITLE eq IMFSMA_Server_Window*" /T >nul 2>&1
echo.
echo Server successfully stopped!
timeout /t 2 >nul
goto menu

:exit
exit
