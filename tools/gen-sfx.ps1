# gen-sfx.ps1 — 게임 효과음을 ElevenLabs Sound Effects로 생성
#   키: .tts-key 또는 $env:ELEVENLABS_API_KEY
#   출력: Audio/sfx/<key>.mp3 + Audio/sfx/manifest.json (이미 있으면 건너뜀)
#   실행: powershell -ExecutionPolicy Bypass -File tools/gen-sfx.ps1

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $PSScriptRoot

$key = $env:ELEVENLABS_API_KEY
if (-not $key) { $kf = Join-Path $root '.tts-key'; if (Test-Path $kf) { $key = (Get-Content $kf -Raw).Trim() } }
if (-not $key) { Write-Error "ElevenLabs API 키가 없습니다."; exit 1 }

# key, prompt, duration(초). 지속형(루프)은 길게 뽑아 게임에서 반복 재생.
$sounds = @(
  @{ k='grind';      d=6;   p='loud electric burr coffee grinder grinding whole beans, motor whirring, continuous, close up' }
  @{ k='pourWater';  d=5;   p='steady stream of water pouring into a cup, continuous, close up' }
  @{ k='steam';      d=6;   p='espresso machine steam wand frothing milk, loud hissing steam, continuous' }
  @{ k='brewing';    d=6;   p='espresso machine pulling a shot, pump humming, espresso streaming into a cup, continuous' }
  @{ k='cupClink';   d=1;   p='ceramic coffee mug set down on a counter, light clink' }
  @{ k='ice';        d=1.5; p='ice cubes dropping into an empty glass' }
  @{ k='syrupPump';  d=1;   p='pump bottle dispensing syrup, single squirt' }
  @{ k='whipSpray';  d=1;   p='whipped cream aerosol can spraying a short burst' }
  @{ k='trashThud';  d=1.5; p='dumping wet coffee grounds into a trash bin, soft thud' }
  @{ k='metalClack'; d=1;   p='metal portafilter locking into espresso group head, solid metallic click' }
  @{ k='knock';      d=1.5; p='banging a portafilter on a knock box twice to remove the coffee puck' }
  @{ k='tampDone';   d=1;   p='coffee tamper pressing and compressing grounds, firm single thud' }
  @{ k='serveSuccess'; d=2; p='cheerful short success chime, order served, pleasant' }
  @{ k='tampPerfectSfx'; d=1.5; p='sparkling magical success chime, perfect ding' }
  @{ k='ding';       d=1;   p='small bright service counter bell ding' }
  @{ k='cash';       d=1.5; p='cash register cha-ching with coins' }
  @{ k='err';        d=1;   p='short negative error buzzer beep' }
  @{ k='pick';       d=0.5; p='quick soft pop, picking up an item' }
  @{ k='put';        d=0.5; p='quick soft tap, setting down an item' }
  @{ k='levelup';    d=2.5; p='uplifting level up success jingle, positive' }
  @{ k='bell';       d=1.5; p='bright single bell ring notification' }
)

$dir = Join-Path $root 'Audio/sfx'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$keys = [System.Collections.ArrayList]::new()
$made = 0; $skip = 0; $i = 0
Write-Host "효과음 $($sounds.Count)개 생성 시작..."
foreach ($s in $sounds) {
  $i++
  $out = Join-Path $dir "$($s.k).mp3"
  [void]$keys.Add($s.k)
  if (Test-Path $out) { $skip++; continue }
  $body = @{ text = $s.p; duration_seconds = $s.d; prompt_influence = 0.5 } | ConvertTo-Json -Compress
  try {
    Invoke-RestMethod -Uri 'https://api.elevenlabs.io/v1/sound-generation' -Method Post `
      -Headers @{ 'xi-api-key' = $key; 'Accept' = 'audio/mpeg' } -ContentType 'application/json' `
      -Body $body -OutFile $out
    $made++
    Write-Host ("[{0}/{1}] {2}.mp3  «{3}»" -f $i, $sounds.Count, $s.k, $s.p)
  } catch { Write-Warning ("실패 {0}: {1}" -f $s.k, $_.Exception.Message) }
}
@{ keys = $keys } | ConvertTo-Json -Compress | Set-Content -Path (Join-Path $dir 'manifest.json') -Encoding ascii
Write-Host "완료 — 신규 $made, 건너뜀 $skip, 출력: Audio/sfx/"
