/* ============================================================
 * latteart.js — 라떼아트 미니게임 (자유 푸어 · 유체 어드벡션)
 * 우유를 부으며 마우스(피처)를 "위로 밀며 좌우로 흔들어" 무늬를 그린다.
 *   - 포인터 락은 유지한 채 movementX/Y(상대 이동)로 피처를 움직임
 *     (락을 풀면 main.js가 일시정지로 전환되므로 풀지 않는다).
 *   - 실제 라떼아트 물리를 흉내: 피처 움직임이 표면에 "흐름(속도장)"을 만들고,
 *     흰 우유(밀도장)가 그 흐름에 끌려(어드벡션) 잎으로 번진다. 외부 박자 없음 —
 *     흐름·물결을 내가 직접 만든다. (작은 CPU 그리드, WebGL 불필요)
 *     · 좌우로 흔들면 측면 흐름 → 잎의 좌우 결
 *     · 위로 밀며 빼면 잎이 뒤로 쌓이고, 마지막에 가운데로 곧게 빼면 줄기(컷스루)
 *   - 채점: 흔들기의 일관성(펜듈럼) + 위로 빼기 + 좌우 대칭 + 적정 양.
 * 게임 코어와 독립 — start(opts)로 시작하고, 판정되면 opts.onDone(tier, score) 호출.
 * 전역 LatteArt로 노출.
 * ============================================================ */
const LatteArt = (() => {
  const SIZE = 240;                 // 표시 캔버스 한 변(px)
  const CX = SIZE / 2, CY = SIZE / 2, R = 104;   // 컵 중심·반지름(px)
  const { ART_VOL, ART_PERFECT, ART_GOOD } = DATA;

  // 유체 그리드 (컵 표면을 N×N으로 다룸)
  const N = 84;
  const CELL = SIZE / N;            // 셀당 px
  const GC = N / 2;                 // 그리드 중심
  const RG = R / CELL;              // 그리드 반지름
  const u = new Float32Array(N * N), v = new Float32Array(N * N);   // 속도장(셀/초)
  const m = new Float32Array(N * N), m2 = new Float32Array(N * N);  // 우유 밀도
  const inside = new Uint8Array(N * N);                             // 컵 안 마스크
  const rowU = new Float32Array(N);                                // 행별 평균 수평속도(표면 변위용)
  (function buildMask() {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
      inside[y * N + x] = Math.hypot(x - GC, y - GC) <= RG ? 1 : 0;
  })();

  // 튜닝값
  const MILK_RATE = 78;            // 초당 우유 주입량
  const FOUNTAIN = 16;             // 닿는 지점 바깥 분수 흐름 세기(셀/초/프레임환산)
  const VEL_FROM_MOVE = 0.95;      // 피처 이동 → 흐름 전달
  const VEL_DAMP = 0.955;          // 프레임당 속도 감쇠(60fps 기준)
  const MILK_DECAY = 0.997;        // 프레임당 우유 감쇠
  const DISP = 5;                  // 표면 수평 변위(물결) 스케일

  let active = false;
  let onDone = null;
  let disp, dctx;                   // 표시 캔버스
  let surf, sctx;                   // 크레마+우유 합성 버퍼(변위 전)
  let mcv, mctx, mImg;              // 우유 그리드 → 픽셀 오버레이(N×N)
  let crema;                        // 크레마 텍스처(정적)

  let px, py, prevPx, prevPy;       // 피처 위치(px)
  let vol = 0, elapsed = 0, idleT = 0, pouredOnce = false, pouring = false;
  let patternLabel = '하트';

  // 채점 누적
  let osc = 0, lastSign = 0, runDist = 0;   // 좌우 흔들기 횟수/일관성
  let pourPath = 0;                          // 총 이동량
  let startY = 0, minY = 0;                  // 위로 빼기 진행도

  function clamp(a, lo, hi) { return a < lo ? lo : a > hi ? hi : a; }
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // 에스프레소 크레마 텍스처 — 가운데가 짙고 가장자리가 옅은 갈색 + 미세한 얼룩
  function buildCrema() {
    crema = makeCanvas(SIZE, SIZE);
    const c = crema.getContext('2d');
    const g = c.createRadialGradient(CX, CY - 8, 10, CX, CY, R);
    g.addColorStop(0, '#6b4324');
    g.addColorStop(0.55, '#8a5a30');
    g.addColorStop(0.85, '#b07a44');
    g.addColorStop(1, '#7a4f2b');
    c.fillStyle = g;
    c.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 900; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * R;
      const x = CX + Math.cos(a) * r, y = CY + Math.sin(a) * r;
      c.fillStyle = `rgba(${200 + Math.random() * 40 | 0},${150 + Math.random() * 40 | 0},90,${Math.random() * 0.12})`;
      c.fillRect(x, y, 1.5, 1.5);
    }
  }

  // 가우시안 스플랫: 밀도장에 주입
  function splatM(gx, gy, rad, amt) {
    const r = Math.ceil(rad), r2 = rad * rad;
    for (let y = Math.max(0, gy - r | 0); y <= Math.min(N - 1, gy + r | 0); y++)
      for (let x = Math.max(0, gx - r | 0); x <= Math.min(N - 1, gx + r | 0); x++) {
        const i = y * N + x; if (!inside[i]) continue;
        m[i] += amt * Math.exp(-((x - gx) ** 2 + (y - gy) ** 2) / r2);
      }
  }
  // 속도장 주입: 피처 이동 방향 + 닿는 지점 바깥 분수
  function splatVel(gx, gy, rad, vxg, vyg, fountain) {
    const r = Math.ceil(rad), r2 = rad * rad;
    for (let y = Math.max(0, gy - r | 0); y <= Math.min(N - 1, gy + r | 0); y++)
      for (let x = Math.max(0, gx - r | 0); x <= Math.min(N - 1, gx + r | 0); x++) {
        const i = y * N + x; if (!inside[i]) continue;
        const w = Math.exp(-((x - gx) ** 2 + (y - gy) ** 2) / r2);
        u[i] += vxg * w; v[i] += vyg * w;
        if (fountain) {
          const ddx = x - gx, ddy = y - gy, dd = Math.hypot(ddx, ddy) + 1e-3;
          u[i] += ddx / dd * fountain * w; v[i] += ddy / dd * fountain * w;
        }
      }
  }

  // 한 스텝 시뮬: 어드벡션(밀도) + 감쇠
  function step(dt) {
    const fr = dt * 60;                       // 60fps 기준 프레임 환산
    // 우유 어드벡션 (semi-Lagrangian backtrace, bilinear)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (!inside[i]) { m2[i] = 0; continue; }
      let sx = x - u[i] * dt, sy = y - v[i] * dt;
      sx = sx < 0 ? 0 : sx > N - 1.001 ? N - 1.001 : sx;
      sy = sy < 0 ? 0 : sy > N - 1.001 ? N - 1.001 : sy;
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0, j = y0 * N + x0;
      const val = m[j] * (1 - fx) * (1 - fy) + m[j + 1] * fx * (1 - fy)
        + m[j + N] * (1 - fx) * fy + m[j + N + 1] * fx * fy;
      m2[i] = val * Math.pow(MILK_DECAY, fr);
    }
    m.set(m2);
    // 속도 감쇠 + 경계, 행별 평균 수평속도(표면 변위)
    const vd = Math.pow(VEL_DAMP, fr);
    for (let y = 0; y < N; y++) {
      let su = 0, cnt = 0;
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        if (!inside[i]) { u[i] = v[i] = 0; continue; }
        u[i] *= vd; v[i] *= vd;
        if (m[i] > 1.4) m[i] = 1.4;
        su += u[i]; cnt++;
      }
      rowU[y] = cnt ? su / cnt : 0;
    }
    // 행 변위 스무딩 — 인접 행 속도차로 표면이 찢어져 보이는 것을 완화(부드러운 물결)
    let prev = rowU[0];
    for (let y = 1; y < N - 1; y++) {
      const cur = rowU[y];
      rowU[y] = prev * 0.25 + cur * 0.5 + rowU[y + 1] * 0.25;
      prev = cur;
    }
  }

  function render() {
    // 1) 우유 그리드 → N×N 오버레이(흰색, 알파=밀도)
    const d = mImg.data;
    for (let i = 0; i < N * N; i++) {
      const a = inside[i] ? clamp(Math.sqrt(m[i]) * 1.05, 0, 1) : 0;
      const p = i * 4;
      d[p] = 247; d[p + 1] = 241; d[p + 2] = 228; d[p + 3] = (a * 255) | 0;
    }
    mctx.putImageData(mImg, 0, 0);
    // 2) 크레마 + 우유 합성
    sctx.clearRect(0, 0, SIZE, SIZE);
    sctx.drawImage(crema, 0, 0);
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(mcv, 0, 0, N, N, 0, 0, SIZE, SIZE);
    // 3) 행별 수평 변위로 표면이 흐름 따라 출렁이게 블릿(물결)
    dctx.clearRect(0, 0, SIZE, SIZE);
    dctx.save();
    dctx.beginPath();
    dctx.arc(CX, CY, R, 0, Math.PI * 2);
    dctx.clip();
    const STRIP = 3;
    for (let y = 0; y < SIZE; y += STRIP) {
      const gy = clamp((y / CELL) | 0, 0, N - 1);
      const off = clamp(rowU[gy] * DISP, -10, 10);
      dctx.drawImage(surf, 0, y, SIZE, STRIP, off, y, SIZE, STRIP);
    }
    dctx.restore();
    // 컵 테두리
    dctx.lineWidth = 9; dctx.strokeStyle = '#efe6d2';
    dctx.beginPath(); dctx.arc(CX, CY, R + 1, 0, Math.PI * 2); dctx.stroke();
    dctx.lineWidth = 2; dctx.strokeStyle = 'rgba(120,80,45,0.5)';
    dctx.beginPath(); dctx.arc(CX, CY, R - 4, 0, Math.PI * 2); dctx.stroke();
    // 피처 줄기 + 위치
    if (pouring) {
      dctx.strokeStyle = 'rgba(247,241,227,0.9)';
      dctx.lineWidth = 5;
      dctx.beginPath(); dctx.moveTo(px, -6); dctx.lineTo(px, py); dctx.stroke();
    }
    dctx.fillStyle = pouring ? '#fff' : 'rgba(255,255,255,0.5)';
    dctx.beginPath(); dctx.arc(px, py, 4, 0, Math.PI * 2); dctx.fill();
    // 남은 우유 양 링
    const frac = vol / ART_VOL;
    dctx.lineWidth = 4;
    dctx.strokeStyle = frac > 0.25 ? 'rgba(232,184,109,0.9)' : 'rgba(214,92,92,0.95)';
    dctx.beginPath();
    dctx.arc(CX, CY, R + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    dctx.stroke();
  }

  // 상대 마우스 이동 → 피처 이동 + 흔들기/이동 집계
  function onMove(dx, dy) {
    if (!active) return;
    const k = 0.42;
    px = clamp(px + dx * k, CX - R + 6, CX + R - 6);
    py = clamp(py + dy * k, CY - R + 6, CY + R + 4);
    if (!pouring) return;
    pourPath += Math.hypot(dx, dy) * k;
    if (py < minY) minY = py;
    // 좌우 흔들기 집계 — 일정 거리 이어진 방향이 뒤집힐 때마다 1회
    const sign = dx > 0.6 ? 1 : dx < -0.6 ? -1 : 0;
    if (sign !== 0) {
      if (lastSign !== 0 && sign !== lastSign && runDist > 8) { osc++; runDist = 0; }
      runDist = (sign === lastSign ? runDist : 0) + Math.abs(dx) * k;
      lastSign = sign;
    }
  }

  function start(opts) {
    onDone = opts && opts.onDone || null;
    patternLabel = (opts && opts.pattern) || '하트';
    if (!disp) {
      disp = $('artCanvas'); dctx = disp.getContext('2d');
      surf = makeCanvas(SIZE, SIZE); sctx = surf.getContext('2d');
      mcv = makeCanvas(N, N); mctx = mcv.getContext('2d');
      mImg = mctx.createImageData(N, N);
    }
    if (!crema) buildCrema();
    u.fill(0); v.fill(0); m.fill(0); rowU.fill(0);
    px = CX; py = CY + R * 0.52;           // 컵 아래쪽(앞)에서 시작 → 위로 밀며 흔든다
    prevPx = px; prevPy = py; startY = py; minY = py;
    vol = ART_VOL; elapsed = 0; idleT = 0; pouredOnce = false; pouring = false;
    osc = 0; lastSign = 0; runDist = 0; pourPath = 0;
    active = true;
    Player.setLook(false);
    const t = $('artTitle'), h = $('artHint');
    if (t) t.innerHTML = `🎨 라떼아트 — <b>${patternLabel}</b>에 도전!`;
    if (h) h.innerHTML = '<b>[E]/좌클릭</b>을 누른 채 마우스를 <b>위로 밀며 좌우로 흔들면</b> 흐름이 생겨 무늬가 번져요 · 마지막에 가운데로 곧게 빼면 줄기';
    $('artGame').classList.remove('hidden');
    render();
  }

  // 게임 루프에서 매 프레임 호출. pourBtn = [E]/좌클릭 누름.
  function update(dt, pourBtn) {
    if (!active) return false;
    Player.setLook(false);
    elapsed += dt;
    pouring = !!pourBtn && vol > 0;
    if (pouring) {
      pouredOnce = true; idleT = 0;
      vol = Math.max(0, vol - dt);
      // 피처 속도(셀/초) → 흐름 주입 + 우유 주입
      const gx = clamp(px / CELL, 1, N - 2), gy = clamp(py / CELL, 1, N - 2);
      const vxg = (px - prevPx) / CELL / dt, vyg = (py - prevPy) / CELL / dt;
      const fr = dt * 60;
      splatVel(gx, gy, 3.2, vxg * VEL_FROM_MOVE, vyg * VEL_FROM_MOVE, FOUNTAIN * fr);
      splatM(gx, gy, 2.4, MILK_RATE * dt);
      if (Math.random() < dt * 6) AudioFX.pourWater(0.25);
    } else if (pouredOnce) {
      idleT += dt;
    }
    prevPx = px; prevPy = py;
    step(dt);
    render();
    if (vol <= 0 || idleT > 1.6 || elapsed > 14) finish();
    return true;
  }

  // 좌우 대칭도 — 컵 안에서 좌/우 미러 일치율
  function symmetryScore() {
    let match = 0, count = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < GC; x++) {
      const i = y * N + x; if (!inside[i]) continue;
      const a = m[i] > 0.12 ? 1 : 0;
      const b = m[y * N + (N - 1 - x)] > 0.12 ? 1 : 0;
      if (a || b) { count++; if (a === b) match++; }
    }
    return count ? match / count : 0;
  }
  // 우유 양(컵 면적 대비) — 적정 범위에서 만점
  function coverageScore() {
    let filled = 0, total = 0;
    for (let i = 0; i < N * N; i++) {
      if (!inside[i]) continue; total++;
      if (m[i] > 0.12) filled++;
    }
    const cov = total ? filled / total : 0;
    if (cov < 0.1) return 0;
    if (cov < 0.28) return cov / 0.28;
    if (cov <= 0.66) return 1;
    return Math.max(0, 1 - (cov - 0.66) / 0.3);
  }

  function finish() {
    if (!active) return;
    active = false;
    Player.setLook(true);
    const wig = Math.min(1, osc / 7);                       // 흔들기 일관성
    const up = clamp((startY - minY) / (R * 0.7), 0, 1);    // 위로 빼기 진행도
    const sym = symmetryScore();
    const cov = coverageScore();
    const moved = pourPath > 60 ? 1 : pourPath / 60;
    // 흔들기 메인 + 위로빼기·대칭·양 보조. 가만히 부으면 전체 감점.
    const score = clamp((wig * 0.4 + up * 0.18 + sym * 0.27 + cov * 0.15) * (0.5 + 0.5 * moved), 0, 1);
    const tier = score >= ART_PERFECT ? 'perfect' : score >= ART_GOOD ? 'good' : 'plain';
    $('artGame').classList.add('hidden');
    const cb = onDone; onDone = null;
    if (cb) cb(tier, score);
  }

  function cancel() { if (active) finish(); }

  function init() {
    document.addEventListener('mousemove', ev => {
      if (!active || document.pointerLockElement === null) return;
      onMove(ev.movementX, ev.movementY);
    });
  }

  return { init, start, update, cancel, get active() { return active; } };
})();
