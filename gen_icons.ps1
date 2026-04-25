Add-Type -AssemblyName System.Drawing
$b192 = New-Object System.Drawing.Bitmap 192, 192
$g192 = [System.Drawing.Graphics]::FromImage($b192)
$g192.Clear([System.Drawing.Color]::Blue)
$b192.Save("icon-192.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g192.Dispose()
$b192.Dispose()

$b512 = New-Object System.Drawing.Bitmap 512, 512
$g512 = [System.Drawing.Graphics]::FromImage($b512)
$g512.Clear([System.Drawing.Color]::Blue)
$b512.Save("icon-512.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g512.Dispose()
$b512.Dispose()
