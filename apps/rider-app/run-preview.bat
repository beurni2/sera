@echo off
REM WO-4.0 - apercu local : installe puis lance le serveur Expo avec le QR.
REM Scannez le QR avec Expo Go (meme reseau Wi-Fi que l'ordinateur).
cd /d "%~dp0"
where pnpm >nul 2>nul || (echo pnpm est requis - https://pnpm.io && exit /b 1)
call pnpm install
call npx expo start
