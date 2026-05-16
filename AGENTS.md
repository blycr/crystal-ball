# Crystal Ball Divination — Agent Guide

## 项目简介
使用 Vite + Three.js (原生 JavaScript) 实现的魔法占卜球网页。核心 feature 是球内 6000 个五彩金属亮片在基于 3D Noise 的伪流体速度场中运动，并支持鼠标拖拽产生实时流体扰动。

## 技术栈
- **构建工具**: Vite 5.x
- **3D 引擎**: Three.js 0.160.0
- **噪声库**: simplex-noise 4.x (3D curl-noise 速度场)
- **后处理**: UnrealBloomPass (EffectComposer)
- **语言**: 原生 ES Modules (无框架)

## 项目结构
```
.
├── index.html              # 入口页面
├── package.json
├── vite.config.js
├── src/
│   └── main.js             # 全部场景、物理、渲染逻辑
└── .gitignore
```

单文件架构：所有 Three.js 逻辑集中在 `src/main.js`，便于维护和理解。

## 启动方式
```bash
npm install
npm run dev          # 开发服务器 localhost:5173
npm run build        # 生产构建到 dist/
npm run preview      # 预览生产构建
```

## 核心实现要点

### 1. 玻璃球体
- `MeshPhysicalMaterial`：transmission 0.98, ior 1.5, thickness 2.5
- `attenuationColor` + `attenuationDistance` 提供体积吸收感
- 自定义 ShaderMaterial 菲涅尔边缘光 (rim light) 勾勒轮廓
- PMREM 自定义环境贴图 (蓝/紫/金/青发光体)

### 2. 粒子系统 (亮片)
- `InstancedMesh` × 6000，金属材质 (metalness 1.0, roughness 0.06)
- 7 种神秘配色：金、银、青、深紫、极光蓝绿、热粉、亮蓝
- 球内 6 个彩色游动点光源 + 半球填充光，确保金属粒子在暗环境中有足够反射源

### 3. 流体模拟
- **速度场**: 基于 3D Simplex Noise 的 curl-noise 风格，多八度叠加
- **大尺度旋转**: 绕 Y 轴缓慢涡旋
- **鼠标交互**: Raycaster 检测球面，拖拽产生推力 + 切向漩涡
- **物理**: 速度积分 → 位置更新 → 软边界碰撞 (反弹+摩擦) → 液体阻力衰减
- **重力沉淀**: 静止时亮片在重力与阻力下缓慢下沉至球底

### 4. 后处理
- `UnrealBloomPass`: threshold 0.45, strength 0.6, radius 0.5
- 让高光金属粒子和中心光源产生柔和光晕

## 关键配置常量
位于 `src/main.js` 顶部 `CONFIG` 对象：
- `BALL_RADIUS: 3.0` — 球体半径
- `PARTICLE_COUNT: 6000` — 粒子数
- `TURBULENCE: 0.003` — 噪声流场强度
- `DRAG: 0.94` — 液体阻力
- `MOUSE_FORCE: 0.35` — 鼠标推力强度

## 浏览器兼容性
- 需要 WebGL 2.0
- 支持桌面端鼠标和移动端触摸
- 推荐 Chrome / Edge / Firefox 最新版

## 注意事项
- **性能**: 6000 粒子 × CPU 噪声计算在大多数现代设备上可保持 60fps。若遇卡顿，可降低 `PARTICLE_COUNT` 或增大 `PARTICLE_SIZE`。
- **金属可见性**: 金属材质依赖光照。若删除/减弱球内 `innerLights` 或 `coreLight`，粒子可能在暗处变黑。
- **Git**: 务必保持 `.gitignore` 生效，勿将 `node_modules/`、`dist/`、`test-*.mjs`、`test-*.png` 提交入库。
