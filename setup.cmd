@echo off
rem ==========================================================================
rem  setup.cmd  —  zero-dependency bootstrap for the petdex Windows desktop.
rem
rem  Works in a FRESH cmd window with no bun/node on PATH. It:
rem    1. Finds bun (PATH, then %USERPROFILE%\.bun\bin\bun.exe).
rem    2. If missing, downloads it via PowerShell (curl is the fallback).
rem    3. Runs scripts\setup-windows.ts with the resolved bun.
rem
rem  Run it from the repo root:
rem    setup.cmd
rem
rem  After it finishes, CLOSE AND REOPEN your terminal so `bun` and `petdex`
rem  are on your PATH (the setup writes them to the User PATH, but PATH
rem  changes only apply to terminals opened AFTER the write).
rem ==========================================================================
setlocal enableextensions

set "BUN_EXE="
where bun >nul 2>nul && set "BUN_EXE=bun"

if not defined BUN_EXE (
  if exist "%USERPROFILE%\.bun\bin\bun.exe" set "BUN_EXE=%USERPROFILE%\.bun\bin\bun.exe"
)

if not defined BUN_EXE (
  echo [setup] Bun not found. Installing via PowerShell ...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
  if exist "%USERPROFILE%\.bun\bin\bun.exe" (
    set "BUN_EXE=%USERPROFILE%\.bun\bin\bun.exe"
  ) else (
    echo [setup] Bun install failed. Install manually from https://bun.sh then re-run setup.cmd
    exit /b 1
  )
)

echo [setup] Using bun: %BUN_EXE%
"%BUN_EXE%" "%~dp0scripts\setup-windows.ts"
set "RC=%errorlevel%"

echo.
echo [setup] Done (exit %RC%).
echo [setup] If this is your first run: CLOSE AND REOPEN this terminal so
echo [setup] `bun` and `petdex` are on your PATH, then continue with the
echo [setup] tutorial (docs\tutorial.md).

endlocal & exit /b %RC%
