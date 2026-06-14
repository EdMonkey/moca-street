# 카페 3D 에셋 (Blender 저폴리)

모카 스트리트용 게임 에셋. Blender(MCP)에서 제작한 저폴리 glTF 프롭 라이브러리다.
목표: 코드로 생성하던 프로시저럴 지오메트리(`js/world.js` 등)를 점진적으로 이 모델로 교체한다.

## 사양
- 포맷: glTF 2.0 바이너리(`.glb`), **Y-up**(three.js 정합)
- 스케일: **실측 미터**(1 unit = 1 m). 각 프롭은 자기 원점(origin)에 위치(익스포트 시 위치 0으로 정렬)
- 규모: **47종 / 총 ~7,850 tris**(평균 ~164 tris), Principled PBR 머티리얼 15종 공유
- 셰이딩: 박스=플랫 / 원형=측면 스무스. Draco 압축 미사용(로딩 단순화)

## 파일
- `cafe_props.glb` — **통합 라이브러리**(47종 전부, 오브젝트 이름 보존). 한 번만 로드해 이름으로 찾아 `clone()` 권장.
- `props/<이름>.glb` — 개별 프롭 47개. 온디맨드 로드가 필요할 때 사용.

## 로드 예시 (three.js r158)
> 이 프로젝트는 빌드리스(전역 `three.min.js`)다. `GLTFLoader`는 r158 `examples/jsm`의 ESM 모듈이라,
> 통합 시 **import map + `<script type="module">`** 또는 UMD 빌드 중 하나가 필요하다(에셋 연결 작업에서 결정).

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const lib = await loader.loadAsync('assets/models/cafe_props.glb');

// 이름으로 원본을 찾아 복제해서 배치
function spawn(name, x, y, z) {
  const src = lib.scene.getObjectByName(name);
  const obj = src.clone(true);
  obj.position.set(x, y, z);
  return obj;
}
scene.add(spawn('EspressoMachine', 0, 0, 0));
```

## 프롭 목록 (47종)
- **머신**: EspressoMachine, CoffeeGrinder, BeanHopper, DripBrewer, WaterDispenser
- **바리스타 도구**: Portafilter, Tamper, MilkPitcher, KnockBox, PourOverSet, GoosenecKettle, DigitalScale, CleaningBrush
- **테이블웨어**: CoffeeMug, EspressoCupSaucer, GlassTumbler, ToGoCup, SaucerPlate, Teaspoon, CondimentCaddy
- **카운터·POS**: ServiceCounter, POSTerminal, CashDrawer, PastryDisplayCase, MenuBoard, TipJar, NapkinStrawHolder
- **백오피스**: UndercounterFridge, MilkFridge, IceMachine, Microwave, Blender, ShelvingRack, Dishwasher, SinkUnit
- **가구**: CafeTable, CafeChair, BarStool, LoungeArmchair, Sofa, WindowBarCounter
- **데코**: PendantLight, PottedPlant, WallArt, RetailShelf, FloorRug, WallClock
