# AI 计划员工 MVP 验收说明

## 1. 当前能力

- 页面上下文读取：AI 工作台会把当前主视图、任务、已加载订单摘要、ready-flags 状态和 AI 审计状态传给后端分析。
- 计划任务：已内置每日排产体检、风险订单扫描、可排产订单推荐、不可排产原因归类、AI 主动问题清单。
- plannerReport：AI 返回结构化计划员结论、优先动作、阻塞归类和需要人工确认的问题。
- 主动问题：questionsForHuman 会展示为待主管确认事项。
- 待办卡片：priorityActions、questionsForHuman、blockedGroups 会转换为本地待办，支持 PENDING / DONE / IGNORED。
- 日报：可基于 plannerReport、contextSummary、待办和页面上下文生成可复制、可下载的 Markdown 日报。
- 一键晨检：一键执行每日排产体检，并自动生成待办和日报草稿。
- 状态卡：主页面显示 AI 计划员工状态、待办数量、MUST 数量、日报和晨检状态。
- ready-flags baseline/delta：新导入数据使用导入前基线和导入后 delta 检查，不把历史遗留 mismatch 当作本次导入失败。

## 2. 每日使用流程

1. 打开系统。
2. 点击主页面的 AI 计划员工状态卡。
3. 点击“AI 计划员一键晨检”。
4. 查看 AI 计划员待办。
5. 复制跟进话术给技术、仓库或主管。
6. 生成或复制 AI 计划员日报。
7. 对 proposedMutations 进行人工判断，确认无误后再在人工确认执行区执行。

## 3. 导入 Excel 前后验收

导入前生成基线：

```bash
pnpm ready-flags:baseline
```

导入 Excel 后检查增量：

```bash
pnpm check:ready-flags:delta
```

`ok: true` 表示没有新增 ready flag mismatch。历史遗留 mismatch 不作为本次导入失败依据。

## 4. 安全边界

- AI 不自动排产。
- AI 不绕过图纸/物料硬规则。
- 待办不修改订单。
- 日报不修改订单。
- 一键晨检不执行 mutation。
- proposedMutations 必须人工确认。
- 后端执行仍校验 `canEnterSchedule`。

## 5. 检查命令

```bash
pnpm check:ai-planner
pnpm check:ai-planner-mvp
pnpm check:schedule-guard
pnpm check:ready-flag-normalization
pnpm test:ready-flag-normalization
pnpm ready-flags:baseline
pnpm check:ready-flags:delta
```

## 6. 已知限制

- AI 审计表未部署时，历史任务不会持久化。
- 当前待办、日报、晨检结果主要存 localStorage。
- 历史 ready-flags 不处理。
- 设备、班次、详细工序路线仍未建模。
- AI 不能替代人工最终确认。
