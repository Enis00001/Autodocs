Add-Type -AssemblyName System.Drawing

$pub = Join-Path (Get-Location) "public"
$icoPath = Join-Path $pub "favicon.ico"
$pngPath = Join-Path $pub "og-image.png"

# favicon.ico
$bmp = New-Object System.Drawing.Bitmap 256, 256
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

$rect = New-Object System.Drawing.Rectangle 8, 8, 240, 240
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 56
$path.AddArc($rect.X, $rect.Y, $r, $r, 180, 90)
$path.AddArc($rect.Right - $r, $rect.Y, $r, $r, 270, 90)
$path.AddArc($rect.Right - $r, $rect.Bottom - $r, $r, $r, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $r, $r, $r, 90, 90)
$path.CloseFigure()

$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#6366F1"))
$g.FillPath($brush, $path)

$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White, 16)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

$g.DrawLine($pen, 64, 148, 96, 148)
$g.DrawLine($pen, 184, 148, 208, 148)
$g.DrawBezier($pen, 72, 148, 74, 128, 92, 112, 116, 112)
$g.DrawLine($pen, 116, 112, 152, 112)
$g.DrawBezier($pen, 152, 112, 168, 112, 178, 120, 186, 134)
$g.DrawEllipse($pen, 88, 138, 32, 32)
$g.DrawEllipse($pen, 152, 138, 32, 32)

$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$fs = New-Object System.IO.FileStream($icoPath, [System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$g.Dispose()
$bmp.Dispose()

# og-image.png (1200x630)
$w = 1200
$h = 630
$img = New-Object System.Drawing.Bitmap $w, $h
$cg = [System.Drawing.Graphics]::FromImage($img)
$cg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$cg.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$cg.Clear([System.Drawing.ColorTranslator]::FromHtml("#0F1117"))

$lx = 470
$ly = 140
$ls = 260
$logoRect = New-Object System.Drawing.Rectangle $lx, $ly, $ls, $ls
$logoPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$lr = 58
$logoPath.AddArc($logoRect.X, $logoRect.Y, $lr, $lr, 180, 90)
$logoPath.AddArc($logoRect.Right - $lr, $logoRect.Y, $lr, $lr, 270, 90)
$logoPath.AddArc($logoRect.Right - $lr, $logoRect.Bottom - $lr, $lr, $lr, 0, 90)
$logoPath.AddArc($logoRect.X, $logoRect.Bottom - $lr, $lr, $lr, 90, 90)
$logoPath.CloseFigure()

$lb = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#6366F1"))
$cg.FillPath($lb, $logoPath)

$lp = New-Object System.Drawing.Pen ([System.Drawing.Color]::White, 16)
$lp.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$lp.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$lp.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$ox = $lx
$oy = $ly
$cg.DrawLine($lp, $ox + 66, $oy + 154, $ox + 96, $oy + 154)
$cg.DrawLine($lp, $ox + 182, $oy + 154, $ox + 210, $oy + 154)
$cg.DrawBezier($lp, $ox + 74, $oy + 154, $ox + 76, $oy + 132, $ox + 92, $oy + 118, $ox + 116, $oy + 118)
$cg.DrawLine($lp, $ox + 116, $oy + 118, $ox + 154, $oy + 118)
$cg.DrawBezier($lp, $ox + 154, $oy + 118, $ox + 170, $oy + 118, $ox + 182, $oy + 126, $ox + 190, $oy + 140)
$cg.DrawEllipse($lp, $ox + 90, $oy + 144, 34, 34)
$cg.DrawEllipse($lp, $ox + 154, $oy + 144, 34, 34)

$titleFont = New-Object System.Drawing.Font("Segoe UI Semibold", 68, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$subFont = New-Object System.Drawing.Font("Segoe UI", 34, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center

$cg.DrawString("AutoDocs", $titleFont, $white, 600, 450, $sf)
$cg.DrawString("Le bon de commande automobile en 30 secondes", $subFont, $white, 600, 522, $sf)

$img.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$cg.Dispose()
$img.Dispose()

Write-Host "Assets generated:"
Write-Host " - $icoPath"
Write-Host " - $pngPath"
