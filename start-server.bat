@echo off
echo ========================================================
echo   Starting Pop Carty E-Commerce REST API & Store Server
echo ========================================================
echo.

set ELECTRON_RUN_AS_NODE=1
set PORT=3000

if exist "%APPDATA%\Antigravity\bin\agy-node.cmd" (
    call "%APPDATA%\Antigravity\bin\agy-node.cmd" server.js
) else if exist "C:\Program Files\Adobe\Adobe Creative Cloud Experience\libs\node.exe" (
    "C:\Program Files\Adobe\Adobe Creative Cloud Experience\libs\node.exe" server.js
) else (
    node server.js
)

pause
