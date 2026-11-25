@echo off
setlocal
cd /d "%~dp0.."

echo ============================================================
echo  BeatSave 60 fps Preview Recorder + Neural VO Muxer
echo ============================================================
echo Make sure Preview Simulation Mode is set to SPECS 27
echo (optional: switch Preview scene to Sunlit Room) before locking.
echo.

python "tools\record_demo.py"
set EXIT_CODE=%ERRORLEVEL%

echo.
if %EXIT_CODE% EQU 0 (
  echo [DONE] Video and thumbnail updated cleanly inside devpost\media\.
) else (
  echo [FAILED] Exit code %EXIT_CODE%. Check messages above.
)
pause
exit /b %EXIT_CODE%
