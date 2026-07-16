@echo off
rem ==========================================================================
rem  run.cmd  —  launch the petdex desktop overlay (zero-PATH bootstrap).
rem
rem  Usage (from the repo root, in any cmd window — bun need NOT be on PATH):
rem    run.cmd                Launch the floating desktop overlay.
rem    run.cmd --generate     Generate a pet via gpt-image-2 first, then launch.
rem
rem  Mirrors setup.cmd's bun-resolution: PATH first, then
rem  %USERPROFILE%\.bun\bin\bun.exe. Delegates to scripts\run-desktop.ts.
rem ==========================================================================
setlocal enableextensions

set "BUN_EXE="
where bun >nul 2>nul && set "BUN_EXE=bun"
if not defined BUN_EXE if exist "%USERPROFILE%\.bun\bin\bun.exe" set "BUN_EXE=%USERPROFILE%\.bun\bin\bun.exe"

if not defined BUN_EXE (
  echo [run] Bun not found. Run setup.cmd first.
  exit /b 1
)

"%BUN_EXE%" "%~dp0scripts\run-desktop.ts" %*
endlocal & exit /b %errorlevel%
