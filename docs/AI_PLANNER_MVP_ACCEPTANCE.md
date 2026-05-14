# AI 计划员工 MVP 验收说明

## 1. 当前能力

- 页面上下文读取：AI 工作台会把当前主视图、任务、已加载订单摘要、ready-flags 状态和 AI 审计状态传给后端分析。
- 计划任务：内置每日排产体检、风险订单扫描、可排产订单推荐、不可排产原因归类、AI 主动问题清单。
- plannerReport：AI 返回结构化计划员结论、优先动作、阻塞归类和需要人工确认的问题。
- 待办卡片：priorityActions、questionsForHuman、blockedGroups 会转成本地待办，支持待处理、已处理、已忽略。
- 日报：可基于 plannerReport、contextSummary、待办和页面上下文生成可复制、可下载的 Markdown 日报。
- 一键晨检：一键执行每日排产体检，并自动生成待办和日报草稿。
- 右下角入口：AI 计划员只通过右下角悬浮入口打开，不占用主看板主体空间。
- ready-flags baseline/delta：新导入数据使用导入前基线和导入后 delta 检查，历史遗留 mismatch 不作为本次导入失败依据。

## 2. 每日使用流程

1. 打开系统。
2. 点击右下角 AI 计划员悬浮入口。
3. 在“晨检”页点击“开始今日晨检”。
4. 在“待办”页查看 AI 计划员待办。
5. 复制跟进话术给技术、仓库或主管。
6. 在“日报”页生成或复制 AI 计划员日报。
7. 在“建议执行”页人工判断 proposedMutations，确认无误后再执行。

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
- AI 不绕过图纸和物料硬规则。
- 待办不修改订单。
- 日报不修改订单。
- 一键晨检不执行 mutation。
- proposedMutations 必须人工确认。
- 后端执行仍校验 `canEnterSchedule`。

## 5. 检查命令

```bash
pnpm check:ai-planner
pnpm check:ai-planner-mvp
pnpm check:ai-ui-cleanup
pnpm check:schedule-guard
pnpm check:ready-flag-normalization
pnpm test:ready-flag-normalization
pnpm ready-flags:baseline
pnpm check:ready-flags:delta
```

## 6. UI 清理验收

- 主界面订单卡片默认不显示 ready debug、eligible、reasons 等调试信息。
- AI 计划员不再以大面积状态卡占用主页面，只保留右下角悬浮入口。
- AI 工作台按“晨检 / 任务 / 待办 / 日报 / 建议执行 / 诊断”分组。
- 正式界面不直接展示英文枚举、长 UUID 列表或原始 JSON。
- 技术诊断信息放在“诊断”页，并以中文业务文案说明。

## 7. 已知限制

- AI 审计表未部署时，历史任务不会持久化。
- 当前待办、日报、晨检结果主要存 localStorage。
- 历史 ready-flags 不处理。
- 设备、班次、详细工序路线仍未建模。
- AI 不能替代人工最终确认。
