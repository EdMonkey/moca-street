/* ============================================================
 * weather.js — 카페 밖 날씨 (하늘·안개·햇빛·비 파티클)
 *   하루가 시작될 때마다 날씨를 정하고 실외 분위기를 바꾼다.
 *   game.js가 startPrep()에서 Weather.setForDay(day)를 호출하고,
 *   main.js가 init(scene, env) · 메인 루프에서 update(dt)를 호출한다.
 * ============================================================ */
const Weather = (() => {
  // 날씨 프리셋: 하늘색·안개(색/근·원)·햇빛(세기/색)·환경광·실외 배경 틴트·비 여부
  const TYPES = {
    clear:  { id: 'clear',  label: '맑음', icon: '☀️', sky: 0xa8c8e0, fog: 0xe8d8b8, fogNear: 30, fogFar: 70, sun: 3.0, sunColor: 0xffeed0, hemi: 0.55, tint: 0xffffff, rain: false },
    cloudy: { id: 'cloudy', label: '흐림', icon: '☁️', sky: 0x9aa6b0, fog: 0xc6ccd2, fogNear: 22, fogFar: 60, sun: 1.5, sunColor: 0xdde2e8, hemi: 0.45, tint: 0xc2c8cc, rain: false },
    rain:   { id: 'rain',   label: '비',   icon: '🌧', sky: 0x6d7780, fog: 0x868f96, fogNear: 16, fogFar: 48, sun: 0.9, sunColor: 0xc4ccd4, hemi: 0.38, tint: 0x9aa0a4, rain: true },
  };
  const ORDER = ['clear', 'cloudy', 'rain'];

  let scene = null, env = null, rain = null, cur = TYPES.clear;

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
    // 빗줄기용 세로 스트릭 텍스처
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
    pts.frustumCulled = false;   // 카메라가 매장 안이라 컬링되면 통째로 사라짐
    scene.add(pts);
    return { pts, pos, geo, N, AREA, vy: 22 };
  }

  function apply(type) {
    cur = TYPES[type] || TYPES.clear;
    if (scene && scene.background && scene.background.set) scene.background.set(cur.sky);
    if (scene && scene.fog) { scene.fog.color.set(cur.fog); scene.fog.near = cur.fogNear; scene.fog.far = cur.fogFar; }
    if (env && env.sun) { env.sun.intensity = cur.sun; env.sun.color.set(cur.sunColor); }
    if (env && env.hemi) env.hemi.intensity = cur.hemi;
    if (typeof TEX !== 'undefined' && TEX.M.backdrop) TEX.M.backdrop.color.set(cur.tint);
    if (rain) rain.pts.visible = cur.rain;
  }

  function init(s, e) {
    scene = s; env = e;
    rain = buildRain();
    apply('clear');
  }

  // 하루 번호로 결정적 선택 — 같은 날은 같은 날씨(이어하기 일관성). 1일차는 맑음으로 시작.
  function setForDay(day) {
    let type = 'clear';
    if (day > 1) {
      const h = (day * 2654435761) >>> 0;   // 간단 해시로 날짜→날씨 매핑
      type = ORDER[h % ORDER.length];
    }
    apply(type);
    return cur;
  }

  function update(dt) {
    if (!rain || !rain.pts.visible) return;
    const p = rain.pos, N = rain.N, drop = rain.vy * dt;
    for (let i = 0; i < N; i++) {
      let y = p[i * 3 + 1] - drop;
      if (y < 0) y = rain.AREA.y;   // 바닥에 닿으면 위로 재순환
      p[i * 3 + 1] = y;
    }
    rain.geo.attributes.position.needsUpdate = true;
  }

  function current() { return cur; }

  return { init, setForDay, update, current, TYPES };
})();
