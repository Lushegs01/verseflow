@echo off
REM ---------------------------------------------------------------------------
REM Vercel CLI launcher.
REM
REM Calls the CLI through an absolute path to node, bypassing both the PATH and
REM the npm .cmd shim. Useful from an elevated prompt or any shell with a stale
REM environment, where `vercel` is not resolvable.
REM
REM Usage, from this folder:
REM   vf-vercel login
REM   vf-vercel --prod
REM ---------------------------------------------------------------------------

setlocal

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "VERCEL_JS=%APPDATA%\npm\node_modules\vercel\dist\vc.js"

if not exist "%NODE_EXE%" (
  REM Fall back to whatever node is on PATH.
  where node >nul 2>&1 || (
    echo [vf-vercel] Could not find node.exe.
    echo             Looked for: %NODE_EXE%
    exit /b 1
  )
  set "NODE_EXE=node"
)

if not exist "%VERCEL_JS%" (
  echo [vf-vercel] Vercel CLI is not installed for this user.
  echo             Expected: %VERCEL_JS%
  echo             Install it with:  npm install -g vercel
  exit /b 1
)

"%NODE_EXE%" "%VERCEL_JS%" %*
