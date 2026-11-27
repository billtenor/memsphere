@echo off
setlocal

call ".ci-install\node_modules\.bin\memsphere.cmd" --version
if errorlevel 1 exit /b %errorlevel%
call ".ci-install\node_modules\.bin\memsphere.cmd" --help
if errorlevel 1 exit /b %errorlevel%

cd /d ".ci windows project" || exit /b 1
call "..\.ci-install\node_modules\.bin\memsphere.cmd" view status
exit /b %errorlevel%
