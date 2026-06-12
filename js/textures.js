/* ============================================================
 * textures.js — 프로시저럴 캔버스 텍스처 & 머티리얼 팩토리
 * ============================================================ */
const TEX = (() => {

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return [c, c.getContext('2d')];
  }

  function toTexture(c, repeatX = 1, repeatY = 1, srgb = true) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  // 시드 고정 의사난수 (텍스처 재현성)
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ---------- 원목 마루 바닥 ---------- */
  function woodFloor() {
    const [c, x] = canvas(1024, 1024);
    const r = rng(7);
    const plankH = 1024 / 8;
    for (let row = 0; row < 8; row++) {
      const off = (row % 2) * 256;
      for (let col = -1; col < 4; col++) {
        const px = col * 341 + off, py = row * plankH;
        const base = 88 + r() * 36;
        const g = x.createLinearGradient(px, py, px + 341, py);
        g.addColorStop(0, `rgb(${base + 32},${base * 0.72 + 14},${base * 0.46})`);
        g.addColorStop(0.5, `rgb(${base + 44},${base * 0.74 + 20},${base * 0.5 + 4})`);
        g.addColorStop(1, `rgb(${base + 28},${base * 0.7 + 12},${base * 0.44})`);
        x.fillStyle = g;
        x.fillRect(px, py, 341, plankH);
        // 나뭇결
        x.globalAlpha = 0.18;
        for (let i = 0; i < 22; i++) {
          x.strokeStyle = r() > 0.5 ? '#3a2715' : '#7a5a38';
          x.lineWidth = 0.6 + r() * 1.6;
          x.beginPath();
          const wy = py + r() * plankH;
          x.moveTo(px, wy);
          x.bezierCurveTo(px + 100, wy + (r() - 0.5) * 9, px + 220, wy + (r() - 0.5) * 9, px + 341, wy + (r() - 0.5) * 5);
          x.stroke();
        }
        // 옹이
        if (r() > 0.6) {
          const kx = px + 40 + r() * 260, ky = py + 16 + r() * (plankH - 32);
          x.fillStyle = '#2e1d0e';
          x.beginPath(); x.ellipse(kx, ky, 5 + r() * 6, 3 + r() * 4, r() * 3, 0, 7); x.fill();
        }
        x.globalAlpha = 1;
        // 판자 경계
        x.strokeStyle = 'rgba(20,12,5,.65)'; x.lineWidth = 3;
        x.strokeRect(px + 1, py + 1, 341 - 2, plankH - 2);
      }
    }
    return c;
  }

  /* ---------- 대리석 ---------- */
  function marble(tint = '#ece7df') {
    const [c, x] = canvas(512, 512);
    const r = rng(21);
    x.fillStyle = tint; x.fillRect(0, 0, 512, 512);
    const g = x.createRadialGradient(160, 140, 30, 256, 256, 420);
    g.addColorStop(0, 'rgba(255,255,255,.5)');
    g.addColorStop(1, 'rgba(190,184,172,.35)');
    x.fillStyle = g; x.fillRect(0, 0, 512, 512);
    // 결(veins)
    for (let i = 0; i < 14; i++) {
      x.strokeStyle = `rgba(${120 + r() * 60},${118 + r() * 55},${112 + r() * 50},${0.16 + r() * 0.22})`;
      x.lineWidth = 0.7 + r() * 2.2;
      x.beginPath();
      let vx = r() * 512, vy = 0;
      x.moveTo(vx, vy);
      while (vy < 512) {
        vy += 14 + r() * 34;
        vx += (r() - 0.5) * 90;
        x.lineTo(vx, vy);
      }
      x.stroke();
    }
    return c;
  }

  /* ---------- 벽돌 ---------- */
  function brick() {
    const [c, x] = canvas(512, 512);
    const r = rng(33);
    x.fillStyle = '#cbb9a4'; x.fillRect(0, 0, 512, 512); // 줄눈(모르타르)
    const bh = 512 / 10, bw = 512 / 4;
    for (let row = 0; row < 10; row++) {
      const off = (row % 2) * bw * 0.5;
      for (let col = -1; col < 5; col++) {
        const bx = col * bw + off + 3, by = row * bh + 3;
        const v = r();
        const cr = 142 + v * 40, cg = 74 + v * 26, cb = 56 + v * 20;
        x.fillStyle = `rgb(${cr | 0},${cg | 0},${cb | 0})`;
        x.fillRect(bx, by, bw - 6, bh - 6);
        x.globalAlpha = 0.25;
        for (let i = 0; i < 12; i++) {
          x.fillStyle = r() > 0.5 ? '#5e3326' : '#b07a5e';
          x.fillRect(bx + r() * (bw - 10), by + r() * (bh - 10), 2 + r() * 5, 1 + r() * 3);
        }
        x.globalAlpha = 1;
      }
    }
    return c;
  }

  /* ---------- 회벽(상부 벽) ---------- */
  function plaster() {
    const [c, x] = canvas(256, 256);
    const r = rng(55);
    x.fillStyle = '#e9ddc8'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      x.fillStyle = r() > 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(120,100,70,.05)';
      x.fillRect(r() * 256, r() * 256, 1.5, 1.5);
    }
    return c;
  }

  /* ---------- 칠판 메뉴보드 ---------- */
  function menuBoard() {
    const [c, x] = canvas(1024, 640);
    x.fillStyle = '#23291f'; x.fillRect(0, 0, 1024, 640);
    const r = rng(99);
    for (let i = 0; i < 1800; i++) { // 분필 얼룩
      x.fillStyle = 'rgba(255,255,255,.022)';
      x.fillRect(r() * 1024, r() * 640, 2.5, 2.5);
    }
    x.textAlign = 'center';
    x.fillStyle = '#f0e6c8';
    x.font = '700 64px Georgia,"Malgun Gothic"';
    x.fillText('MOCHA STREET', 512, 88);
    x.strokeStyle = '#d99a4e'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(220, 116); x.lineTo(804, 116); x.stroke();
    x.font = '400 30px "Malgun Gothic"';
    x.fillStyle = '#e6dcc0';
    const L = [
      ['에스프레소', '2,500'], ['아메리카노', '3,000'], ['아이스 아메리카노', '3,500'],
      ['카페라떼', '4,000'], ['바닐라 라떼', '4,800'], ['카푸치노', '4,500'],
      ['카페모카', '5,000'], ['카라멜 마끼아또', '5,300']
    ];
    L.forEach(([n, p], i) => {
      const cx = i < 4 ? 270 : 754, cy = 185 + (i % 4) * 62;
      x.textAlign = 'left'; x.fillText(n, cx - 170, cy);
      x.textAlign = 'right'; x.fillStyle = '#e8b86d'; x.fillText('₩' + p, cx + 200, cy);
      x.fillStyle = '#e6dcc0';
    });
    x.textAlign = 'center';
    x.font = 'italic 24px Georgia,"Malgun Gothic"';
    x.fillStyle = '#9fb08a';
    x.fillText('~ Fresh Desserts : Croissant · Muffin · Cheesecake ~', 512, 500);
    x.font = '20px "Malgun Gothic"'; x.fillStyle = '#c9bfa2';
    x.fillText('매일 아침 직접 로스팅한 원두로 내립니다 ☕', 512, 560);
    return c;
  }

  /* ---------- 창밖 거리 배경 ---------- */
  function streetBackdrop() {
    const [c, x] = canvas(2048, 768);
    const r = rng(11);
    // 하늘
    const sky = x.createLinearGradient(0, 0, 0, 520);
    sky.addColorStop(0, '#9cc4e8'); sky.addColorStop(0.7, '#dfe9e2'); sky.addColorStop(1, '#f2e3c8');
    x.fillStyle = sky; x.fillRect(0, 0, 2048, 768);
    // 구름
    x.fillStyle = 'rgba(255,255,255,.75)';
    for (let i = 0; i < 9; i++) {
      const cx = r() * 2048, cy = 50 + r() * 200, s = 30 + r() * 60;
      for (let j = 0; j < 5; j++) {
        x.beginPath(); x.ellipse(cx + j * s * 0.6, cy + (r() - .5) * 14, s * (0.5 + r() * 0.5), s * 0.42, 0, 0, 7); x.fill();
      }
    }
    // 건너편 건물들
    for (let i = 0; i < 9; i++) {
      const bx = i * 235 + (r() - .5) * 40, bw = 200 + r() * 70, bh = 200 + r() * 210, by = 620 - bh;
      const v = 110 + r() * 80;
      x.fillStyle = `rgb(${v * 0.92 | 0},${v * 0.85 | 0},${v * 0.8 | 0})`;
      x.fillRect(bx, by, bw, bh);
      x.fillStyle = 'rgba(40,52,70,.8)';
      for (let wy = by + 22; wy < 600; wy += 46)
        for (let wx = bx + 16; wx < bx + bw - 26; wx += 42)
          if (r() > 0.25) x.fillRect(wx, wy, 24, 28);
    }
    // 가로수
    for (let i = 0; i < 7; i++) {
      const tx = 120 + i * 300 + r() * 60;
      x.fillStyle = '#4a3320'; x.fillRect(tx - 7, 520, 14, 110);
      x.fillStyle = `rgb(${70 + r() * 30 | 0},${120 + r() * 40 | 0},60)`;
      x.beginPath(); x.ellipse(tx, 490, 55 + r() * 25, 70 + r() * 25, 0, 0, 7); x.fill();
    }
    // 도로/보도
    x.fillStyle = '#8d8478'; x.fillRect(0, 620, 2048, 40);
    x.fillStyle = '#55524c'; x.fillRect(0, 660, 2048, 108);
    x.strokeStyle = 'rgba(255,255,255,.4)'; x.setLineDash([40, 30]); x.lineWidth = 6;
    x.beginPath(); x.moveTo(0, 716); x.lineTo(2048, 716); x.stroke();
    return c;
  }

  /* ---------- 타일(주방 벽) ---------- */
  function tile() {
    const [c, x] = canvas(256, 256);
    x.fillStyle = '#cfc7b8'; x.fillRect(0, 0, 256, 256);
    const n = 4, s = 256 / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const g = x.createLinearGradient(i * s, j * s, i * s + s, j * s + s);
      g.addColorStop(0, '#f4efe4'); g.addColorStop(1, '#e3dccb');
      x.fillStyle = g;
      x.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
    }
    return c;
  }

  /* ---------- 브러시드 메탈 (가로 헤어라인) ---------- */
  function brushedMetal(base = '#cfd3d8', seed = 101) {
    const [c, x] = canvas(256, 256);
    const r = rng(seed);
    x.fillStyle = base; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 700; i++) {
      const y = r() * 256;
      x.globalAlpha = 0.03 + r() * 0.09;
      x.fillStyle = r() > 0.5 ? '#ffffff' : '#50565e';
      x.fillRect(0, y, 256, r() < 0.85 ? 1 : 2);
    }
    // 미세 스크래치
    for (let i = 0; i < 24; i++) {
      x.globalAlpha = 0.05 + r() * 0.07;
      x.strokeStyle = '#ffffff'; x.lineWidth = 0.6;
      const y = r() * 256, len = 20 + r() * 90;
      x.beginPath(); x.moveTo(r() * 200, y); x.lineTo(r() * 200 + len, y + (r() - 0.5) * 3); x.stroke();
    }
    x.globalAlpha = 1;
    return c;
  }

  /* ---------- 금속 거칠기 맵 (지문/얼룩 포함) ---------- */
  function metalRoughMap() {
    const [c, x] = canvas(256, 256);
    const r = rng(202);
    x.fillStyle = '#8a8a8a'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 600; i++) {
      const y = r() * 256;
      x.globalAlpha = 0.06 + r() * 0.12;
      x.fillStyle = r() > 0.5 ? '#c8c8c8' : '#4e4e4e';
      x.fillRect(0, y, 256, 1);
    }
    for (let i = 0; i < 14; i++) { // 손때 얼룩 → 그 부분만 덜 반짝임
      x.globalAlpha = 0.05 + r() * 0.07;
      x.fillStyle = '#d8d8d8';
      x.beginPath(); x.ellipse(r() * 256, r() * 256, 10 + r() * 30, 8 + r() * 20, r() * 3, 0, 7); x.fill();
    }
    x.globalAlpha = 1;
    return c;
  }

  /* ---------- 원목 결 (가구/카운터용) ---------- */
  function woodGrain(c1, c2, seed = 303) {
    const [c, x] = canvas(256, 256);
    const r = rng(seed);
    x.fillStyle = c1; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 30; i++) {
      x.strokeStyle = r() > 0.82 ? '#ffffff' : c2;
      x.globalAlpha = (x.strokeStyle === '#ffffff' ? 0.04 : 0.1) + r() * 0.12;
      x.lineWidth = 1 + r() * 2.6;
      x.beginPath();
      const gx = r() * 256;
      x.moveTo(gx, -10);
      for (let gy = 0; gy <= 270; gy += 30)
        x.lineTo(gx + Math.sin(gy * 0.02 + i * 1.7) * 6 + (r() - 0.5) * 7, gy);
      x.stroke();
    }
    for (let i = 0; i < 3; i++) { // 옹이
      if (r() > 0.45) continue;
      x.globalAlpha = 0.3;
      x.fillStyle = c2;
      x.beginPath(); x.ellipse(r() * 256, r() * 256, 3.5 + r() * 5, 6 + r() * 9, 0, 0, 7); x.fill();
    }
    x.globalAlpha = 1;
    return c;
  }

  /* ---------- 노이즈 범프 (무광 표면 디테일) ---------- */
  function noiseBump(seed = 404, scale = 2) {
    const [c, x] = canvas(128, 128);
    const r = rng(seed);
    x.fillStyle = '#808080'; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 3200; i++) {
      const v = 96 + (r() * 64) | 0;
      x.fillStyle = `rgb(${v},${v},${v})`;
      x.fillRect(r() * 128, r() * 128, scale, scale);
    }
    return c;
  }

  /* ---------- 천 소파/러그 ---------- */
  function fabric(col1 = '#8d4a3b', col2 = '#7a3f33') {
    const [c, x] = canvas(256, 256);
    const r = rng(77);
    x.fillStyle = col1; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5000; i++) {
      x.fillStyle = r() > 0.5 ? col2 : 'rgba(255,255,255,.05)';
      x.fillRect(r() * 256, r() * 256, 1.6, 1.6);
    }
    return c;
  }

  /* ============ 공개 머티리얼 ============ */
  const M = {};
  function build() {
    /* --- 바닥/벽: 컬러 맵을 범프로 재사용해 요철 표현 --- */
    const floorTex = toTexture(woodFloor(), 3, 3);
    M.floor = new THREE.MeshStandardMaterial({ map: floorTex, bumpMap: floorTex, bumpScale: 0.02, roughness: 0.55, metalness: 0.06 });
    const brickTex = toTexture(brick(), 3, 1.6);
    M.brick = new THREE.MeshStandardMaterial({ map: brickTex, bumpMap: brickTex, bumpScale: 0.05, roughness: 0.92 });
    const plasterTex = toTexture(plaster(), 4, 2);
    M.plaster = new THREE.MeshStandardMaterial({ map: plasterTex, bumpMap: toTexture(noiseBump(411, 1), 4, 2, false), bumpScale: 0.01, roughness: 0.95 });
    const tileTex = toTexture(tile(), 6, 2.4);
    M.tile = new THREE.MeshStandardMaterial({ map: tileTex, bumpMap: tileTex, bumpScale: 0.02, roughness: 0.35, metalness: 0.05 });

    /* --- 대리석: 광택 + 미세 결 범프 --- */
    const marbleTex = toTexture(marble(), 1.6, 1.6);
    M.marble = new THREE.MeshStandardMaterial({ map: marbleTex, bumpMap: marbleTex, bumpScale: 0.004, roughness: 0.18, metalness: 0.08 });
    M.marbleDark = new THREE.MeshStandardMaterial({ map: toTexture(marble('#b9aF9e'), 1.6, 1.6), roughness: 0.3 });
    // 긴 카운터 상판용 (가로로 길게 반복해 결 늘어짐 방지)
    const ctTex = toTexture(marble(), 6, 1);
    M.counterTop = new THREE.MeshStandardMaterial({ map: ctTex, bumpMap: ctTex, bumpScale: 0.004, roughness: 0.16, metalness: 0.08 });
    const ctdTex = toTexture(marble('#b9aF9e'), 6, 1);
    M.counterTopDark = new THREE.MeshStandardMaterial({ map: ctdTex, bumpMap: ctdTex, bumpScale: 0.004, roughness: 0.28 });

    /* --- 원목: 결 맵 + 범프 (소형 가구용) --- */
    const wdTex = toTexture(woodGrain('#5a3c24', '#33200f', 311), 3, 3);
    M.woodDark = new THREE.MeshStandardMaterial({ map: wdTex, bumpMap: wdTex, bumpScale: 0.02, roughness: 0.6, metalness: 0.05 });
    const wmTex = toTexture(woodGrain('#8a5f3a', '#5e3c20', 317), 3, 3);
    M.woodMid = new THREE.MeshStandardMaterial({ map: wmTex, bumpMap: wmTex, bumpScale: 0.02, roughness: 0.62 });
    const wlTex = toTexture(woodGrain('#b98a58', '#8a5f38', 323), 3, 3);
    M.woodLight = new THREE.MeshStandardMaterial({ map: wlTex, bumpMap: wlTex, bumpScale: 0.018, roughness: 0.65 });
    // 11m 카운터 몸체 등 긴 가구 전용 (가로 고반복 — 결 늘어짐 방지)
    const cwmTex = toTexture(woodGrain('#8a5f3a', '#5e3c20', 317), 12, 1.2);
    M.counterWoodMid = new THREE.MeshStandardMaterial({ map: cwmTex, bumpMap: cwmTex, bumpScale: 0.02, roughness: 0.62 });
    const cwdTex = toTexture(woodGrain('#5a3c24', '#33200f', 311), 12, 1.2);
    M.counterWoodDark = new THREE.MeshStandardMaterial({ map: cwdTex, bumpMap: cwdTex, bumpScale: 0.02, roughness: 0.6 });

    /* --- 금속: 브러시드 헤어라인 + 거칠기 변화(지문/얼룩) --- */
    const roughTex = toTexture(metalRoughMap(), 1, 1, false);
    const steelTex = toTexture(brushedMetal('#cfd3d8', 101), 1, 1);
    M.steel = new THREE.MeshStandardMaterial({
      map: steelTex, bumpMap: steelTex, bumpScale: 0.0012,
      roughnessMap: roughTex, roughness: 0.55, metalness: 0.95
    });
    const steelDarkTex = toTexture(brushedMetal('#62666e', 107), 1, 1);
    M.steelDark = new THREE.MeshStandardMaterial({
      map: steelDarkTex, bumpMap: steelDarkTex, bumpScale: 0.0012,
      roughnessMap: roughTex, roughness: 0.7, metalness: 0.88
    });

    /* --- 무광 플라스틱/도기 --- */
    M.blackMatte = new THREE.MeshStandardMaterial({
      color: 0x23211f, roughness: 0.75,
      bumpMap: toTexture(noiseBump(421, 1), 2, 2, false), bumpScale: 0.0015
    });
    M.cream = new THREE.MeshStandardMaterial({ color: 0xf0e6d2, roughness: 0.8 });
    M.glass = new THREE.MeshPhysicalMaterial({
      color: 0xcfe4ec, transparent: true, opacity: 0.16, roughness: 0.05,
      metalness: 0, side: THREE.DoubleSide, depthWrite: false
    });
    M.menuBoard = new THREE.MeshStandardMaterial({ map: toTexture(menuBoard(), 1, 1), roughness: 0.9 });
    M.backdrop = new THREE.MeshBasicMaterial({ map: toTexture(streetBackdrop(), 1, 1), fog: false });
    M.backdrop.map.wrapS = THREE.ClampToEdgeWrapping;
    M.sofa = new THREE.MeshStandardMaterial({ map: toTexture(fabric(), 2, 2), roughness: 0.95 });
    M.rug = new THREE.MeshStandardMaterial({ map: toTexture(fabric('#6b4f3a', '#5d4430'), 3, 3), roughness: 1 });
    M.plant = new THREE.MeshStandardMaterial({ color: 0x4e7a3a, roughness: 0.85 });
    M.plantDark = new THREE.MeshStandardMaterial({ color: 0x3c6030, roughness: 0.85 });
    M.pot = new THREE.MeshStandardMaterial({
      color: 0xc26b4a, roughness: 0.8,
      bumpMap: toTexture(noiseBump(431, 2), 2, 2, false), bumpScale: 0.004
    });
    M.coffeeLiquid = new THREE.MeshStandardMaterial({ color: 0x2b1708, roughness: 0.15, metalness: 0.1 });
    M.milkLiquid = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.3 });
    M.cupWhite = new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.4 });
    M.cupClear = new THREE.MeshPhysicalMaterial({
      color: 0xe8f0f2, transparent: true, opacity: 0.32, roughness: 0.06, depthWrite: false
    });
    M.ice = new THREE.MeshStandardMaterial({ color: 0xd8eef5, transparent: true, opacity: 0.75, roughness: 0.2 });
  }

  return { build, M, toTexture, canvas, rng };
})();
