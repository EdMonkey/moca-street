# gen-voices.ps1 — 손님 주문 영어 음성(mp3)을 ElevenLabs TTS로 생성
#   키: .tts-key 파일 또는 $env:ELEVENLABS_API_KEY 에서 읽음 (절대 커밋 안 됨 — .gitignore 처리)
#   동작: 계정의 보이스 목록을 조회해 최대 4개 선택 → 문장별 mp3 생성
#   출력: Audio/voices/<voiceName>/<key>.mp3  +  Audio/voices/manifest.json (이미 있으면 건너뜀)
#   실행: powershell -ExecutionPolicy Bypass -File tools/gen-voices.ps1

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $PSScriptRoot

# --- API 키 ---
$key = $env:ELEVENLABS_API_KEY
if (-not $key) {
  $kf = Join-Path $root '.tts-key'
  if (Test-Path $kf) { $key = (Get-Content $kf -Raw).Trim() }
}
if (-not $key) { Write-Error "ElevenLabs API 키가 없습니다. .tts-key 파일에 키를 넣거나 `$env:ELEVENLABS_API_KEY 를 설정하세요."; exit 1 }

$model = 'eleven_multilingual_v2'      # 고품질. 더 저렴/빠르게: 'eleven_turbo_v2_5'
# 자연스러움 튜닝: speed로 생성 단계에서 천천히 말하게(시간늘림 아티팩트 없음)
$voiceSettings = @{ stability = 0.5; similarity_boost = 0.75; style = 0.0; use_speaker_boost = $true; speed = 0.9 }
$want  = @('Laura','Roger','Chris','Eric')  # 선택된 보이스(이름 시작 기준)
$maxVoices = 4

# --- 계정 보이스 조회 → 사용할 보이스 선택 ---
Write-Host "ElevenLabs 보이스 목록 조회 중..."
$resp = Invoke-RestMethod -Uri 'https://api.elevenlabs.io/v1/voices' -Headers @{ 'xi-api-key' = $key }
$avail = $resp.voices
if (-not $avail -or $avail.Count -eq 0) { Write-Error "계정에 사용 가능한 보이스가 없습니다."; exit 1 }

$chosen = [System.Collections.ArrayList]::new()
foreach ($w in $want) {
  if ($chosen.Count -ge $maxVoices) { break }
  $m = $avail | Where-Object { $_.name -like "$w*" } | Select-Object -First 1   # "Sarah - Mature..." 처럼 시작 일치
  if ($m -and -not ($chosen | Where-Object { $_.voice_id -eq $m.voice_id })) { [void]$chosen.Add($m) }
}
foreach ($v in $avail) {                       # 선호 목록으로 부족하면 나머지로 채움
  if ($chosen.Count -ge $maxVoices) { break }
  if (-not ($chosen | Where-Object { $_.voice_id -eq $v.voice_id })) { [void]$chosen.Add($v) }
}
function Slug([string]$n) { ((($n -split '[\s\-]')[0]) -replace '[^a-zA-Z0-9]', '').ToLower() }   # 첫 단어만 (예: sarah)
Write-Host ("사용 보이스: " + (($chosen | ForEach-Object { $_.name }) -join ', '))

# --- 메뉴 영어명 ---
$drinks = [ordered]@{
  espresso='espresso'; americano='americano'; iceAmericano='iced americano';
  latte='latte'; iceLatte='iced latte'; vanillaLatte='vanilla latte';
  cappuccino='cappuccino'; mocha='mocha'; caramelMac='caramel macchiato'
}
$desserts = [ordered]@{ croissant='croissant'; muffin='chocolate muffin'; cake='cheesecake' }
function Art([string]$n) { if ($n -match '^[aeiouAEIOU]') { 'an' } else { 'a' } }

# --- 생성할 라인 목록: 음료 단품 + 음료+디저트 ---
$lines = [System.Collections.ArrayList]::new()
foreach ($d in $drinks.GetEnumerator()) {
  [void]$lines.Add(@{ key = $d.Key; text = "Can I get $(Art $d.Value) $($d.Value), please?" })
  foreach ($s in $desserts.GetEnumerator()) {
    [void]$lines.Add(@{ key = "$($d.Key)__$($s.Key)"; text = "Can I get $(Art $d.Value) $($d.Value) and $(Art $s.Value) $($s.Value), please?" })
  }
}

$total = $chosen.Count * $lines.Count
$made = 0; $skipped = 0; $i = 0
Write-Host "총 $total 개 파일 ($($lines.Count) 문장 x $($chosen.Count) 보이스) 생성 시작..."

$slugs = [System.Collections.ArrayList]::new()
foreach ($voice in $chosen) {
  $slug = Slug $voice.name
  [void]$slugs.Add($slug)
  $dir = Join-Path $root "Audio/voices/$slug"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $uri = "https://api.elevenlabs.io/v1/text-to-speech/$($voice.voice_id)?output_format=mp3_44100_128"
  foreach ($ln in $lines) {
    $i++
    $out = Join-Path $dir "$($ln.key).mp3"
    if (Test-Path $out) { $skipped++; continue }
    $body = @{ text = $ln.text; model_id = $model; voice_settings = $voiceSettings } | ConvertTo-Json -Compress
    try {
      Invoke-RestMethod -Uri $uri -Method Post `
        -Headers @{ 'xi-api-key' = $key; 'Accept' = 'audio/mpeg' } -ContentType 'application/json' `
        -Body $body -OutFile $out
      $made++
      Write-Host ("[{0}/{1}] {2}/{3}.mp3  «{4}»" -f $i, $total, $slug, $ln.key, $ln.text)
    } catch {
      Write-Warning ("실패 {0}/{1}: {2}" -f $slug, $ln.key, $_.Exception.Message)
    }
  }
}

# --- 게임이 읽을 보이스 목록 매니페스트 ---
@{ voices = $slugs } | ConvertTo-Json -Compress | Set-Content -Path (Join-Path $root 'Audio/voices/manifest.json') -Encoding ascii
Write-Host "완료 — 신규 $made, 건너뜀 $skipped, 출력: Audio/voices/ (manifest.json 포함)"
