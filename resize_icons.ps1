Add-Type -AssemblyName System.Drawing
$srcPath = "C:\Users\행복한 우리집\.gemini\antigravity\brain\64c6974c-0e9b-41af-a8b0-9efd4cbb1317\app_icon_1776770964106.png"
$wsPath = "c:\Users\행복한 우리집\.gemini\antigravity\scratch\field_photo\"

$srcImg = [System.Drawing.Image]::FromFile($srcPath)

$bmp192 = New-Object System.Drawing.Bitmap 192, 192
$g192 = [System.Drawing.Graphics]::FromImage($bmp192)
$g192.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g192.DrawImage($srcImg, 0, 0, 192, 192)
$bmp192.Save($wsPath + "icon-192.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g192.Dispose()
$bmp192.Dispose()

$bmp512 = New-Object System.Drawing.Bitmap 512, 512
$g512 = [System.Drawing.Graphics]::FromImage($bmp512)
$g512.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g512.DrawImage($srcImg, 0, 0, 512, 512)
$bmp512.Save($wsPath + "icon-512.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g512.Dispose()
$bmp512.Dispose()

$srcImg.Dispose()
