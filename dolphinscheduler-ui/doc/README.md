# DolphinScheduler 与阿里云 DataStudio：对比与改造文档

本目录包含针对 Apache DolphinScheduler（重点为 `dolphinscheduler-ui` 前端）与阿里云 DataWorks DataStudio 的产品对比，以及将本项目改造为 DataStudio 风格数据开发平台的完整落地方案。

## 文档索引

| 文档 | 内容 | 适合读者 |
| --- | --- | --- |
| [01-产品对比-DolphinScheduler-vs-阿里云DataStudio.md](./01-产品对比-DolphinScheduler-vs-阿里云DataStudio.md) | 两个产品的定位、架构、功能矩阵、核心差异详解，以及基于 `dolphinscheduler-ui` 源码的现状盘点 | 产品经理、架构师、新成员 |
| [02-改造方案-从DolphinScheduler到DataStudio.md](./02-改造方案-从DolphinScheduler到DataStudio.md) | 三阶段改造路线图（IDE 化 → 调度增强 → 数据平台能力），含 UI/后端/数据模型详细技术方案、API 清单、里程碑与风险 | 前端/后端研发、技术负责人 |
| [03-阶段一功能开发文档-Studio数据开发IDE.md](./03-阶段一功能开发文档-Studio数据开发IDE.md) | 阶段一细化开发规格：菜单/路由接入、目录树（根=项目名、标签=目录）、DAG/节点编辑 Tab、运行日志、临时查询，全部基于现有 API（0 后端改动），含任务拆分与验收标准 | 实施 AI、前端研发 |

## 一句话结论

- **DolphinScheduler** 是一个**分布式工作流调度系统**：以 DAG 画布拖拽编排为中心，解决"任务怎么按时跑起来"的问题。
- **DataStudio** 是一个**一站式智能数据开发平台**（DataWorks 的数据开发模块）：以代码编辑与数据治理为中心，解决"数据怎么被开发、管理、治理"的问题。
- 两者在"调度执行"上能力相近，但在**开发体验（IDE）、调度模型（节点级）、数据治理（元数据/建模/质量/地图）**上差距显著；改造需保留 DS 的调度内核，重点重构 UI 交互范式并补齐数据平台能力。

## 信息来源说明

- DolphinScheduler 部分：基于本仓库源码（`dolphinscheduler-ui`、`dolphinscheduler-api`、`dolphinscheduler-master` 等）实际盘点。
- DataStudio 部分：基于阿里云官方帮助文档（`help.aliyun.com` / DataWorks「新版数据开发概述」等公开页面，检索于 2026-09）。DataStudio 为闭源商业产品，本文档仅参考其**公开的产品形态与交互范式**，不涉及对其内部实现的复刻。
