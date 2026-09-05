@echo off
chcp 65001 >nul
title 亚马逊产品库 - GitHub 一键推送助手 (Token 版)

echo ====================================================================
echo             亚马逊产品库 - GitHub 一键免密推送助手
echo ====================================================================
echo.
echo 提示: GitHub 已禁止使用普通账号密码推送，必须使用 Personal Access Token。
echo.
echo 如果你还没有 Token，请浏览器打开以下网址（已自动勾选权限）：
echo https://github.com/settings/tokens/new?scopes=repo^&description=AmazonVault
echo 滚到最底部点击绿色的 [Generate token]，复制生成的 ghp_ 开头字符。
echo.
echo ====================================================================
echo.
set /p TOKEN=">>> 请在此粘贴你的 GitHub Token (以 ghp_ 开头) 并按回车: "

if "%TOKEN%"=="" (
    echo [错误] Token 不能为空！
    pause
    exit /b
)

echo.
echo [1/3] 正在绑定带有 Token 的专属安全推送通道...
git remote remove origin >nul 2>&1
git remote add origin https://oauth2:%TOKEN%@github.com/lixun58555855-prog/amazon-product-vault.git

echo [2/3] 正在准备主分支 main...
git branch -M main

echo [3/3] 正在秒级推送到 GitHub 云端...
git push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ====================================================================
    echo  🎉🎉🎉 恭喜！代码与产品库已 100%% 成功推送到你的 GitHub 仓库！
    echo ====================================================================
    echo.
    echo 接下来只剩最后一步（开启你的云端网站）：
    echo 1. 打开仓库页面: https://github.com/lixun58555855-prog/amazon-product-vault/settings/pages
    echo 2. 在 [Branch] 下拉框将 None 改选为 [main]，点击 [Save]
    echo 3. 稍等 1 分钟即可获得你的专属在线访问网址：
    echo    https://lixun58555855-prog.github.io/amazon-product-vault/
    echo.
) else (
    echo.
    echo [提示] 推送失败，请检查你的 Token 是否完整复制 (以 ghp_ 开头)。
    echo.
)

pause
