# gen-audition.ps1 — 보이스 선택용 샘플(보이스당 1개) 생성
#   본 생성과 동일한 자연스러움 설정(speed 0.9 등)으로, 후보 보이스의 샘플만 만든다.
#   출력: Audio/voices/_audition/<slug>.mp3 + _audition/manifest.json
#   실행: powershell -ExecutionPolicy Bypass -File tools/gen-audition.ps1

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $PSScriptRoot

$key = $env:ELEVENLABS_API_KEY
if (-not $key) { $kf = Join-Path $root '.tts-key'; if (Test-Path $kf) { $key = (Get-Content $kf -Raw).Trim() } }
if (-not $key) { Write-Error "ElevenLabs API 키가 없습니다."; exit 1 }

$model = 'eleven_multilingual_v2'
$voiceSettings = @{ stability = 0.5; similarity_boost = 0.75; style = 0.0; use_speaker_boost = $true; speed = 0.9 }
$sample = 'Can I get an iced latte and a croissant, please?'
# 자연스러운 영어 회화 보이스 후보 (계정에 있는 것만 사용)
$want = @('Sarah','Laura','Alice','Matilda','Jessica','George','Charlie','Will','River','Liam','Roger','Brian','Chris','Eric')

Write-Host "보이스 목록 조회..."
$avail = (Invoke-RestMethod -Uri 'https://api.elevenlabs.io/v1/voices' -Headers @{ 'xi-api-key' = $key }).voices
function Slug([string]$n) { ((($n -split '[\s\-]')[0]) -replace '[^a-zA-Z0-9]', '').ToLower() }

$dir = Join-Path $root 'Audio/voices/_audition'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$man = [System.Collections.ArrayList]::new()
foreach ($w in $want) {
  $v = $avail | Where-Object { $_.name -like "$w*" } | Select-Object -First 1
  if (-not $v) { continue }
  $slug = Slug $v.name
  if ($man | Where-Object { $_.slug -eq $slug }) { continue }
  $out = Join-Path $dir "$slug.mp3"
  $body = @{ text = $sample; model_id = $model; voice_settings = $voiceSettings } | ConvertTo-Json -Compress
  $uri = "https://api.elevenlabs.io/v1/text-to-speech/$($v.voice_id)?output_format=mp3_44100_128"
  try {
    Invoke-RestMethod -Uri $uri -Method Post -Headers @{ 'xi-api-key' = $key; 'Accept' = 'audio/mpeg' } -ContentType 'application/json' -Body $body -OutFile $out
    [void]$man.Add(@{ slug = $slug; name = $v.name })
    Write-Host ("샘플 생성: {0}  ({1})" -f $slug, $v.name)
  } catch { Write-Warning ("실패 {0}: {1}" -f $slug, $_.Exception.Message) }
}
($man | ConvertTo-Json -Compress) | Set-Content -Path (Join-Path $dir 'manifest.json') -Encoding ascii
Write-Host ("완료 — 샘플 {0}개. audition.html 에서 들어보세요." -f $man.Count)
