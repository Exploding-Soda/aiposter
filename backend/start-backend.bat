@echo off
setlocal

set VENV_DIR=%~dp0.venv
if not exist "%VENV_DIR%" (
  echo [error] .venv not found in backend. Create it first.
  exit /b 1
)

call "%VENV_DIR%\\Scripts\\activate.bat"
python "%~dp0main.py"
