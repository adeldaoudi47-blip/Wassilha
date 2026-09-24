@echo off
cd /d C:\Wassilha-ZAI
set GIT=C:\Program Files\Git\cmd\git.exe

echo ===== git add -A =====
"%GIT%" add -A
echo ADD_EXIT=%errorlevel%

echo.
echo ===== git commit =====
"%GIT%" commit -m "chore: trigger vercel deploy"
echo COMMIT_EXIT=%errorlevel%

echo.
echo ===== git push origin main =====
"%GIT%" push origin main 2>&1
echo PUSH_EXIT=%errorlevel%

echo.
echo ===== verify sync =====
"%GIT%" status -sb
"%GIT%" log --oneline -3

echo ALL_DONE
