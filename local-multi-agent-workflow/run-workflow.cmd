@echo off
setlocal
set "WB_PY=C:\Users\Administrator\.workbuddy\binaries\python\versions\3.13.12\python.exe"
if exist "%WB_PY%" (
  "%WB_PY%" "%~dp0multi_agent_flow.py" %*
) else (
  py -3 "%~dp0multi_agent_flow.py" %*
)
exit /b %ERRORLEVEL%
