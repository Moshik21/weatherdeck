@echo off
rem Windows launcher: weatherdeck on | off | status | run --demo ...
rem Uses "py -3" when the Python launcher exists, otherwise python on the PATH.
where py >nul 2>nul
if %errorlevel%==0 (py -3 "%~dp0weatherdeck" %*) else (python "%~dp0weatherdeck" %*)
