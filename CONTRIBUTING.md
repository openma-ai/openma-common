# 贡献指南

**English.** Canonical contribution guide for the openma-ai org. It lives in `open-managed-agents` first; copy it to other org repos or an org `.github` repo and replace only **本仓库**. Shared rules: conventional-commit titles, squash merge, small PRs, green CI with a root cause for failures, a compatibility check on dependency bumps plus a follow-up bump downstream after release, private security reports, and an evidence report on every PR before merge.

以下各节是组织约定。「本仓库」只适用于 `openma-common`。

## 分支 / Branches

从 `main` 拉出。人工分支用小写：

```text
<type>/<kebab-summary>
```

`type` 与 PR 标题类型一致。近期合并：`fix/ci-minio-image`（#227）、`feat/sql-realtime-fanout`（#222）、`refactor/split-node-assembly`（#234）、`docs/discord-community`（#197）。关联 issue 时把编号放进名字，例如 `fix/196-session-update-idle`。

工具前缀保持原样：`dependabot/…`、`codex/…`、`cursor/…`。deepseek-harness-acp 的 dsh 升级分支是 `codex/bump-dsh-<version>`。

一个分支一件事。跟上 `main` 用 rebase。

## PR 标题与 squash / PR titles

标题用 [Conventional Commits](https://www.conventionalcommits.org/)。squash 之后它就是 `main` 上的提交说明，GitHub 再追加 `(#编号)`：

```text
<type>(<scope>): <祈使句，说明做了什么>
```

`scope` 可省略。常用 type：`feat` `fix` `refactor` `perf` `docs` `test` `ci` `chore`。依赖用 `chore(deps):`。一篇 PR 一个 type。近期合进去的标题也不都是这个格式：#224 是 `fix+feat(...)`；#237 是 `Workspace persistence semantics: durable_mount vs fenced checkpoint_restore, shared Session outputs`；#239 是 `CMA retry_status semantics + live-found fixes (...)`。新 PR 用单一 conventional type。

发版提交的主题是 `release: vX.Y.Z`（见「发布」），普通 PR 不用这个前缀。

合并方式是 **squash**。本仓库近期 `main` 上每篇 PR 是一个单父提交，主题即 PR 标题。#202 写明仓库不接受 merge commit，因此把多篇依赖 PR 合成一篇再 squash。deepseek-harness-acp 历史上有过 merge commit（#30）；新 PR 按 squash 合。

## 小 PR / Small PRs

一次改一个问题或一个职责。`main-node` 控制面拆分是一串短 PR（#225、#228–#234），每篇只动一层。文档、重命名、行为变更分开。

lockfile 冲突时可以把多篇依赖更新合成一篇，跑一次完整 CI（#202 包含 #201–#206）。描述里列出被包含的 PR。

## 证据报告 / Evidence report

**合并前，PR 描述或一条评论里必须有证据报告，并且对应当前 head SHA。** 缺段，或证据还停在旧 SHA 上，就不合并。仓库没有把这件事做成 status check：作者填写，维护者核对。模板是 `.github/pull_request_template.md`。

六段都要出现。没有内容就写「不适用」并给一句原因。

### 问题 / 动机

缺陷要有**在真实产品上**的复现：命令、版本、原样输出。只写推理不够。新能力写清谁在什么场景下需要它。

### 根因

写到代码或外部依赖的哪一层。上游变更（镜像仓库、npm 发布）和本仓库的缺陷分开写。

### 改动说明

做了什么、刻意没做什么。点名关键文件，不贴大段 diff。

### 验证证据

- 当前 head SHA。
- 该 SHA 上的 CI run 链接，写明 workflow 和 job。旧 push 的绿 run 不算。
- 跑过的测试名称和通过数（例如 `8 files / 42 tests`）。本地和 CI 都写。
- 改了 UI 或可见行为时，把截图或录屏嵌进 PR。可以直接拖进 GitHub。需要稳定链接时，推到孤立分支 `pr-assets`：

  ```bash
  git checkout --orphan pr-assets
  git rm -rf .
  mkdir -p pr-<编号>
  # 只放 png / webm。不要放密钥，也不要放未剪辑的大体积录屏。
  git add pr-<编号>
  git commit -m "pr-assets: <编号>"
  git push -u origin pr-assets
  ```

  链接形式：`https://raw.githubusercontent.com/openma-ai/<repo>/pr-assets/pr-<编号>/<file>`。`pr-assets` 只存证据，不在上面开发。

### 未验证的部分

写明没跑的检查和原因。作者自己的 mock、fixture、测试替身，与真实产品或上游行为分开。mock 通过不等于 KVM 沙箱、托管环境或下游仓库已经验证。

### 风险与回滚

最坏情况，以及怎么退回：revert 这篇 squash 提交，或发一个修复版本。发版和迁移要写用户会看到什么。

### 示例

#227 的缩写，只示范格式。新 PR 按自己的改动重写。

> **问题 / 动机。** `pnpm test:integration:storage` 在 CI run [36001613340](https://github.com/openma-ai/open-managed-agents/actions/runs/36001613340) 的 global setup 失败，测试还没开始。日志是 MinIO 匿名拉取 `401 unauthorized`。干净机器上 `docker pull quay.io/minio/minio@sha256:d249d1fb…` 同样 401。
>
> **根因。** 仓库代码没有变化。`quay.io/minio/minio` 停止匿名拉取。
>
> **改动说明。** 测试镜像改为可匿名拉取的 `cgr.dev/chainguard/minio`，并钉住 manifest digest。
>
> **验证证据。** 本地 `pnpm test:integration:storage`：8 files / 42 tests 通过。合并前该 PR head 上的 CI storage 步骤通过。
>
> **未验证的部分。** 这是 CI 用的 MinIO 镜像，不是产品运行时依赖。没有改 S3 条件写相关的产品代码，也就没有另做产品级 S3 手工验证。
>
> **风险与回滚。** 只影响存储集成测试。revert 该提交即回到旧镜像引用。

## CI / 必须是绿的

合并前，当前 head SHA 上该 PR 该跑的 CI 全部成功。失败先读日志，写出根因，再改代码或改测试。不要对同一 SHA 反复 Re-run，直到碰巧变绿再合。

Re-run 可以用来收集第二次日志。第一次红、第二次绿时，报告里写明两次差异（超时、外部注册表、被 concurrency 取消的 run）。说不清原因就继续查。#227 的处理是确认 MinIO 注册表 401，然后更换镜像。

`concurrency.cancel-in-progress: true` 会取消同一 ref 上还在跑的旧 workflow。被取消的 run 不是 flake；看新 SHA 上的 run。

## 依赖升级 / Dependency upgrades

Dependabot 和手工 lockfile 更新都要做兼容性检查。CI 变绿只是其中一步：

- 读上游 changelog / release notes，列出行为变化。
- 跑本仓库已有的兼容矩阵，而不是只跑默认单测。deepseek-harness-acp 的 job `dsh-compatibility` 按 `runtime/compatibility.json` 安装多个 `@deepseek-ai/dsh` 并做 profile smoke。定时 workflow `dsh-update.yml` 会打开 `chore: upgrade bundled dsh to <version>`。#33 给这个 workflow 加了 Cursor agent 复查；人仍然负责合并。
- 升级 PR 不顺便给本包打版本。dsh 自动 PR 的正文写明：This PR does not bump or release the ACP package。
- 适配修不好就不合并。

发布之后，下游另开 bump PR，把依赖改到刚发布的版本，并跑下游自己的 CI：

- Martty 的 `npm/package.json` 依赖 `@openma/deepseek-harness-acp`。CHANGELOG 记录过随 0.4.29、0.4.31 的升级；#135 跟上了 0.4.35 的打包修复。
- openma-common 打 tag 之后，两个消费仓库改到新 tag 并提交 lockfile（该仓库 `CONTRIBUTING.md` 的 release checklist）。

## 发布 / Release

以该仓库的 workflow 为准。组织里实际有两种。

**打 tag。** deepseek-harness-acp、Martty、openma-common：

1. 版本写进清单。Martty 还要求 tag、`npm/package.json`、`Cargo.toml` 一致（`scripts/check-release-tag.mjs`）。
2. dsh 与 Martty 在 `main` 上的发版提交主题为 `release: vX.Y.Z`（dsh `v0.4.36`、Martty `v0.3.0`）。openma-common 是发版 PR 合并后再打同名 tag。
3. `git tag vX.Y.Z && git push origin vX.Y.Z`。tag 指向 `main` 上的那次提交。
4. tag 触发发布：dsh `release.yml` 先确认 tag 在 `main` 上，再跑测试、dsh 兼容矩阵和 standalone smoke，然后用 npm OIDC 发布。Martty `package-npm.yml` 监听 `v*.*.*`。
5. openma-common 是 `private: true` 的 git 依赖：打 tag 后更新消费方，不发 npm。

**Changesets。** 用来发布 `@openma/cli` / `@openma/sdk`。步骤在「本仓库」。本仓库的 `version-pr` 会跑 MySQL 集成，但没有 `Enable KVM for Litebox`；没有 `/dev/kvm` 时 Litebox 用例会失败。

发版提交只含版本和 changelog。功能先进普通 PR。发版后按上一节给下游开 bump PR。

## 安全 / Security

私下报告，不要开公开 issue。本仓库没有 `SECURITY.md`，Private vulnerability reporting 未开启，见「本仓库」。

发行物里不带调试端口，也不带密钥：

- 发布的 Node 进程、镜像 `CMD`、安装包里不开 `--inspect`、`9229`，也不开 Chrome `--remote-debugging-port`。
- 镜像只暴露产品端口，不额外 `EXPOSE` 调试端口。
- `.env`、`.dev.vars`、token、keystore 不进 git、npm 包、GHCR 镜像或桌面安装包。

依赖安全公告单独修（Backchat 有 `chore: prepare Backchat v0.0.9 security release`）。修法仍走普通 PR 和证据报告；公告细节走私下渠道。

## 本仓库：openma-common

包名是 `@openma/common`（`package.json` 的 `name`）。只收录至少两个 OpenMA 表面真正共享的契约。产品自己的组件、文案、路由、存储，以及主题插件校验，留在各自的仓库。

`private: true`。没有 `publishConfig`，`scripts` 里也没有 `publish`。不发 npm。`files` 是 `dist` 和 `README.md`。README「Install from Git」的安装形式是 `github:openma-ai/openma-common#v0.7.0`。同一节写明 lockfile 会把这个 tag 解析成一次提交。`dist/` 已提交：2026-10-02，`git ls-files dist` 是 216 个路径。`a83404d`（`v0.1.1`，`fix: ship prebuilt output for git consumers`）开始把预构建产物放进仓库，Git 安装因此不必跑构建脚本。已经发出的 tag 不移动；消费方能看见的变更用新 tag（README 同一节）。

没有 `.node-version`，也没有 `.nvmrc`。`engines.node` 是 `>=20`。pnpm 版本是 `packageManager` 字段：`pnpm@11.0.8`。

```bash
pnpm install
pnpm verify
```

`pnpm verify` 等于 `pnpm test && pnpm typecheck && pnpm build`。`pnpm test` 跑 Vitest。`vitest.config.ts` 只包含 `tests/**/*.test.{ts,tsx}`。2026-10-02，这个 glob 有 51 个文件。`pnpm dev` 执行 `scripts/dev.mjs`：`pnpm exec tsc -p tsconfig.build.json --watch --preserveWatchOutput`，并复制 `src/brand/tokens.css` 和 `src/brand/openma-logo-mark.svg`。`pnpm build` 另由 `scripts/copy-static-assets.mjs` 复制这两份，再加上 `src/brand/website.css` 和 `src/chat-ui/styles.css`。`pnpm test:watch` 是 Vitest 的 watch。`pnpm dev:consumers` 先跑 `pnpm link:consumers`，再跑 `pnpm dev`，退出时跑 `pnpm unlink:consumers`（`scripts/dev-consumers.mjs`；README「Fast local development」）。`pnpm link:consumers` 和 `pnpm unlink:consumers` 可以单独跑。

改 ACP 线协议之前，对照官方 ACP v1 文档核对方法名、update 形状、生命周期和 `_meta`：https://agentclientprotocol.com/protocol/v1 。运行时依赖是 `@agentclientprotocol/sdk`。

| 命令 | 作用 |
|---|---|
| `pnpm test` | Vitest，一次跑完 |
| `pnpm test:watch` | Vitest watch |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm build` | `tsc -p tsconfig.build.json`，然后 `node scripts/copy-static-assets.mjs` |
| `pnpm dev` | 编译 watch |
| `pnpm dev:consumers` | link 同级消费方并 watch |
| `pnpm verify` | test、typecheck、build |

上面「PR 标题与 squash」里「本仓库近期 `main` 上每篇 PR 是一个单父提交」引用的是 `open-managed-agents` 的 #202 和 #234。本仓库 `main` 的合并记录如下。GitHub 仓库设置里 `allow_merge_commit`、`allow_squash_merge`、`allow_rebase_merge` 都是 true，`delete_branch_on_merge` 是 false。`git log --merges` 里有 #1–#5 的双父 merge commit（#1 `7dbb190`，#5 `72ccc56`）。#6 的 `5736c57` 只有一个父提交 `72ccc56`；该 PR 的 commit 数是 1。新 PR 仍按上一节 squash。

### CI

没有会跑的 GitHub Actions。`GET /repos/openma-ai/openma-common/actions/workflows` 的 `total_count` 是 0。仓库里没有 `.github/workflows`。

`docs/ci-workflow.yml` 从 `11421ce` 就在树里。文件里的 workflow 名叫 `CI`，`on` 是 `pull_request`，以及对 `main` 和 tag `v*` 的 `push`。job `verify` 用 `ubuntu-latest`、`actions/checkout@v4`、`pnpm/action-setup@v4`、`actions/setup-node@v4`（`node-version: "24"`），然后 `pnpm install --frozen-lockfile`、`pnpm verify`、`git diff --exit-code -- dist`。tag 上再检查 tag 名等于 `v` 加上 `package.json` 的 `version`。它不在 `.github/workflows/`，GitHub Actions 不会跑它。`engines.node` 仍是 `>=20`。这份未启用文件把 `node-version` 写成 `"24"`。

### 发布

README「Change lifecycle」的顺序：先补测试，跑 `pnpm verify`，本地 link 并核对消费方，合并后改 `version`，打不可变 tag `vX.Y.Z`，再在消费方的普通 PR 里更新 git ref 和 lockfile。

同一节的兼容性：

- patch：修复，或增加字段但不改变已有输出
- minor：新 token、export、规范化事件变体，或可选行为
- major：删除或重命名 token、export、类型，或改变 reducer 语义

清单：

1. `package.json` 的 `version` 用语义化版本。当前是 `0.7.0`。
2. 保持 `private: true`。
3. 构建有变化时跑 `pnpm build`，把对应的 `dist/` 一起提交。发版提交 `f8473d1`（`release: v0.7.0`）只改了 `README.md`、`package.json` 和 `docs/releases/v0.7.0.md`，没有改 `dist/`。这次 `dist/` 的更新在 #6：`5736c57` 相对 `72ccc56`，`dist/` 有 21 个文件变化。当时 `package.json` 的 version 仍是 `0.6.0`，版本号是 `f8473d1` 才改成 `0.7.0`。
4. 发版提交在 `main` 上。`f8473d1` 的唯一父提交是 `5736c57`，主题是 `release: v0.7.0`。已合并 PR 只有 #1–#6，它们的 merge commit 都不是 `f8473d1`。
5. 在该提交上打 tag 并推送：`git tag vX.Y.Z && git push origin vX.Y.Z`。`v0.7.0` 是附注标签，对象是 `f8473d1`，说明是 `Release @openma/common 0.7.0`。`v0.6.0` 指向 #5 的 merge commit `72ccc567013bf14f29401f9393828146ca09beda`。`v0.3.0` 和 `v0.4.0` 是轻量标签（`git cat-file -t` 为 `commit`）。`v0.1.0`、`v0.1.1`、`v0.2.0`、`v0.5.0`、`v0.6.0`、`v0.7.0` 是附注标签。
6. 然后把消费方的 git 依赖改到新 tag，并提交他们的 lockfile。不要移动旧 tag。

本仓库没有 `.changeset` 目录，`package.json` 里也没有 changeset 脚本。`@openma/cli` / `@openma/sdk` 的 changeset 步骤在 `open-managed-agents` 的贡献指南里。

2026-10-02 核对时，消费方还没有切到 `v0.7.0`。`docs/releases/v0.7.0.md` 写明：Consumer manifests and remote branches were not changed。

- [backchat](https://github.com/openma-ai/backchat) 的根 `package.json`、`packages/acp/package.json`（`@open-managed-agents-desktop/acp`）和 `pnpm-workspace.yaml` 的 override 都是 `git+https://github.com/openma-ai/openma-common.git#v0.6.0`。`pnpm-lock.yaml` 把这个 specifier 解析到 `https://codeload.github.com/openma-ai/openma-common/tar.gz/72ccc567013bf14f29401f9393828146ca09beda`，也就是 `v0.6.0` 指向的提交。[#21](https://github.com/openma-ai/backchat/pull/21) 把 `packages/acp/package.json` 从 `#e196bdcac3d5f3165d6833c2531d4255a51620e9` 改成 `#v0.6.0`。
- [open-managed-agents](https://github.com/openma-ai/open-managed-agents) 的包钉的是提交，不是 tag。`pnpm-workspace.yaml` 里没有 `@openma/common` override。根 `package.json` 也不依赖它。钉 `e196bdcac3d5f3165d6833c2531d4255a51620e9`（`fix: treat ACP steering as an optional runtime capability`）的是 `apps/docs`、`apps/console`、`apps/main`、`packages/cli`（devDependency）、`packages/acp-runtime`、`packages/runtime-relay`、`packages/managed-runtime-host`、`packages/managed-agents-runtime`、`packages/managed-agents-application`、`packages/openai-agents-compat`。`apps/web/package.json` 是 `d00d876c41a3e244c5f14f7d7ff145d957df7a7f`。`packages/harness-runtime-acp/package.json` 是 `4d9bb469d3af8ade05d020a9b65bae2bd978101d`。`pnpm-lock.yaml` 用同一批 SHA 的 codeload tarball。

本地 link 脚本 `scripts/consumers.mjs` 寻找同级目录 `openma-desktop`、`openma-desktop/packages/acp`，以及 `open-managed-agents` 的 `packages/acp-runtime`、`apps/console`、`apps/web`、`apps/docs`、`packages/cli`。目录不存在就跳过，并且不改消费方的 manifest 或 lockfile。GitHub 上没有 `openma-ai/openma-desktop` 这个仓库（`gh repo view` 无法解析）。公开仓库里声明了这条 git 依赖的，是上面的 backchat 和 open-managed-agents。

### 安全

根目录没有 `SECURITY.md`。`GET /repos/openma-ai/openma-common/contents/SECURITY.md` 是 404。community profile 的 security 文件是 null。`GET /repos/openma-ai/openma-common/private-vulnerability-reporting` 返回 `{"enabled":false}`。公开 security advisories 的数量是 0。不要开公开 issue 报告漏洞。
