/* ============================================================
 * latteart.js — 라떼아트 미니게임 (자유 푸어)
 * 우유를 부으며 마우스(피처)를 좌우로 흔들어 패턴을 만든다.
 *   - 포인터 락은 유지한 채 movementX/Y(상대 이동)로 피처를 움직임
 *     (락을 풀면 main.js가 일시정지로 전환되므로 풀지 않는다).
 *   - 표면을 2D 캔버스로 다룬다: 정적 크레마(갈색) 위에 우유(흰색) 레이어를
 *     얹고, 부을 때마다 이동 방향으로 기존 우유를 살짝 끌어(smear) "흘러드는"
 *     착시를 만든다 — 풀 유체 시뮬 없이 자유 푸어의 감성만 흉내.
 *   - 표면이 고정 템포로 좌우로 출렁(슬로시 메트로놈)이고, 그 박자에 맞춰 마우스를
 *     흔들면 공명해 출렁임이 커지며 무늬가 살아난다(가로 스트립 변위로 렌더).
 *   - 채점: 박자 일치도(싱크)를 메인으로, 좌우 대칭 + 적정 양을 보조로.
 * 게임 코어와 독립 — start(opts)로 시작하고, 판정되면 opts.onDone(tier, score) 호출.
 * 전역 LatteArt로 노출.
 * ============================================================ */
const LatteArt = (() => {
  const SIZE = 240;                 // 시뮬/표시 캔버스 한 변(px)
  const CX = SIZE / 2, CY = SIZE / 2, R = 104;   // 컵 중심·반지름
  const { ART_VOL, ART_PERFECT, ART_GOOD, ART_SWAY_F } = DATA;
  // 표면 출렁임(슬로시) — 고정 템포 메트로놈에 마우스를 맞춰 흔들면 공명해 진폭이 커진다.
  const OMEGA = Math.PI * 2 * ART_SWAY_F;
  const BASE_AMP = 3.0;             // 기본 슬로시 진폭(px) — 항상 살짝 출렁여 박자를 보여줌
  const GAIN_AMP = 13;             // 싱크(공명) 시 추가 진폭(px)

  let active = false;
  let onDone = null;                // 판정 콜백(tier, score)
  let disp, dctx;                   // 표시 캔버스(오버레이에 보임)
  let milk, mctx;                   // 우유 레이어(오프스크린, 왜곡 없는 원본 — 채점 기준)
  let surf, sctx;                   // 크레마+우유 합성 버퍼(변위 렌더용)
  let crema;                        // 크레마 텍스처(정적, 시작 시 1회 생성)

  let phase = 0;                    // 슬로시 메트로놈 위상
  let waveAmp = BASE_AMP;           // 현재 출렁임 진폭(싱크에 따라 증가)
  let syncLevel = 0;                // 최근 박자 일치도(0~1) — 진폭/연출에 사용
  let syncSum = 0, syncFrames = 0;  // 붓는 동안 평균 싱크(최종 점수)

  let px, py;                       // 피처(우유 줄기) 위치
  let prevPx, prevPy;               // 직전 프레임 위치 — 리본을 잇는 데 사용
  let vx = 0, vy = 0;               // 부드럽게 보간한 이동 속도(px/프레임)
  let vol = 0;                      // 남은 우유 양(초)
  let elapsed = 0;
  let idleT = 0;                    // 붓기 시작 후 손을 뗀 채 흐른 시간(자동 마감용)
  let pouredOnce = false;
  let pouring = false;
  let patternLabel = '하트';

  // 동작 채점 누적값
  let pourPath = 0;                 // 부으며 이동한 총 거리(너무 가만있으면 감점)

  function makeCanvas() {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    return c;
  }

  // 에스프레소 크레마 텍스처 — 가운데가 짙고 가장자리가 옅은 갈색 + 미세한 얼룩
  function buildCrema() {
    crema = makeCanvas();
    const c = crema.getContext('2d');
    const g = c.createRadialGradient(CX, CY - 8, 10, CX, CY, R);
    g.addColorStop(0, '#6b4324');
    g.addColorStop(0.55, '#8a5a30');
    g.addColorStop(0.85, '#b07a44');
    g.addColorStop(1, '#7a4f2b');
    c.fillStyle = g;
    c.fillRect(0, 0, SIZE, SIZE);
    // 크레마 결 — 옅은 점 얼룩
    for (let i = 0; i < 900; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * R;
      const x = CX + Math.cos(a) * r, y = CY + Math.sin(a) * r;
      c.fillStyle = `rgba(${200 + Math.random() * 40 | 0},${150 + Math.random() * 40 | 0},90,${Math.random() * 0.12})`;
      c.fillRect(x, y, 1.5, 1.5);
    }
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // 우유 줄기가 표면에 닿으며 흰 거품 리본을 흘린다.
  //   직전 피처 위치 → 현재 위치를 따라 부드러운 흰 원을 촘촘히 찍어 끊김 없는 리본을 만든다.
  //   (우유 레이어를 자기 위에 합성하는 피드백 smear는 색 노이즈를 만들어 폐기 — 브러시로 깨끗하게.)
  function deposit() {
    const speed = Math.hypot(px - prevPx, py - prevPy);
    const r = clamp(13 - speed * 0.22, 7, 14);     // 빠를수록 줄기가 가늘어짐
    const dist = speed;
    const steps = Math.max(1, Math.ceil(dist / 3));
    for (let s = 1; s <= steps; s++) {
      const tt = s / steps;
      const x = prevPx + (px - prevPx) * tt;
      const y = prevPy + (py - prevPy) * tt;
      const g = mctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(248,242,229,0.85)');
      g.addColorStop(0.7, 'rgba(246,239,224,0.5)');
      g.addColorStop(1, 'rgba(246,239,224,0)');
      mctx.fillStyle = g;
      mctx.beginPath();
      mctx.arc(x, y, r, 0, Math.PI * 2);
      mctx.fill();
    }
  }

  // 표면의 수평 변위(px) — 위(뒤)로 갈수록 슬로시가 크고, 진행파 잔물결을 더한다.
  function waveOffset(y) {
    const depth = clamp((CY + R - y) / (2 * R), 0, 1);     // 아래=0, 위=1
    const slosh = Math.sin(phase) * waveAmp * (0.35 + depth * 0.95);
    const ripple = Math.sin(y * 0.17 - phase * 1.7) * waveAmp * 0.4;
    return slosh + ripple;
  }

  function render() {
    // 1) 크레마+우유를 합성 버퍼에 그림. 크레마는 캔버스를 꽉 채워(원형 클립 X) 두어야
    //    스트립 변위로 가장자리가 밀려도 빈틈 없이 크레마가 받쳐준다(원형은 표시 단계에서 클립).
    sctx.clearRect(0, 0, SIZE, SIZE);
    sctx.drawImage(crema, 0, 0);
    sctx.drawImage(milk, 0, 0);

    // 2) 가로 스트립마다 수평 변위를 줘 표면이 좌우로 출렁이게 블릿
    dctx.clearRect(0, 0, SIZE, SIZE);
    dctx.save();
    dctx.beginPath();
    dctx.arc(CX, CY, R, 0, Math.PI * 2);
    dctx.clip();
    const STRIP = 3;
    for (let y = 0; y < SIZE; y += STRIP) {
      const off = waveOffset(y + STRIP / 2);
      dctx.drawImage(surf, 0, y, SIZE, STRIP, off, y, SIZE, STRIP);
    }
    // 표면에 흐르는 빛 띠(스펙큘러) — 출렁임에 따라 위아래로 쓸려 액체 윤기를 줌
    const hy = CY + Math.sin(phase + 0.6) * (R * 0.55);
    const sg = dctx.createLinearGradient(0, hy - 26, 0, hy + 26);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.5, `rgba(255,255,255,${0.05 + syncLevel * 0.07})`);
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    dctx.fillStyle = sg;
    dctx.fillRect(0, hy - 26, SIZE, 52);
    dctx.restore();

    // 컵 테두리
    dctx.lineWidth = 9;
    dctx.strokeStyle = '#efe6d2';
    dctx.beginPath();
    dctx.arc(CX, CY, R + 1, 0, Math.PI * 2);
    dctx.stroke();
    dctx.lineWidth = 2;
    dctx.strokeStyle = 'rgba(120,80,45,0.5)';
    dctx.beginPath();
    dctx.arc(CX, CY, R - 4, 0, Math.PI * 2);
    dctx.stroke();
    // 피처 줄기 + 위치 표시 (붓는 동안)
    if (pouring) {
      dctx.strokeStyle = 'rgba(247,241,227,0.85)';
      dctx.lineWidth = clamp(7 - Math.hypot(vx, vy) * 0.3, 3, 7);
      dctx.beginPath();
      dctx.moveTo(px, -6);
      dctx.lineTo(px, py);
      dctx.stroke();
    }
    dctx.fillStyle = pouring ? '#fff' : 'rgba(255,255,255,0.55)';
    dctx.beginPath();
    dctx.arc(px, py, 4, 0, Math.PI * 2);
    dctx.fill();
    // 박자 큐 — 컵 위 작은 추가 좌우로 흔들림(메트로놈). 마우스를 이 추에 맞춰 흔든다.
    const cueX = CX + Math.sin(phase) * 26;
    dctx.fillStyle = syncLevel > 0.5 ? '#7fd08a' : 'rgba(232,184,109,0.9)';
    dctx.beginPath();
    dctx.arc(cueX, 8, 5, 0, Math.PI * 2);
    dctx.fill();
    // 남은 우유 양 링
    const frac = vol / ART_VOL;
    dctx.lineWidth = 4;
    dctx.strokeStyle = frac > 0.25 ? 'rgba(232,184,109,0.9)' : 'rgba(214,92,92,0.95)';
    dctx.beginPath();
    dctx.arc(CX, CY, R + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    dctx.stroke();
  }

  // 상대 마우스 이동 → 피처 이동 + 흔들기(진동) 집계
  function onMove(dx, dy) {
    if (!active) return;
    const k = 0.42;                 // 마우스 감도
    px = clamp(px + dx * k, 18, SIZE - 18);
    py = clamp(py + dy * k, 18, SIZE - 18);
    // 속도 보간(부드러운 줄기/스미어용)
    vx = vx * 0.6 + dx * k * 0.4;
    vy = vy * 0.6 + dy * k * 0.4;
    if (!pouring) return;
    pourPath += Math.hypot(dx, dy) * k;   // 움직임 총량(가만히 부으면 보너스 차단용)
  }

  // 우유 양(흰 픽셀) 비율 — 적정 범위(0.3~0.62)에서 만점
  function coverageScore() {
    const data = mctx.getImageData(0, 0, SIZE, SIZE).data;
    let filled = 0, total = 0;
    for (let y = 0; y < SIZE; y += 3) {
      for (let x = 0; x < SIZE; x += 3) {
        if (Math.hypot(x - CX, y - CY) > R) continue;
        total++;
        if (data[(y * SIZE + x) * 4 + 3] > 60) filled++;
      }
    }
    const cov = total ? filled / total : 0;
    if (cov < 0.12) return 0;
    if (cov < 0.3) return cov / 0.3;
    if (cov <= 0.62) return 1;
    return Math.max(0, 1 - (cov - 0.62) / 0.3);
  }

  // 좌우 대칭도 — 하트·로제타·튤립은 모두 좌우 대칭이라 잘 부었을수록 높다
  function symmetryScore() {
    const data = mctx.getImageData(0, 0, SIZE, SIZE).data;
    let match = 0, count = 0;
    for (let y = 0; y < SIZE; y += 3) {
      for (let x = 0; x < CX; x += 3) {
        if (Math.hypot(x - CX, y - CY) > R) continue;
        const a = data[(y * SIZE + x) * 4 + 3] > 60 ? 1 : 0;
        const mx = SIZE - 1 - x;
        const b = data[(y * SIZE + mx) * 4 + 3] > 60 ? 1 : 0;
        if (a || b) { count++; if (a === b) match++; }
      }
    }
    return count ? match / count : 0;
  }

  function start(opts) {
    onDone = opts && opts.onDone || null;
    patternLabel = (opts && opts.pattern) || '하트';
    if (!disp) {
      disp = $('artCanvas');
      dctx = disp.getContext('2d');
      milk = makeCanvas();
      mctx = milk.getContext('2d');
      surf = makeCanvas();
      sctx = surf.getContext('2d');
    }
    if (!crema) buildCrema();
    mctx.clearRect(0, 0, SIZE, SIZE);
    px = CX; py = CY + R * 0.45;          // 컵 아래쪽에서 시작(앞에서 뒤로 흔들며 빼기)
    prevPx = px; prevPy = py;
    vx = vy = 0; vol = ART_VOL; elapsed = 0; idleT = 0; pouredOnce = false;
    pourPath = 0;
    phase = Math.random() * Math.PI * 2; waveAmp = BASE_AMP;
    syncLevel = 0; syncSum = 0; syncFrames = 0;
    pouring = false;
    active = true;
    Player.setLook(false);                // 마우스를 피처 조작에 양보
    const t = $('artTitle'), h = $('artHint');
    if (t) t.innerHTML = `🎨 라떼아트 — <b>${patternLabel}</b>에 도전!`;
    if (h) h.innerHTML = '<b>[E]/좌클릭</b>을 누른 채 — 위 <b>초록 점(박자)</b>에 맞춰 마우스를 <b>좌우로 흔들면</b> 표면이 출렁이며 무늬가 살아나요';
    $('artGame').classList.remove('hidden');
    render();
  }

  // 게임 루프에서 매 프레임 호출. pourBtn = [E]/좌클릭을 누르고 있는지.
  function update(dt, pourBtn) {
    if (!active) return false;
    Player.setLook(false);                // 매 프레임 재확인(상태 꼬임 방지)
    elapsed += dt;
    phase += OMEGA * dt;                   // 슬로시 메트로놈 진행
    pouring = !!pourBtn && vol > 0;
    if (pouring) {
      pouredOnce = true; idleT = 0;
      vol = Math.max(0, vol - dt);
      deposit();
      if (Math.random() < dt * 6) AudioFX.pourWater(0.25);
      // 박자 일치도 = 상관(마우스 수평속도 × 파동속도). 동상이면 +, 다른 템포면 ≈0(직교), 역상이면 −.
      // 순간 부호일치가 아니라 상관을 누적해야 "엉뚱한 템포"가 정박처럼 점수를 먹지 않는다.
      const waveVel = Math.cos(phase);
      const corr = clamp(vx / 3.2, -1, 1) * waveVel;
      syncSum += corr; syncFrames++;
      const target = clamp(corr * 1.6, 0, 1);   // 시각 진폭: 양의 상관일 때만 키움
      syncLevel = clamp(syncLevel + (target - syncLevel) * Math.min(1, dt * 3.5), 0, 1);
    } else if (pouredOnce) {
      idleT += dt;               // 붓다가 손을 떼고 가만히 있으면 곧 마감
      syncLevel = clamp(syncLevel - dt * 1.2, 0, 1);
    }
    waveAmp = BASE_AMP + syncLevel * GAIN_AMP;   // 싱크가 오를수록 출렁임이 커짐(공명)
    prevPx = px; prevPy = py;    // 다음 프레임 리본의 시작점
    // 속도 감쇠(마우스가 멈추면 줄기도 가늘어짐)
    vx *= 0.85; vy *= 0.85;
    render();
    // 우유를 다 부었거나 · 다 붓고 멈춘 채 1.6초 · 또는 너무 오래 끌면 자동 판정
    if (vol <= 0 || idleT > 1.6 || elapsed > 14) finish();
    return true;
  }

  function finish() {
    if (!active) return;
    active = false;
    Player.setLook(true);
    const cov = coverageScore();
    const sym = symmetryScore();
    const sync = syncFrames ? clamp((syncSum / syncFrames) / 0.4, 0, 1) : 0;  // 평균 상관 → 0~1
    const moved = pourPath > 60 ? 1 : pourPath / 60;   // 거의 안 움직이면 감점
    // 박자(싱크)를 메인 지표로, 대칭·양을 보조로. 가만히 부으면(움직임 부족) 전체를 깎아 보너스 차단.
    const score = clamp((sync * 0.6 + sym * 0.25 + cov * 0.15) * (0.5 + 0.5 * moved), 0, 1);
    const tier = score >= ART_PERFECT ? 'perfect' : score >= ART_GOOD ? 'good' : 'plain';
    $('artGame').classList.add('hidden');
    const cb = onDone; onDone = null;
    if (cb) cb(tier, score);
  }

  // 시선을 돌리는 등 외부 사유로 중단 — 부은 만큼 평범(plain)으로 마감
  function cancel() {
    if (!active) return;
    finish();
  }

  function init() {
    document.addEventListener('mousemove', ev => {
      if (!active || document.pointerLockElement === null) return;
      onMove(ev.movementX, ev.movementY);
    });
  }

  return { init, start, update, cancel, get active() { return active; } };
})();
