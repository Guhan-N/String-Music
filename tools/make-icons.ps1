# Generates all String Music icon sizes from the master logo.
# Usage: powershell -File tools\make-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root    = Split-Path -Parent $PSScriptRoot   # music-ecosystem/
$srcPath = Join-Path $root 'branding\string-music.png'

# Center-crop the app-icon square out of the master artwork.
$src = [System.Drawing.Image]::FromFile($srcPath)
Write-Host ("Master: {0}x{1}" -f $src.Width, $src.Height)

# The app icon occupies the middle square. Keep the visible squircle with
# margins: use 660px of the 960px width, vertically centered on the artwork.
$side = 660
$cx = [int]($src.Width / 2)
$cy = [int]($src.Height / 2)
$cropX = $cx - [int]($side / 2)
$cropY = $cy - [int]($side / 2)

function Save-Square([System.Drawing.Image]$source, [System.Drawing.Rectangle]$crop, [int]$size, [string]$outPath, [bool]$circle, [int]$padPct) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    # Padding keeps the artwork inside round masks / adaptive safe zones.
    $pad = [int]($size * $padPct / 100)
    $inner = $size - 2 * $pad
    $srcRect = $crop
    if ($circle) {
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddEllipse($pad, $pad, $inner, $inner)
        $g.SetClip($path)
    }
    $g.DrawImage($source, (New-Object System.Drawing.Rectangle($pad, $pad, $inner, $inner)), $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host ("  wrote {0}" -f $outPath)
}

# Android resource root (needed by the adaptive background color below).
$res = Join-Path $root 'mobile\android\app\src\main\res'

# Samples the artwork's corner color so the adaptive-icon background
# matches the logo's own dark backdrop exactly (white made it look broken).
$cornerBmp = New-Object System.Drawing.Bitmap($src)
$corner = $cornerBmp.GetPixel($cropX + 8, $cropY + 8)
$cornerBmp.Dispose()
$hex = '#{0:X2}{1:X2}{2:X2}' -f $corner.R, $corner.G, $corner.B
$colorXml = "<?xml version=`"1.0`" encoding=`"utf-8`"?>`n<resources>`n    <color name=`"ic_launcher_background`">$hex</color>`n</resources>"
Set-Content -Path (Join-Path $res 'values\ic_launcher_background.xml') -Value $colorXml -Encoding UTF8
Write-Host ("  adaptive background = $hex")

# --- Web / PWA icons (square artwork, no shape mask) ---
$iconsDir = Join-Path $root 'web\icons'
Save-Square $src (New-Object System.Drawing.Rectangle($cropX, $cropY, $side, $side)) 192 (Join-Path $iconsDir 'icon-192.png') $false 0
Save-Square $src (New-Object System.Drawing.Rectangle($cropX, $cropY, $side, $side)) 512 (Join-Path $iconsDir 'icon-512.png') $false 0
Save-Square $src (New-Object System.Drawing.Rectangle($cropX, $cropY, $side, $side)) 180 (Join-Path $iconsDir 'apple-touch-icon.png') $false 0

# --- Favicon (32) + shortcut (48) ---
Save-Square $src (New-Object System.Drawing.Rectangle($cropX, $cropY, $side, $side)) 32 (Join-Path $root 'web\favicon-32.png') $false 0
Save-Square $src (New-Object System.Drawing.Rectangle($cropX, $cropY, $side, $side)) 48 (Join-Path $root 'web\favicon-48.png') $false 0

# --- Android launcher mipmaps ---
# Adaptive icon strategy: the FULL artwork (dark squircle + metallic clef)
# fills the entire foreground canvas — the launcher mask crops the edges,
# and since the background color matches the artwork's own backdrop, the
# visible result is the logo on its natural dark background. The clef sits
# well inside the circular safe zone, so nothing important is ever cropped.
foreach ($dpi in @(@('mdpi',48), @('hdpi',72), @('xhdpi',96), @('xxhdpi',144), @('xxxhdpi',192))) {
    $name = 'mipmap-' + $dpi[0]
    $px = $dpi[1]
    $dir = Join-Path $res $name
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    Save-Square $src (New-Object System.Drawing.Rectangle($cropX, $cropY, $side, $side)) $px (Join-Path $dir 'ic_launcher.png') $false 0
    Save-Square $src (New-Object System.Drawing.Rectangle($cropX, $cropY, $side, $side)) $px (Join-Path $dir 'ic_launcher_round.png') $true 0
    # Foreground: FULL-BLEED artwork on the 108dp canvas (no transparent pad).
    Save-Square $src (New-Object System.Drawing.Rectangle($cropX, $cropY, $side, $side)) ([int]($px * 108 / 48)) (Join-Path $dir 'ic_launcher_foreground.png') $false 0
}

$src.Dispose()
Write-Host 'All icons generated.'
