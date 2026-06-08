# 监控与评估系统 (Seraph)

## 概述

Seraph（炽天使）是 s-forge 的监控、评估和治疗系统，位于 `kernel/nerv/seraph/`。它是 MAGI 系统的"超我"层，负责监督其他 Agent 的行为和输出质量。

## 核心功能

### 1. AT 力场 (ATF) 监控

命名来源：EVA 中的 AT 力场 (Absolute Terror Field) — 心之壁

| 组件 | 文件 | 功能 |
|------|------|------|
| ATF 基线 | `atf_baseline.go` | 建立行为基线，检测偏差 |
| ATF 回答器 | `atf_answerer.go` | 评估回答质量和安全性 |
| ATF 连贯性 | `atf_coherence.go` | 检查逻辑连贯性 |
| ATF EMA | `atf_ema.go` | 指数移动平均平滑监控 |
| ATF 实时 | `atf_live_test.go` | 实时监控 |
| ATF 监控器 | `atf_monitor.go` | 持续监控 Agent 行为 |
| ATF 相似度 | `atf_similarity.go` | 检测响应相似度 |
| ATF 强度 | `atf_strength.go` | ATF 强度计算 |
| ATF 风格 | `atf_style.go` | 评估输出风格一致性 |
| ATF 消融 | `atf_ablation_test.go` | 消融实验测试 |

### 2. 评分系统

| 组件 | 功能 |
|------|------|
| `scoring.go` | IPIP-NEO-120 问卷计分 |
| `sampler.go` | 回答采样 |
| `validation.go` | 数据验证 |
| `formula_validation.go` | 公式验证 |

### 3. 治疗系统

| 组件 | 功能 |
|------|------|
| `therapist.go` | Agent 行为修正和调整 |
| `therapist_prompt.go` | 治疗用提示词 |

### 4. 题库和校准

| 组件 | 功能 |
|------|------|
| `question_bank.go` | 问卷调查题库 |
| `threshold_calibration.go` | 阈值校准 |
| `alignment_test.go` | 对齐测试 |

## ATF 监控工作流

```
Agent 响应生成
    ↓
ATF 监控器捕获
    ├── 基线检测 (atf_baseline)
    ├── 风格一致性 (atf_style)
    ├── 逻辑连贯性 (atf_coherence)
    ├── 回答质量 (atf_answerer)
    └── 安全审查
    ↓
异常 → 触发治疗流程
正常 → 放行
```

## 评分系统工作流

```
IPIP-NEO-120 问卷 (120题)
    ↓
计分累加 (ScoringAccumulation)
    ├── 维度求和 (5 维度)
    ├── 子维度求和 (30 子维度)
    └── 方向处理 (正向/反向计分)
    ↓
人格基底 (PersonaBase)
    ├── O/C/E/A/N 分数
    └── 30 个子维度分数
```

## 与 s-code 的对应

| Seraph 能力 | s-code 对应 |
|------------|-------------|
| ATF 监控 | 内容过滤系统 (content-filter) |
| 评分系统 | Permission 审核 |
| 治疗系统 | 错误恢复 (error recovery) |
| 校准 | 模型调参 |
| 风格检测 | 无直接对应 |
| 连贯性检查 | 无直接对应 |
