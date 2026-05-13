# 新导入数据 ready flag 验收流程

## 使用场景

历史数据暂不处理，只验证新导入或新编辑的数据是否产生状态不一致。

## 导入前

```bash
pnpm ready-flags:baseline
```

该命令只读数据库，生成 `tmp/ready-flag-baseline.json`。基线文件只用于本地导入验收，不要提交。

## 导入 Excel 或新增/编辑订单

按正常业务流程导入 Excel、创建订单或编辑订单。系统写入入口会自动归一化 `drawing/materials` 文本和 `isDrawingReady/isMaterialReady` 布尔字段。

## 导入后

```bash
pnpm check:ready-flags:delta
```

## 结果解释

- `ok:true`：没有新增状态不一致。
- `ok:false`：导入后产生了新的 mismatch，或历史 mismatch 的签名发生变化，需要检查导入/编辑入口。
- baseline 文件在 `tmp/`，不要提交。

## 时间窗口检查

```bash
pnpm check:ready-flags:new
```

这个命令仍保留，用于按更新时间窗口检查。但如果历史数据最近被批量触碰，它可能因为历史更新时间窗口内的既有问题失败。

## 最近 1 小时检查

PowerShell：

```powershell
$env:READY_FLAG_CHECK_SINCE_HOURS="1"; pnpm check:ready-flags:new
```

bash：

```bash
READY_FLAG_CHECK_SINCE_HOURS=1 pnpm check:ready-flags:new
```
