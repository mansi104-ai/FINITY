@echo off
REM FINDEC forward-test daily job.
REM
REM Scheduled for 09:00 IST. That is 03:30 UTC, comfortably after the previous
REM US session's 20:00 UTC close, so the newest completed daily bar is that
REM session -- which is exactly what `as_of` should be.
REM
REM Idempotent: re-running on the same day writes nothing new, so a catch-up
REM launch after a missed start is safe.
REM
REM NOTE: a missed day is a permanent gap. The job always predicts from the
REM newest completed bar, so it cannot manufacture a prediction dated three
REM days ago -- doing so would be exactly the lookahead the forward test
REM exists to exclude. Gaps reduce sample size; they are never backfilled.

setlocal
set REPO=c:\Users\mansi\FINITY
set PY=C:\Users\mansi\AppData\Local\Programs\Python\Python313\python.exe
set LOGDIR=%REPO%\eval\forward\_logs
set PYTHONIOENCODING=utf-8

if not exist "%LOGDIR%" mkdir "%LOGDIR%"

for /f "tokens=1-3 delims=/-. " %%a in ('powershell -NoProfile -Command "(Get-Date).ToString(\"yyyy-MM-dd\")"') do set TODAY=%%a

cd /d "%REPO%"
echo ================================================== >> "%LOGDIR%\daily.log"
powershell -NoProfile -Command "(Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')" >> "%LOGDIR%\daily.log"
"%PY%" "%REPO%\eval\forward\run_daily.py" --arms A >> "%LOGDIR%\daily.log" 2>&1
echo exit=%ERRORLEVEL% >> "%LOGDIR%\daily.log"

endlocal
