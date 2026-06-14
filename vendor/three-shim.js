/* ============================================================
 * three-shim.js — 전역 THREE(three.min.js, UMD)를 ES 모듈 named export로 재노출.
 * ESM 애드온(GLTFLoader 등)이 별도 three 사본 없이 "단일 전역 THREE"를 공유하도록 한다.
 * 빌드 없음 · 외부 런타임 의존성 없음. import map에서 "three" -> 이 파일로 매핑.
 *
 * export 목록 = GLTFLoader + BufferGeometryUtils + RGBELoader
 *               + postprocessing(EffectComposer·RenderPass·ShaderPass·MaskPass·OutlinePass·OutputPass)
 *               가 'three'에서 import하는 이름들의 합집합.
 * three 버전(r158) 업데이트 시 애드온들의 import 블록과 동기화할 것.
 * ============================================================ */
const THREE = window.THREE;
if (!THREE) {
  throw new Error('[three-shim] window.THREE가 없습니다. three.min.js가 모듈 스크립트보다 먼저 로드돼야 합니다.');
}

export const {
  AnimationClip, Bone, Box3, BufferAttribute, BufferGeometry, ClampToEdgeWrapping,
  Color, ColorManagement, DataTextureLoader, DataUtils, DirectionalLight, DoubleSide,
  FileLoader, Float32BufferAttribute, FloatType, HalfFloatType,
  FrontSide, Group, ImageBitmapLoader, InstancedBufferAttribute, InstancedMesh,
  InterleavedBuffer, InterleavedBufferAttribute, Interpolant, InterpolateDiscrete,
  InterpolateLinear, Line, LineBasicMaterial, LineLoop, LineSegments, LinearFilter,
  LinearMipmapLinearFilter, LinearMipmapNearestFilter, LinearSRGBColorSpace, Loader,
  LoaderUtils, Material, MathUtils, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, MirroredRepeatWrapping, NearestFilter, NearestMipmapLinearFilter,
  NearestMipmapNearestFilter, NumberKeyframeTrack, Object3D, OrthographicCamera,
  PerspectiveCamera, PointLight, Points, PointsMaterial, PropertyBinding, Quaternion,
  QuaternionKeyframeTrack, RepeatWrapping, Skeleton, SkinnedMesh, Sphere, SpotLight,
  SRGBColorSpace, Texture, TextureLoader, TriangleFanDrawMode, TriangleStripDrawMode,
  TrianglesDrawMode, Vector2, Vector3, VectorKeyframeTrack,
  // --- postprocessing 애드온(EffectComposer/OutlinePass/OutputPass)이 추가로 import하는 이름들 ---
  ACESFilmicToneMapping, AdditiveBlending, CineonToneMapping, Clock, LinearToneMapping,
  MeshDepthMaterial, NoBlending, RawShaderMaterial, ReinhardToneMapping, RGBADepthPacking,
  SRGBTransfer, ShaderMaterial, UniformsUtils, WebGLRenderTarget,
} = THREE;

export default THREE;
