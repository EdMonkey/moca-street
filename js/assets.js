/* ============================================================
 * assets.js — glTF 에셋 로드/캐시 (전역 Assets)
 *
 * Blender에서 만든 저폴리 카페 프롭 라이브러리(assets/models/cafe_props.glb)를
 * 1회 로드해 오브젝트 이름으로 clone 배치한다. 빌드리스 — window.GLTFLoader 가
 * 준비된 뒤(index.html의 모듈 부트스트랩) Assets.boot()로 시작한다.
 *
 *   await Assets.ready;                     // 로드 완료 대기
 *   const o = Assets.spawn('CafeTable', x, z);  // 바닥(y=0)에 앉도록 자동 보정 후 복제
 *
 * 각 프롭의 원점이 베이스가 아니므로, 바운딩박스 min.y로 바닥 정렬 오프셋을 자동 계산한다.
 * ============================================================ */
const Assets = (() => {
  const LIB_URL = 'assets/models/cafe_props.glb';
  let lib = null;            // gltf.scene (라이브러리 루트)
  const cache = {};          // name -> { obj, offsetY }
  let booted = false, _resolve, _reject;
  const ready = new Promise((res, rej) => { _resolve = res; _reject = rej; });

  function _entry(name) {
    if (cache[name]) return cache[name];
    const obj = lib && lib.getObjectByName(name);
    if (!obj) return null;
    const box = new THREE.Box3().setFromObject(obj);
    // 베이스를 y=0에 맞추는 오프셋. obj.position.y를 빼서 "원점이 베이스가 아닌"
    // (피벗이 떠 있는) 프롭도 spawn 시 바닥이 baseY에 정확히 앉도록 한다.
    cache[name] = { obj, offsetY: obj.position.y - box.min.y };
    return cache[name];
  }

  // 금속(스테인리스/크롬/다크메탈/브라스) 반사 강화 — 씬 environment를 더 강하게 반사해 은색 광택을 살림.
  // 라이브러리 재질은 clone 인스턴스들이 공유하므로 여기서 한 번만 보정하면 전체 적용됨.
  function tuneMetals(root) {
    const seen = new Set();
    root.traverse((n) => {
      if (!n.isMesh) return;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      mats.forEach((m) => {
        if (!m || seen.has(m.uuid)) return; seen.add(m.uuid);
        if (m.isMeshStandardMaterial && m.metalness >= 0.5) {
          m.envMapIntensity = 1.8;
          if (m.roughness > 0.35) m.roughness = 0.3;   // 무광 금속만 살짝 광택
          m.needsUpdate = true;
        }
      });
    });
  }

  // window.GLTFLoader 가 준비된 뒤 호출 — 라이브러리 1회 로드.
  function boot(GLTFLoaderClass) {
    if (booted) return ready;
    booted = true;
    const loader = new GLTFLoaderClass();
    loader.load(
      LIB_URL,
      (gltf) => {
        lib = gltf.scene; lib.updateMatrixWorld(true);
        tuneMetals(lib);   // 스테인리스/크롬 등 금속 광택(환경맵 반사) 강화
        _resolve(Assets);
      },
      undefined,
      (err) => { console.error('[Assets] glb 로드 실패:', LIB_URL, err); _reject(err); }
    );
    return ready;
  }

  // 프롭 복제 배치. (x,z)=바닥 평면 좌표, baseY=바닥 높이(기본 0), rotY=Y축 회전(rad).
  function spawn(name, x = 0, z = 0, baseY = 0, rotY = 0) {
    const e = _entry(name);
    if (!e) { console.warn('[Assets] 프롭 없음:', name); return null; }
    const o = e.obj.clone(true);            // 지오메트리/머티리얼은 공유(인스턴스 효율)
    o.position.set(x, baseY + e.offsetY, z);
    o.rotation.y = rotY;
    o.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
    return o;
  }

  function names() { return lib ? lib.children.map((c) => c.name).filter(Boolean) : []; }
  function isReady() { return !!lib; }

  return { boot, spawn, names, isReady, ready };
})();
window.Assets = Assets;
