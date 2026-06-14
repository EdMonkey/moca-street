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

  // ---- 금속 표면 디테일용 노멀/러프니스 텍스처 (ambientCG, CC0) ----
  // 브러시드(이방성) 스테인리스 + 스크래치(상처/때) 노멀. UV 타일링으로 미세 표면을 입혀
  // 평평한 거울 반사를 깨고 실사용감을 준다. 노멀/러프는 선형 데이터맵(sRGB 아님).
  const _texLoader = new THREE.TextureLoader();
  function _loadTex(url, repeat) {
    const t = _texLoader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 4;
    return t;
  }
  const TEX_BRUSHED_N = _loadTex('assets/tex/metal_brushed_nor.jpg', 4);   // 브러시드(이방성) 노멀
  const TEX_SCRATCH_N = _loadTex('assets/tex/metal_scratches_nor.jpg', 2); // 스크래치/때 노멀

  // 금속 PBR 보정 — metalness/roughness는 glb(Blender 파일)에서 정한 실측 기반 값을 그대로
  // 사용하고(=단일 출처), 여기선 three 전용 속성만 손댄다: 표면 디테일 노멀맵 + 환경 반사 강도.
  // 라이브러리 재질은 clone 인스턴스들이 공유하므로 여기서 한 번만 보정하면 전체 적용됨.
  // (Blender 기준값: StainlessSteel m1.0/r0.40, Chrome m1.0/r0.06, DarkMetal m0.9/r0.45, Brass m1.0/r0.30)
  function tuneMetals(root) {
    const seen = new Set();
    root.traverse((n) => {
      if (!n.isMesh) return;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      mats.forEach((m) => {
        if (!m || seen.has(m.uuid)) return; seen.add(m.uuid);
        if (!m.isMeshStandardMaterial || m.metalness < 0.5) return;
        const name = m.name || '';
        if (/stainless|steel/i.test(name)) {            // 스테인리스: 브러시드(이방성)
          m.normalMap = TEX_BRUSHED_N; m.normalScale.set(0.75, 0.75);
          m.envMapIntensity = 0.55;
        } else if (/dark/i.test(name)) {                // 다크메탈: 스크래치/상처
          m.normalMap = TEX_SCRATCH_N; m.normalScale.set(0.8, 0.8);
          m.envMapIntensity = 0.7;
        } else if (/chrome/i.test(name)) {              // 크롬: 미세 브러시드(거울감 완화)
          m.normalMap = TEX_BRUSHED_N; m.normalScale.set(0.25, 0.25);
          m.envMapIntensity = 0.7;
        } else if (/brass/i.test(name)) {               // 브라스: 가벼운 스크래치
          m.normalMap = TEX_SCRATCH_N; m.normalScale.set(0.5, 0.5);
          m.envMapIntensity = 0.75;
        } else {
          m.envMapIntensity = 0.8;
        }
        m.needsUpdate = true;
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
