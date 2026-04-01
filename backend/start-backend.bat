@echo off
setlocal

set VENV_DIR=%~dp0.venv
if not exist "%VENV_DIR%" (
  echo [error] .venv not found in backend. Create it first.
  exit /b 1
)

call "%VENV_DIR%\\Scripts\\activate.bat"
set MOCK_AI_MODE=1
set MOCK_AI_DELAY_MS=5000
set MOCK_AI_ERROR_RATE=0.02
python "%~dp0main.py"
