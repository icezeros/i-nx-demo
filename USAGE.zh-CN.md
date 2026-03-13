# Monorepo 自动化版本与发版（Nx Release 示例）

本仓库演示：

- 两组独立版本线
  - **platform**：`packages/*`（统一版本）
  - **client**：`apps/*`（统一版本）
- **按 Conventional Commits 自动推导版本号（自定义规则：feat=major）**
- **按项目（文件夹/包）生成独立 `CHANGELOG.md`**
- **公有包发 npmjs.org / 私有包发私有 registry / `tools/*` 不发版**
- **Commitlint 强制校验提交信息**

## 目录结构

```
packages/                 # platform 组（统一版本）
  core/                   # public
  utils/                  # public
  internal-helpers/       # restricted + private registry
apps/                     # client 组（统一版本）
  web-app/                # public
  mobile-app/             # public
  admin-portal/           # restricted + private registry
tools/                    # 不参与发版（private）
  build-scripts/
```

## 约定提交（必须）

本仓库开启了 commit-msg 钩子，提交信息必须符合 Conventional Commits，例如：

- `feat: add new api`（会触发 **major**）
- `fix: correct typo`（会触发 **patch**）
- `docs: update readme`（不触发版本变化）
- `feat!: breaking change` 或 body 含 `BREAKING CHANGE:`（触发 **major**）

## 本地发版命令

### 方式一：先确认再发版（推荐）

先根据 commits 算出版本，展示给你确认，可原样采用或**手动改成别的版本号**后再执行：

- platform 组：`npm run release:platform:confirm`
- client 组：`npm run release:client:confirm`

流程：dry-run 计算建议版本 → 终端提示「建议版本: x.y.z」→ 回车即用该版本发版，或输入新版本号（如 `1.2.0`）后发版。

### 方式二：直接发版 / 仅预览

- platform 组：
  - `npm run release:platform -- --dry-run`（只预览）
  - `npm run release:platform`（直接发版，无确认）
- client 组：
  - `npm run release:client -- --dry-run`
  - `npm run release:client`
- 两组一起 dry-run：`npm run release:dry`

**手动指定版本**（覆盖自动计算）：  
`npx nx release --groups platform-packages 2.0.0 --yes`

Nx Release 会做：

- 解析 git tags 得到当前版本（找不到则回退读各项目 `package.json`）
- 从上一个 tag 到 HEAD 的 commits 推导 bump
- 更新版本号、生成 changelog、打 tag

## Changelog 位置

Nx Release 会在每个项目根目录生成/更新 `CHANGELOG.md`，例如：

- `packages/core/CHANGELOG.md`
- `apps/web-app/CHANGELOG.md`

## Registry / 发布

`.npmrc` 示例配置了：

- 默认 registry：npmjs.org
- scope `@myorg-internal/*` 指向私有 registry `https://npm.private.com/`

需要在环境变量或 CI secrets 中提供：

- `NPM_TOKEN`（可选：npmjs.org）
- `NPM_PRIVATE_TOKEN`（可选：私有 registry）

## CI（GitHub Actions）

工作流文件：`.github/workflows/release.yml`

支持手动选择发版组：

- `platform-packages`
- `client-applications`

并执行：

- `nx release --groups <group> --yes`
- `nx release publish --groups <group> --yes`

> 注意：发布是否成功取决于你的 token、registry 可用性以及包名是否可发布。
