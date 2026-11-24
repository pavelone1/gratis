# Draws the Gravis icon (a glowing core with three tilted orbits) and writes assets/gravis-icon.png and assets/gravis.ico.
# Run on Windows:  powershell -File scripts/make-windows-icon.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$S = 1024
$outDir = Join-Path $PSScriptRoot '..\assets'
New-Item -ItemType Directory -Force $outDir | Out-Null

function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure(); return $p
}
function Glow($g, [float]$cx, [float]$cy, [float]$radius, $color, [int]$peak) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse($cx - $radius, $cy - $radius, $radius * 2, $radius * 2)
  $b = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
  $b.CenterPoint = New-Object System.Drawing.PointF($cx, $cy)
  $b.CenterColor = [System.Drawing.Color]::FromArgb($peak, $color)
  $b.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $color))
  $g.FillPath($b, $path); $b.Dispose(); $path.Dispose()
}

$bmp = New-Object System.Drawing.Bitmap $S, $S, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
$g.Clear([System.Drawing.Color]::Transparent)

# Background tile
$tile = New-RoundedRect 0 0 $S $S 230
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.Point(0, 0)), (New-Object System.Drawing.Point($S, $S)), [System.Drawing.Color]::FromArgb(255, 9, 12, 32), [System.Drawing.Color]::FromArgb(255, 30, 41, 99))
$g.FillPath($bg, $tile)
$g.SetClip($tile)
Glow $g 512 512 520 ([System.Drawing.Color]::FromArgb(255, 70, 90, 220)) 90   # soft blue haze behind the core
# a few stars
$rng = New-Object System.Random 7
for ($i = 0; $i -lt 26; $i++) {
  $x = $rng.Next(40, $S - 40); $y = $rng.Next(40, $S - 40); $r = $rng.Next(2, 6)
  if ([math]::Sqrt([math]::Pow($x - 512, 2) + [math]::Pow($y - 512, 2)) -lt 250) { continue }
  $g.FillEllipse((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($rng.Next(90, 200), 255, 255, 255))), $x - $r, $y - $r, $r * 2, $r * 2)
}

# Orbits: tilted ellipses, one satellite on each
$orbits = @(
  @{ angle = -32; rx = 400; ry = 150; color = [System.Drawing.Color]::FromArgb(255, 94, 234, 212); t = 0.55 },
  @{ angle = 32; rx = 400; ry = 150; color = [System.Drawing.Color]::FromArgb(255, 167, 139, 250); t = 2.55 },
  @{ angle = 90; rx = 400; ry = 150; color = [System.Drawing.Color]::FromArgb(255, 251, 191, 36); t = 4.35 }
)
$sats = @()
foreach ($o in $orbits) {
  $g.ResetTransform(); $g.TranslateTransform(512, 512); $g.RotateTransform($o.angle)
  $nrx = 0 - [double]$o.rx; $nry = 0 - [double]$o.ry
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, $o.color), 34)
  $g.DrawEllipse($pen, $nrx, $nry, $o.rx * 2, $o.ry * 2)
  $pen2 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(230, $o.color), 13)
  $g.DrawEllipse($pen2, $nrx, $nry, $o.rx * 2, $o.ry * 2)
  # satellite position in image space
  $lx = $o.rx * [math]::Cos($o.t); $ly = $o.ry * [math]::Sin($o.t)
  $a = $o.angle * [math]::PI / 180
  $sats += @{ x = 512 + $lx * [math]::Cos($a) - $ly * [math]::Sin($a); y = 512 + $lx * [math]::Sin($a) + $ly * [math]::Cos($a); color = $o.color }
}
$g.ResetTransform()

# Core
Glow $g 512 512 330 ([System.Drawing.Color]::FromArgb(255, 120, 170, 255)) 150
Glow $g 512 512 210 ([System.Drawing.Color]::FromArgb(255, 190, 225, 255)) 210
$core = New-Object System.Drawing.Drawing2D.GraphicsPath
$core.AddEllipse(512 - 128, 512 - 128, 256, 256)
$cb = New-Object System.Drawing.Drawing2D.PathGradientBrush($core)
$cb.CenterPoint = New-Object System.Drawing.PointF(480, 470)
$cb.CenterColor = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
$cb.SurroundColors = @([System.Drawing.Color]::FromArgb(255, 70, 130, 245))
$g.FillPath($cb, $core)

# Satellites on top, each with a glow
foreach ($sat in $sats) {
  Glow $g $sat.x $sat.y 95 $sat.color 200
  $g.FillEllipse((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))), $sat.x - 40, $sat.y - 40, 80, 80)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($sat.color)), $sat.x - 31, $sat.y - 31, 62, 62)
}
$g.ResetClip()
# thin rim light on the tile
$rim = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60, 255, 255, 255), 6)
$g.DrawPath($rim, (New-RoundedRect 3 3 ($S - 6) ($S - 6) 227))
$g.Dispose()

$pngPath = Join-Path $outDir 'gravis-icon.png'
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# Multi-size ICO (PNG-compressed entries)
$sizes = 256, 128, 64, 48, 32, 16
$images = foreach ($size in $sizes) {
  $small = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $sg = [System.Drawing.Graphics]::FromImage($small); $sg.InterpolationMode = 'HighQualityBicubic'; $sg.SmoothingMode = 'HighQuality'; $sg.PixelOffsetMode = 'HighQuality'
  $sg.DrawImage($bmp, 0, 0, $size, $size); $sg.Dispose()
  $m = New-Object System.IO.MemoryStream; $small.Save($m, [System.Drawing.Imaging.ImageFormat]::Png); $small.Dispose()
  [pscustomobject]@{ Size = $size; Bytes = $m.ToArray() }
}
$bmp.Dispose()
$ms = New-Object System.IO.MemoryStream; $w = New-Object System.IO.BinaryWriter $ms
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$images.Count)
$offset = 6 + 16 * $images.Count
foreach ($i in $images) {
  $dim = if ($i.Size -ge 256) { 0 } else { $i.Size }
  $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0); $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]$i.Bytes.Length); $w.Write([uint32]$offset); $offset += $i.Bytes.Length
}
foreach ($i in $images) { $w.Write($i.Bytes) }
$w.Flush()
$icoPath = Join-Path $outDir 'gravis.ico'
[IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
"png: $pngPath"; "ico: $icoPath ($((Get-Item $icoPath).Length) bytes, sizes: $($sizes -join ','))"
