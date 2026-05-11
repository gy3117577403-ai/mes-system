# 项目总说明

本文档用于把当前 MES / 治具管理 / AI 排单系统的真实代码结构、部署链路和已知问题交接给后续 ChatGPT 或开发者继续分析。文档只记录变量名和配置状态，不包含任何真实 API Key、数据库密码、Token、Cookie 或 Secret。

## 1. 项目基本信息

- 项目根目录：`C:\Users\31175\gg-ai`
- package 名称：`gg-ai`
- 当前分支：`main`
- Node 版本：`v24.14.0`
- pnpm 版本：`10.32.1`
- 当前工作区状态：生成本文档前为 clean；本文档新增后会变为待提交状态
- 最近 5 次提交：
  - `9c56ed4 fix(ai-schedule): handle production runtime errors gracefully`
  - `a7a34d0 fix(ai): add robust try-catch guards, handle non-200 API responses safely, and enforce deepseek-chat model enum to prevent full site crash`
  - `5d5935b feat(ai): inject real deepseek v4 pro API key into scheduler copilot engine with strict JSON mode enforcement`
  - `5e58e45 fix(ci): make pnpm workspace config compatible with pnpm 9 docker install`
  - `6622359 fix(ci): remove build-time Google font fetch and harden Docker build commands`

package.json scripts：

| script | command | 作用 |
|---|---|---|
| `dev` | `node scripts/print-dev-url.mjs && next dev -p 3456 -H 127.0.0.1` | 本地开发服务 |
| `open:dev` | `start http://127.0.0.1:3456` | Windows 打开本地页面 |
| `dev:3000` | `next dev -p 3000 -H 127.0.0.1` | 备用 3000 端口开发服务 |
| `build` | `next build` | 生产构建 |
| `db:push` | `prisma db push` | 同步 Prisma schema 到数据库 |
| `start` | `next start -p 3456 -H 127.0.0.1` | 非 standalone 本地启动；当前 `output: "standalone"` 下不适合作为 Docker 启动方式 |
| `type-check` | `tsc --noEmit` | TypeScript 检查 |
| `lint` | `eslint .` | ESLint 检查 |
| `check:all` | `pnpm run type-check && pnpm run lint` | 推送前质量检查 |
| `db:check` | `node scripts/check-db-counts.cjs` | 数据库数量检查脚本 |
| `build-exe` | `electron-builder --win` | Electron Windows 打包 |
| `prepare` | `husky` | Husky hooks 安装 |

基础判断：

- 项目类型：Next.js App Router 应用。
- 前端框架：React 19 + Next.js 16.2.1。
- 后端形态：Next.js Server Actions + App Router Route Handler。
- 数据库 ORM：Prisma 6.19.0。
- 数据库类型：PostgreSQL。
- 是否 monorepo：不是多包 monorepo；存在 `pnpm-workspace.yaml`，但只声明 `packages: ["." ]`。
- 是否存在 Dockerfile：存在。
- 是否存在 GitHub Actions：存在 `.github/workflows/docker.yml`。

## 2. 技术栈判断

核心技术栈：

- Next.js `16.2.1`，`src/app` App Router。
- React `19.2.4`。
- TypeScript。
- Tailwind CSS 4。
- Prisma Client `6.19.0` + PostgreSQL。
- Server Actions：主要业务写在 `src/actions/*.ts`。
- Route Handlers：目前只有 `src/app/api/ai/status/route.ts`。
- 拖拽排产：`@hello-pangea/dnd`。
- 图表：`recharts`。
- 动画：`framer-motion`。
- 图标：`lucide-react`。
- Excel 导入/导出：`xlsx`。
- 表单/输入校验：`zod`。
- Toast：`react-hot-toast`。
- Docker 镜像：`node:20-alpine` 多阶段构建，Next standalone 输出。
- CI：GitHub Actions 构建并推送 GHCR 镜像。

注意：

- `next.config.ts` 配置了 `output: "standalone"`。
- App Router 错误兜底页已存在：`src/app/error.tsx`、`src/app/global-error.tsx`。
- 当前代码里有一些中文文本在 PowerShell 输出中显示为乱码，这是终端编码问题或源文件历史编码问题，不影响本次架构梳理，但后续 UI 文案整理时建议统一 UTF-8。

## 3. 目录结构

主要文件和目录：

| 路径 | 作用 |
|---|---|
| `src/app/` | Next.js App Router 页面、布局、错误页、API route |
| `src/app/page.tsx` | 线上主页面，对应 MES 看板主应用 |
| `src/app/login/page.tsx` | 登录页 |
| `src/app/api/ai/status/route.ts` | AI 配置检测接口 |
| `src/actions/` | Server Actions，承载数据库读写和 AI 调用 |
| `src/actions/mesActions.ts` | MES 核心订单、工人、日志、异常工时、产能审计等业务 action |
| `src/actions/aiSchedulerActions.ts` | AI 调度副驾 action，读取排单上下文并调用 DeepSeek |
| `src/actions/aiActions.ts` | 旧版/遗留 AI 自动排产 action，使用 SiliconFlow 兼容接口 |
| `src/components/` | 主看板、Header、Kanban、Workshop、Dashboard、Modal、AI 抽屉等组件 |
| `src/components/AiCopilotDrawer.tsx` | “发送给 AI 调度副驾”的抽屉组件 |
| `src/components/KanbanBoard.tsx` | 管理视图排产看板 |
| `src/components/WorkshopView.tsx` | 车间视图 |
| `src/components/ProductionAuditOverlay.tsx` | 生产审计/产能统计覆盖层 |
| `src/components/KpiReview.tsx` | KPI / 异常审批相关视图入口 |
| `src/lib/` | Prisma 单例、时间处理、映射、状态判断、RBAC 等工具 |
| `src/context/AuthContext.tsx` | 前端登录/角色上下文 |
| `src/types/` | 前端类型定义 |
| `prisma/schema.prisma` | Prisma schema，当前真实模型定义来源 |
| `prisma/manual_schema_postgresql.sql` | 旧手工建表 SQL，不包含最新 `MesAbnormalClaim` 表 |
| `scripts/` | 辅助脚本 |
| `.github/workflows/docker.yml` | Docker 构建并推送 GHCR workflow |
| `Dockerfile` | Docker 多阶段构建 |
| `entrypoint.sh` | 容器启动脚本，启动前执行 `prisma db push --accept-data-loss` |
| `main.js` | Electron 壳入口 |
| `_legacy_code/` | 旧代码存档，当前构建排除 |

不存在的目录：

- 根目录没有 `app/`、`pages/`、`components/`、`lib/`；实际代码在 `src/app`、`src/components`、`src/lib`。
- 没有 `prisma/migrations` 目录。

## 4. 页面与前端模块

页面清单：

| 页面路径 | 文件 | 功能 |
|---|---|---|
| `/` | `src/app/page.tsx` | 主 MES 应用：登录后根据角色显示管理看板、车间看板、Boss Dashboard、AI 副驾、生产审计、导入、清屏等 |
| `/login` | `src/app/login/page.tsx` | 登录页 |
| App segment error | `src/app/error.tsx` | App Router 页面级错误兜底 |
| Root global error | `src/app/global-error.tsx` | 根布局级错误兜底 |

主页面模块：

- `src/app/page.tsx`
  - `'use client'` 客户端组件。
  - 首次加载调用 `fetchInitialData()` 从 Server Action 读取订单、工人、活动日志、设置。
  - 维护 `orders`、`workers`、`dailyCapacity`、`theme`、`layoutMode`、`mainAppView` 等状态。
  - 管理 Excel 导入、新增订单、拖拽排产、AI 本地批量排产、清屏、生产审计、AI 副驾等入口。

核心前端组件：

| 组件 | 文件 | 功能 |
|---|---|---|
| `Header` | `src/components/Header.tsx` | 顶部工具栏，包含导入、视图切换、AI 智能排产、产能设置、清屏等按钮 |
| `KanbanBoard` | `src/components/KanbanBoard.tsx` | 管理视图排产看板，含就绪池和周一到周六列 |
| `WorkshopView` | `src/components/WorkshopView.tsx` | 车间执行视图，含工位/员工/箱号/异常操作 |
| `BossDashboard` | `src/components/BossDashboard.tsx` | Boss 大盘 |
| `ProductionAuditOverlay` | `src/components/ProductionAuditOverlay.tsx` | 生产审计与产能 KPI 分析 |
| `AiCopilotDrawer` | `src/components/AiCopilotDrawer.tsx` | 右下角 AI 调度副驾抽屉，自然语言输入、诊断输出、确认执行、Excel 导出 |
| `KpiReview` | `src/components/KpiReview.tsx` | 异常申诉/KPI 审核 |
| `Modals` / `WorkshopMESModals` | `src/components/Modals.tsx`、`src/components/mes/WorkshopMESModals.tsx` | 表单和车间弹窗 |

AI 排单相关入口：

1. “AI 智能排产”传统按钮：
   - 组件：`Header` 和 `KanbanBoard`。
   - 函数：`src/app/page.tsx` 的 `triggerBatchAISchedule()`。
   - 特点：当前主要是前端本地启发式排产算法，不调用 DeepSeek。

2. “发送给 AI 调度副驾”按钮：
   - 文件：`src/components/AiCopilotDrawer.tsx`。
   - 组件：`AiCopilotDrawer`。
   - 点击处理：`askCopilot()`。
   - 后端调用：直接调用 Server Action `interactWithAiCopilotAction(text, currentBaseLimit)`。
   - 注意：这不是 HTTP POST API route，而是 Next.js Server Action。

治具管理说明：

- 当前代码中没有独立的 “Fixture / Jig / Tooling” Prisma model 或单独页面。
- 现有系统更接近 “MES 订单/排产/车间执行/工时异常/看板管理”。
- 与治具相关的概念可能被混在 `boxNumber`、`drawing`、`materials`、`isDrawingReady`、`isMaterialReady`、`WorkshopView` 等字段/界面里，但没有明确独立治具管理模块。

## 5. API 路由清单

HTTP Route Handler 目前很少，大部分业务通过 Server Actions 暴露给客户端组件。

### HTTP API Route

| API 路径 | 文件位置 | 方法 | 作用 | 是否使用 Prisma | 是否使用 AI | 备注 |
|---|---|---|---|---|---|---|
| `/api/ai/status` | `src/app/api/ai/status/route.ts` | GET | 返回 AI/数据库配置是否齐备 | 否，仅检查环境变量名 | 否 | 返回 `configured`、`provider`、`model`、`missing`，不泄露密钥 |

### 重要 Server Actions（客户端直接调用，不是传统 REST API）

| 逻辑接口 | 文件位置 | 调用方 | 作用 | 是否使用 Prisma | 是否使用 AI | 备注 |
|---|---|---|---|---|---|---|
| `fetchInitialData()` | `src/actions/mesActions.ts` | `src/app/page.tsx` | 获取订单、员工、日志、设置 | 是 | 否 | 主页面初始化 |
| `createOrderAction()` | `src/actions/mesActions.ts` | 主页面/弹窗 | 新增订单 | 是 | 否 | 写 `Order` |
| `updateOrderAction()` | `src/actions/mesActions.ts` | 主页面/卡片/车间视图 | 更新单个订单 | 是 | 否 | 写 `Order` |
| `batchUpdateOrdersAction()` | `src/actions/mesActions.ts` | 主页面 | 批量更新订单 | 是 | 否 | 写 `Order` |
| `batchUpdateAssignedDaysAction()` | `src/actions/mesActions.ts` | 拖拽/排产 | 批量更新排产日 | 是 | 否 | 写 `Order.assignedDay` |
| `patchMesSettingsAction()` | `src/actions/mesActions.ts` | Header/主页面 | 更新产能、主题、布局 | 是 | 否 | 写 `MesAppSettings` |
| `createAbnormalClaimAction()` | `src/actions/mesActions.ts` | 车间/KPI 异常流程 | 创建异常工时申诉 | 是 | 否 | 写 `MesAbnormalClaim` |
| `approveAbnormalClaimAction()` | `src/actions/mesActions.ts` | KPI 异常审批 | 审批异常工时并累加订单工时 | 是 | 否 | 写 `MesAbnormalClaim`、`Order` |
| `fetchProductionAuditSummaryAction()` | `src/actions/mesActions.ts` | `ProductionAuditOverlay` | 生产审计汇总 | 是 | 否 | 聚合 `Order` |
| `interactWithAiCopilotAction()` | `src/actions/aiSchedulerActions.ts` | `AiCopilotDrawer` | 读取排单上下文并调用 DeepSeek | 是 | 是 | AI 调度副驾核心 |
| `executeAiCopilotMutationsAction()` | `src/actions/aiSchedulerActions.ts` | `AiCopilotDrawer` | 确认采纳 AI 建议后落库 | 是 | 否 | 更新 `Order`，插入 `MesAbnormalClaim` |
| `runDeepSeekScheduleAction()` | `src/actions/aiActions.ts` | 当前未在主页面直接引用 | 遗留 AI 自动排产 | 是 | 是 | 使用 SiliconFlow 兼容接口；属于旧路径 |

当前没有发现：

- `/api/ai/schedule` HTTP POST route。
- `/api/db/status`。
- 订单 CRUD HTTP API route。
- 缺料/异常/工人/产能 HTTP API route。

## 6. Prisma 数据库模型

Prisma datasource：

- provider：`postgresql`
- url：`env("DATABASE_URL")`

`npx prisma validate` 结果：schema 有效。
`npx prisma generate` 结果：Prisma Client 生成成功。

Model 清单：

| Model 名 | 对应数据库表 | 主要字段 | 关系 | 作用 |
|---|---|---|---|---|
| `Order` | `public."Order"` | `id`, `client`, `model`, `qty`, `totalHours`, `deliveryDate`, `assignedDay`, `taskStatus`, `cutStatus`, `boxNumber`, `worker`, `workerId`, `createdAt`, `totalQty`, `reportedQty`, `isUrgent`, `isDrawingReady`, `isMaterialReady`, `missingMaterialReason`, `missingMaterialEta`, `exceptionRemark`, `plannedDate`, `isArchived`, `deletedAt`, `updatedAt` | `workerId -> MesWorker.id`；`abnormalClaims -> MesAbnormalClaim[]` | 订单/工单/排产主表 |
| `MesWorker` | `public."MesWorker"` | `id`, `name`, `sortOrder` | `orders -> Order[]` | 车间员工/工位人员 |
| `MesActivityLog` | `public."MesActivityLog"` | `id`, `ts`, `text`, `operator`, `role`, `actionType` | 无 | 操作日志 |
| `MesAppSettings` | `public."MesAppSettings"` | `id`, `dailyCapacity`, `theme`, `layoutMode` | 无 | 全局设置，包含每日产能 |
| `MesAbnormalClaim` | `public."MesAbnormalClaim"` | `id`, `orderId`, `workerName`, `claimedHours`, `reason`, `status`, `createdAt` | `orderId -> Order.id` | 异常工时申诉/台账 |

重点模型存在性：

| 需求模型 | 当前状态 |
|---|---|
| `MesAbnormalClaim` | schema 中存在 |
| 订单相关模型 | `Order` 存在 |
| 排单相关模型 | 没有独立 `Schedule`；排单字段在 `Order.assignedDay`、`Order.plannedDate`、`Order.taskStatus` |
| 缺料相关模型 | 没有独立 `Material`；缺料字段在 `Order.materials`、`Order.isMaterialReady`、`Order.missingMaterialReason`、`Order.missingMaterialEta` |
| 设备相关模型 | 没有独立设备 model |
| 工时 / 产能相关模型 | `Order.totalHours`、`Order.reportedQty`、`MesAppSettings.dailyCapacity`、`MesAbnormalClaim.claimedHours` |
| AI 记录相关模型 | 没有独立 AI 调用记录表 |
| 治具相关模型 | 没有独立治具/夹具 model |

migrations 检查：

- `prisma/migrations` 目录不存在。
- 因此没有迁移文件创建 `MesAbnormalClaim` 表。
- `prisma/manual_schema_postgresql.sql` 是旧手工建表 SQL，只创建了 `Order`、`MesWorker`、`MesActivityLog`、`MesAppSettings`，没有 `MesAbnormalClaim`，也缺少 schema 中后来增加的一些字段风险。
- 当前线上缺表风险很高：代码和 Prisma schema 已经包含 `MesAbnormalClaim`，但线上 PostgreSQL 可能还停留在旧手工 SQL 或旧 schema。

## 7. 环境变量清单

只记录变量名和用途，不记录真实值。

| 环境变量名 | 用途 | 必填 | 使用位置 | 是否可公开 | 备注 |
|---|---|---|---|---|---|
| `DATABASE_URL` | PostgreSQL 连接字符串 | 是 | `prisma/schema.prisma`、Prisma runtime、Docker build ARG/ENV、entrypoint | 否 | Sealos 必须配置；本地 `.env` 存在该变量名 |
| `DEEPSEEK_API_KEY` | DeepSeek 官方 API Key | AI 副驾必填 | `src/actions/aiSchedulerActions.ts`、`src/actions/aiActions.ts`、`/api/ai/status` | 否 | 本地进程未检测到；`.env.example` 有占位；不要硬编码真实 key |
| `SILICONFLOW_MODEL` | 旧版 SiliconFlow AI 模型名覆盖 | 否 | `src/actions/aiActions.ts` | 可公开模型名，不可公开相关 key | 遗留 AI path 使用，主 AI 副驾不依赖 |
| `NODE_ENV` | Prisma 日志级别和生产/开发判断 | 否 | `src/lib/prisma.ts`、Docker runner ENV | 可公开 | Docker 设置为 `production` |
| `PORT` | Next standalone server 监听端口 | 否/部署需设置 | Dockerfile ENV | 可公开 | Docker 默认 `3000` |
| `HOSTNAME` | Next standalone server host | 否/部署需设置 | Dockerfile ENV | 可公开 | Docker 默认 `0.0.0.0` |
| `NEXT_TELEMETRY_DISABLED` | 关闭 Next telemetry | 否 | Dockerfile ENV | 可公开 | Docker runner 设置为 `1` |
| `OPENAI_API_KEY` | 未在当前代码实际使用 | 否 | 未发现使用 | 否 | 不需要配置，除非后续新增 OpenAI |
| `GEMINI_API_KEY` | 未在当前代码实际使用 | 否 | 未发现使用 | 否 | 不需要配置，除非后续新增 Gemini |
| `AI_BASE_URL` | 未在当前代码实际使用 | 否 | 未发现使用 | 取决于值 | 当前不用 |
| `AI_MODEL` | 未在当前代码实际使用 | 否 | 未发现使用 | 可公开模型名 | 当前不用 |
| `NEXT_PUBLIC_*` | 未发现实际使用 | 否 | 未发现使用 | 是，但仍需谨慎 | 当前没有必须项 |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL` | 依赖中有 `next-auth`，但当前未发现实际使用 | 否 | 未发现使用 | 否 | 当前登录逻辑主要在前端 AuthContext |

## 8. AI 排单完整调用链路

### 8.1 “发送给 AI 调度副驾”按钮

- 文件：`src/components/AiCopilotDrawer.tsx`
- 组件名：`AiCopilotDrawer`
- 按钮文本：`发送给 AI 调度副驾`
- 点击函数：`askCopilot()`
- 调用函数：`interactWithAiCopilotAction(text, currentBaseLimit)`
- 调用方式：Next.js Server Action，不是普通 `fetch('/api/...')`

### 8.2 AI 副驾 Server Action

- 文件：`src/actions/aiSchedulerActions.ts`
- 主函数：`interactWithAiCopilotAction(userPrompt, currentBaseLimit)`
- 请求参数：
  - `userPrompt`: 用户自然语言指令
  - `currentBaseLimit`: 当前每日产能基准（分钟）
- 返回结构：
  - `ok: boolean`
  - `error?: string`
  - `data?: { reply, unreasonableAlerts, proposedMutations, exportDataSummary }`
  - `rawModelPreview?: string`
- AI Provider：DeepSeek 官方接口
- Base URL：`https://api.deepseek.com/chat/completions`
- 模型名：常量 `deepseek-chat`
- 鉴权：读取 `process.env.DEEPSEEK_API_KEY`
- JSON 约束：请求 body 包含 `response_format: { type: "json_object" }`

### 8.3 AI 排单上下文读取逻辑

`buildSchedulerContext(currentBaseLimit)` 会查询：

1. `prisma.order.findMany()`
   - 读取待排产/已排产有效订单。
   - 条件：`deletedAt: null`、`isArchived: false`、`taskStatus` in `normal/PENDING/SCHEDULED/IN_PROGRESS/PAUSED/anomaly/Rework`。
   - 字段包括：`id`, `model`, `client`, `plannedDate`, `assignedDay`, `deliveryDate`, `totalQty`, `reportedQty`, `qty`, `totalHours`, `taskStatus`, `isUrgent`, `isMaterialReady`, `isDrawingReady`。

2. `prisma.mesAbnormalClaim.findMany()`
   - 读取最新 100 条异常工时台账。
   - 字段包括：`id`, `orderId`, `workerName`, `claimedHours`, `reason`, `status`, `createdAt`, `order.model`。

上下文包含的数据：

| 数据 | 当前来源 | 是否真实数据库 |
|---|---|---|
| 订单 | `Order` 表 | 是 |
| 排产日 | `Order.assignedDay`、`Order.plannedDate` | 是 |
| 交期 | `Order.deliveryDate` | 是 |
| 工时 | `Order.totalHours`，计算为 `planMinutes` | 是 |
| 实际数量 | `Order.reportedQty` | 是 |
| 总数量 | `Order.totalQty` 或 `Order.qty` | 是 |
| 单件工时 | `planMinutes / totalQuantity` 计算 | 派生 |
| 缺料状态 | `Order.isMaterialReady`、`missingMaterialReason` 等部分字段 | 部分读取；AI 上下文当前只读 `isMaterialReady` |
| 图纸状态 | `Order.isDrawingReady` | 是 |
| 异常工时 | `MesAbnormalClaim` | 是，但线上可能缺表 |
| 每日产能 | 前端传入 `currentBaseLimit`；来源通常是 `MesAppSettings.dailyCapacity` | 是 |
| 设备 | 无独立表 | 否 |
| 人员 | `MesWorker` 存在，但 AI 上下文当前不读取 | 部分未接入 |
| AI 调用记录 | 无表 | 否 |

### 8.4 AI 返回后的前端行为

`AiCopilotDrawer` 展示：

- `reply`：AI 对话回应。
- `unreasonableAlerts`：合理性审查警报。
- `proposedMutations`：若存在，显示“确认采纳 AI 建议并刷新车间”。
- `exportDataSummary`：若存在，使用 `xlsx` 导出 Excel。

确认采纳时：

- 前端调用 `executeAiCopilotMutationsAction(diagnosis.proposedMutations)`。
- 支持的 mutation：
  - `UPDATE_ORDER_DATE`：更新 `Order.plannedDate`、`assignedDay`、`taskStatus`。
  - `UPDATE_DELIVERY_DATE`：更新 `Order.deliveryDate`。
  - `LOG_EXCEPTION_HOUR`：插入 `MesAbnormalClaim`，状态为 `APPROVED`。

### 8.5 文字版链路图

```text
用户点击右下角 AI 副驾按钮
→ src/components/AiCopilotDrawer.tsx 打开抽屉
→ 用户输入自然语言
→ 点击“发送给 AI 调度副驾”
→ askCopilot()
→ interactWithAiCopilotAction(userPrompt, currentBaseLimit) [Server Action]
→ buildSchedulerContext()
→ prisma.order.findMany()
→ prisma.mesAbnormalClaim.findMany()
→ 组装紧凑 JSON 上下文
→ fetch DeepSeek chat completions
→ response_format 强制 json_object
→ 解析 JSON
→ 返回 { reply, unreasonableAlerts, proposedMutations, exportDataSummary }
→ AiCopilotDrawer 展示回复、预警、导出按钮、确认执行按钮
→ 用户点击确认采纳
→ executeAiCopilotMutationsAction()
→ prisma.order.updateMany() / prisma.mesAbnormalClaim.create()
→ revalidatePath("/")
→ 前端 onApplied 调用 handleSyncRefresh()
→ fetchInitialData()
→ 页面刷新当前车间/排产数据
```

### 8.6 旧版 AI 排产链路

`src/actions/aiActions.ts` 中存在 `runDeepSeekScheduleAction()`：

- 使用 `SILICONFLOW_CHAT_URL = https://api.siliconflow.cn/v1/chat/completions`。
- 使用 `DEEPSEEK_API_KEY` 和 `SILICONFLOW_MODEL`。
- 读取 `Order` 中 `PENDING/PAUSED` 订单。
- 让模型返回 `assignments`，然后更新订单 `assignedDay/taskStatus/plannedDate`。
- 当前主页面没有直接引用该函数；它应视为遗留/备用路径，后续可以清理或迁移到 DeepSeek 官方接口。

## 9. 当前线上错误分析

线上错误：

```text
Invalid `prisma.mesAbnormalClaim.findMany()` invocation:
The table `public.MesAbnormalClaim` does not exist in the current database.
```

定位：

- 文件路径：`src/actions/aiSchedulerActions.ts`
- 函数名：`buildSchedulerContext(currentBaseLimit)`
- 具体查询：`prisma.mesAbnormalClaim.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: ... })`
- 调用者：`interactWithAiCopilotAction(userPrompt, currentBaseLimit)`
- 前端触发：`src/components/AiCopilotDrawer.tsx` 的 `askCopilot()`

为什么会查 `MesAbnormalClaim`：

- AI 副驾需要把“异常工时台账”作为调度上下文提供给模型。
- 这用于判断真实产能占用、异常停工、以及自然语言“记录异常工时”的落地动作。

schema 与数据库状态：

- `schema.prisma` 中存在 `MesAbnormalClaim` model。
- `Order` model 中也有 `abnormalClaims MesAbnormalClaim[]` 关系。
- 仓库没有 `prisma/migrations` 目录。
- `prisma/manual_schema_postgresql.sql` 不包含 `MesAbnormalClaim` 表。
- 因此线上数据库很可能没有同步到当前 schema。

该查询失败后的容错状态：

- 最新提交 `9c56ed4` 已把 `buildSchedulerContext()` 包进 try/catch。
- 现在 Prisma 查询失败应返回可读错误对象，而不是继续抛出导致 Server Components render 崩溃。
- 前端 `AiCopilotDrawer` 也增加了 `errorMessage` 状态和 try/catch。
- 但根本问题仍然是数据库缺表，需要修复数据库 schema。

是否会导致整个页面崩溃：

- 修复前：会。因为 `buildSchedulerContext()` 在主 try/catch 之前执行，缺表异常会冒泡到 server action/RSC 层。
- 修复后：理论上不会，应该在 AI 抽屉内显示可读错误。

是否应该增加数据库状态检查：

- 应该。建议新增 `/api/db/status`，检查：
  - 是否能连接 `DATABASE_URL`。
  - `Order`、`MesWorker`、`MesActivityLog`、`MesAppSettings`、`MesAbnormalClaim` 表是否存在。
  - 不返回任何连接串或密码。

是否应该增加 AI 排单容错：

- 已增加第一层容错，但还建议进一步降级：如果 `MesAbnormalClaim` 缺表，可以先只读取 `Order` 并返回“异常台账不可用”的 alert，而不是完全阻断 AI 上下文。

## 10. Docker 构建流程

Dockerfile 概要：

```dockerfile
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

FROM base AS builder
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* .npmrc* ./
RUN npm install -g pnpm@9.15.0
RUN pnpm install --no-frozen-lockfile
COPY . .
ARG DATABASE_URL=postgresql://postgres:placeholder@localhost:5432/postgres
ENV DATABASE_URL=${DATABASE_URL}
RUN pnpm exec prisma generate
RUN pnpm exec next build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
...
ENTRYPOINT ["./entrypoint.sh"]
```

构建流程：

1. 使用 `node:20-alpine`。
2. 安装 `libc6-compat` 和 `openssl`。
3. 复制 package/lock/workspace 配置。
4. 使用 `npm install -g pnpm@9.15.0`，不使用 corepack。
5. 执行 `pnpm install --no-frozen-lockfile`。
6. 复制全量代码。
7. 设置 build ARG `DATABASE_URL` 默认占位值。
8. 执行 `pnpm exec prisma generate`。
9. 执行 `pnpm exec next build`。
10. runner 阶段复制 `.next/standalone`、`.next/static`、`public`、`prisma`、`node_modules`。
11. 使用 `entrypoint.sh` 启动。

容器启动命令：

```sh
node ./node_modules/prisma/build/index.js db push --accept-data-loss
exec node server.js
```

风险：

- Docker build 阶段不应该写真实数据库，目前 build ARG 默认占位，`prisma generate` 不写库，`next build` 理论上也不应写库。
- 容器启动阶段会执行 `prisma db push --accept-data-loss`，会直接修改目标数据库 schema；这可以自动补表，但也有数据结构风险。
- 如果 Sealos runtime 没有正确注入 `DATABASE_URL`，或远端 PostgreSQL 权限/状态异常，启动阶段 db push 会失败，导致表仍不同步。

## 11. GitHub Actions 流程

workflow 文件：`.github/workflows/docker.yml`

触发条件：

- push 到 `main`。

权限：

- `contents: read`
- `packages: write`

主要步骤：

1. Checkout。
2. 登录 GitHub Container Registry。
3. 使用 `docker/build-push-action@v6` 构建并推送镜像：
   - context：`.`
   - Dockerfile：`./Dockerfile`
   - push：`true`
   - tag：`ghcr.io/gy3117577403-ai/mes-system:latest`

不包含的步骤：

- 没有显式部署到 Sealos。
- 没有执行 `prisma migrate deploy`。
- 没有执行数据库连通性检查。
- 没有执行 `/api/ai/status` 或 DB status 健康检查。

## 12. Sealos 部署要求

必须配置：

- `DATABASE_URL`：PostgreSQL 连接字符串，必须指向线上数据库。
- `DEEPSEEK_API_KEY`：AI 调度副驾需要。

建议配置/确认：

- `NODE_ENV=production`：Dockerfile 已设置。
- `PORT=3000`：Dockerfile 已设置。
- `HOSTNAME=0.0.0.0`：Dockerfile 已设置。

Sealos 当前是否会自动迁移数据库：

- 容器启动时会执行 `prisma db push --accept-data-loss`。
- 这不是 Prisma migration 管理，而是直接按 schema 推送数据库结构。
- 如果该命令成功，理论上会创建 `MesAbnormalClaim`。
- 如果该命令失败、没执行、权限不足、`DATABASE_URL` 错误或服务端异常，则线上数据库不会同步，AI 排单仍可能缺表。

已观察到的本地数据库同步风险：

- 本地执行 `npx prisma db push` 曾遇到远端 PostgreSQL 服务端错误：`could not open file "../pg_log/postgresql-0.csv"`。
- 这不是代码语法错误，而是数据库服务端文件/权限/日志相关异常。
- 如果 Sealos 同一数据库也存在该异常，entrypoint 的 db push 可能失败。

## 13. 当前风险点

1. `MesAbnormalClaim` schema 与线上数据库不同步
   - schema 有表，migration 没有，手工 SQL 没有。
   - 线上报错已经指向缺表。

2. 没有正式 migrations
   - 当前依赖 `prisma db push --accept-data-loss` 自动改库。
   - 这对生产系统风险较高。

3. entrypoint 每次启动都执行 `db push --accept-data-loss`
   - 可以快速补表，但可能在生产环境造成不可控 schema 变更。
   - 建议改成 migration deploy 或显式一次性迁移任务。

4. AI 上下文对 `MesAbnormalClaim` 强依赖
   - 表缺失会导致 AI 上下文读取失败。
   - 最新代码已防止白屏，但 AI 仍无法拿到完整上下文。

5. 旧版 AI action 仍在仓库
   - `src/actions/aiActions.ts` 仍使用 SiliconFlow URL。
   - 主流程不一定调用，但后续维护容易混淆。

6. 没有 `/api/db/status`
   - 线上无法快速判断 DB 连接、表存在性、schema 版本。

7. 没有 AI 调用日志表
   - 生产问题难追踪：不知道输入上下文、模型响应、失败类型和耗时。

8. 治具管理不是独立模块
   - 如果产品目标包含治具管理，需要新增明确数据模型和页面，而不是继续混在订单字段里。

## 14. 建议后续修复顺序

### P0

- 修复数据库迁移 / `MesAbnormalClaim` 缺表：
  - 优先确认 Sealos 容器启动日志中 `prisma db push --accept-data-loss` 是否成功。
  - 在安全备份后，执行一次受控的 `prisma db push` 或正式 migration。
  - 建议生成并纳入 `prisma/migrations`，不要长期依赖手工 SQL。
- 检查 Sealos `DATABASE_URL`：
  - 确认变量存在、指向正确数据库、用户有建表/改表权限。
  - 不要在日志或文档输出真实连接串。
- 保持 AI 排单接口 try/catch：
  - 最新代码已补，后续不要回退。
- 防止 Server Component 整页崩溃：
  - 保留 `src/app/error.tsx`、`src/app/global-error.tsx`。
  - 所有 Server Action 的预期错误都返回结构化对象，不 throw 给页面。

### P1

- 新增 `/api/db/status`：
  - 返回 `connected`、`missingTables`、`provider`、`schemaStatus`。
  - 检查 `Order`、`MesWorker`、`MesActivityLog`、`MesAppSettings`、`MesAbnormalClaim`。
- 完善 `/api/ai/status`：
  - 可选增加 DeepSeek endpoint/model 配置项，但不要泄露 key。
- AI 排单上下文缺失时降级：
  - 如果异常工时表缺失，仍允许仅基于订单上下文出诊断，并在 `unreasonableAlerts` 中提示“异常工时台账不可用”。
- 前端错误提示优化：
  - 抽屉中区分“AI 未配置”“数据库缺表”“模型返回异常”“网络失败”。

### P2

- Docker 启动脚本规范化：
  - 将生产迁移从 `db push --accept-data-loss` 改为 `prisma migrate deploy`。
  - 或拆成一次性迁移 Job。
- migration 管理规范：
  - 创建 `prisma/migrations`。
  - 对 `MesAbnormalClaim` 和新增字段生成正式 migration。
- GitHub Actions 加 migration 检查：
  - `npx prisma validate`
  - `npx prisma generate`
  - 可选 migration diff 检查。
- 增加日志与诊断面板：
  - AI 请求耗时、失败原因、上下文大小、模型名。
  - DB 表存在性和 schema 版本。

## 15. 需要人工确认的问题

1. Sealos 当前运行的镜像是否已经是 `ghcr.io/gy3117577403-ai/mes-system:latest` 的最新 digest？
2. Sealos 容器启动日志中 `prisma db push --accept-data-loss` 是否成功？
3. 线上 `DATABASE_URL` 指向的数据库是否就是用户访问域名所使用的同一个库？
4. 线上 PostgreSQL 用户是否有 `CREATE TABLE`、`ALTER TABLE`、`CREATE INDEX`、外键创建权限？
5. 是否允许在生产库直接执行 `prisma db push --accept-data-loss`？如果不允许，应立即改为 migration deploy。
6. `MesAbnormalClaim` 缺表是否只发生在线上，还是本地 `.env` 指向的同一远端库也缺？
7. 治具管理是否要独立建模，例如 `Fixture`、`FixtureUsage`、`MaintenanceRecord`，还是继续作为订单字段/箱号处理？
8. 旧版 `src/actions/aiActions.ts` 是否仍有入口使用？如果没有，应在后续清理，避免双 AI 网关混淆。
9. DeepSeek API Key 是否已经在 Sealos 环境变量中配置？当前文档不记录真实值，只需确认存在。
10. 是否需要保存 AI 调度记录以满足审计要求？
