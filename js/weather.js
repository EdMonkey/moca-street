/* ============================================================
 * weather.js — 카페 밖 하늘 (날씨 + 시간대별 일출/일몰 + 비)
 *   · 하루마다 맑음/흐림/비 결정 — game.js가 setForDay(day) 호출
 *   · 게임 시계(08~18시)에 맞춰 해의 고도·방위·색·하늘빛이 변함(일출/일몰)
 *     — game.js가 매 틱 setClock(hour) 호출, main.js가 update(dt)로 비 애니메이션
 *   · 비 오는 날엔 창밖으로 빗줄기 파티클
 * ============================================================ */
const Weather = (() => {
  // 날씨 프리셋: 정오 기준 하늘색·안개·햇빛·환경광·실외 배경 틴트·비 여부
  const TYPES = {
    clear:  { id: 'clear',  label: '맑음', icon: '☀️', sky: 0xa8c8e0, fog: 0xe8d8b8, fogNear: 30, fogFar: 70, sun: 3.0, sunColor: 0xffeed0, hemi: 0.55, tint: 0xffffff, rain: false },
    cloudy: { id: 'cloudy', label: '흐림', icon: '☁️', sky: 0x9aa6b0, fog: 0xc6ccd2, fogNear: 22, fogFar: 60, sun: 1.5, sunColor: 0xdde2e8, hemi: 0.45, tint: 0xc2c8cc, rain: false },
    rain:   { id: 'rain',   label: '비',   icon: '🌧', sky: 0x6d7780, fog: 0x868f96, fogNear: 16, fogFar: 48, sun: 0.9, sunColor: 0xc4ccd4, hemi: 0.38, tint: 0x9aa0a4, rain: true },
  };
  const ORDER = ['clear', 'cloudy', 'rain'];

  // 일출/일몰 표현용
  const DAWN = 6.5, DUSK = 19.5;                      // 해 뜨고 지는 시각(게임 외삽)
  const HORIZON_SUN = 0xff8a3a;                       // 지평선 근처 햇빛(주황)
  const SKY_DAWN = 0xf4c9ad, SKY_DUSK = 0xf0975a;     // 아침/저녁 노을빛

  let scene = null, env = null, rain = null, sun3d = null, cur = TYPES.clear, dayP = 0.12;
  const _a = new THREE.Color(), _b = new THREE.Color(), _c = new THREE.Color();

  // 비 파티클 — 실외(앞창/문 너머 z>8) 영역에 떨어지는 빗줄기
  function buildRain() {
    const N = 1400;
    const AREA = { x: 26, z0: 8.5, z1: 26, y: 17 };
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 2 * AREA.x;
      pos[i * 3 + 1] = Math.random() * AREA.y;
      pos[i * 3 + 2] = AREA.z0 + Math.random() * (AREA.z1 - AREA.z0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const [c, x] = TEX.canvas(8, 32);
    const g = x.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, 'rgba(200,222,242,0)');
    g.addColorStop(0.5, 'rgba(200,222,242,.8)');
    g.addColorStop(1, 'rgba(200,222,242,0)');
    x.fillStyle = g; x.fillRect(2, 0, 4, 32);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.PointsMaterial({
      map: tex, size: 0.7, transparent: true, opacity: 0.5,
      depthWrite: false, sizeAttenuation: true, fog: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.visible = false;
    pts.frustumCulled = false;
    scene.add(pts);
    return { pts, pos, geo, N, AREA, vy: 22 };
  }

  // 해 글로우 — 창밖에 떠서 시각에 따라 뜨고 지는 부드러운 빛무리(가산 합성)
  function buildSun() {
    const [c, x] = TEX.canvas(64, 64);
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,250,235,1)');
    g.addColorStop(0.25, 'rgba(255,240,205,.85)');
    g.addColorStop(1, 'rgba(255,210,150,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0, depthWrite: false,
      depthTest: true, fog: false, blending: THREE.AdditiveBlending,
    }));
    s.position.set(0, 10, 22);   // 창(z=8)과 배경(z=26) 사이 → 유리 통해서만 보임
    scene.add(s);
    return s;
  }

  function elevOf(p) { return Math.sin(Math.max(0, Math.min(1, p)) * Math.PI); }  // 0 지평선 ~ 1 정오

  // 현재 날씨 + 시각으로 하늘·안개·햇빛·해를 다시 계산
  function recompute() {
    const p = dayP, elev = elevOf(p), warm = 1 - elev;     // warm: 일출/일몰에 가까울수록 1
    const horizon = (p < 0.5) ? SKY_DAWN : SKY_DUSK;
    if (scene && scene.background && scene.background.copy)
      scene.background.copy(_a.set(cur.sky).lerp(_b.set(horizon), warm * 0.9));
    if (scene && scene.fog) {
      scene.fog.color.copy(_a.set(cur.fog).lerp(_b.set(horizon), warm * 0.7));
      scene.fog.near = cur.fogNear; scene.fog.far = cur.fogFar;
    }
    if (env && env.sun) {
      env.sun.intensity = cur.sun * (0.4 + 0.6 * elev);                 // 지평선 근처는 약하게
      env.sun.color.copy(_a.set(cur.sunColor).lerp(_b.set(HORIZON_SUN), warm * 0.85));
      const a = p * Math.PI;                                            // 동(+x)→서(−x)
      env.sun.position.set(14 * Math.cos(a), 4 + 16 * elev, 13);
    }
    if (env && env.hemi) env.hemi.intensity = cur.hemi * (0.7 + 0.3 * elev);
    if (typeof TEX !== 'undefined' && TEX.M.backdrop) TEX.M.backdrop.color.set(cur.tint);
    if (sun3d) {
      const a = p * Math.PI;
      sun3d.position.set(11 * Math.cos(a), 1 + 19 * elev, 18);          // 창 시야 안에서 뜨고 짐
      const op = cur.rain ? 0 : warm * 0.95 * (cur.id === 'cloudy' ? 0.4 : 1);
      sun3d.material.opacity = Math.max(0, op);                         // 정오엔 머리 위라 안 보임(투명)
      sun3d.material.color.copy(_c.set(HORIZON_SUN).lerp(_a.set(0xfff2cc), elev));
      sun3d.scale.setScalar(4.5 + 4 * warm);
    }
    if (rain) rain.pts.visible = cur.rain;
  }

  function init(s, e) {
    scene = s; env = e;
    rain = buildRain();
    sun3d = buildSun();
    apply('clear');
  }

  function apply(type) { cur = TYPES[type] || TYPES.clear; recompute(); }

  // 하루 번호로 결정적 선택 — 같은 날은 같은 날씨(이어하기 일관성). 1일차는 맑음.
  function setForDay(day) {
    let type = 'clear';
    if (day > 1) { const h = (day * 2654435761) >>> 0; type = ORDER[h % ORDER.length]; }
    apply(type);
    return cur;
  }

  // 게임 시각(시) → 해의 위치/색 갱신. game.js가 준비/영업/마감에서 호출.
  function setClock(hour) {
    dayP = Math.max(0, Math.min(1, (hour - DAWN) / (DUSK - DAWN)));
    recompute();
  }

  function update(dt) {
    if (!rain || !rain.pts.visible) return;
    const p = rain.pos, N = rain.N, drop = rain.vy * dt;
    for (let i = 0; i < N; i++) {
      let y = p[i * 3 + 1] - drop;
      if (y < 0) y = rain.AREA.y;
      p[i * 3 + 1] = y;
    }
    rain.geo.attributes.position.needsUpdate = true;
  }

  function current() { return cur; }

  return { init, setForDay, setClock, update, current, TYPES };
})();
