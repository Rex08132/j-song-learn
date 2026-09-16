@echo off
chcp 65001 >nul
echo ========================================================
echo   🎵 J-Song Learn - 日語歌曲互動學習室
echo ========================================================
echo.
echo 正在啟動後端服務與學習介面...
echo 請稍候，瀏覽器將會自動開啟。
echo.

start http://localhost:8000
python server.py

pause
