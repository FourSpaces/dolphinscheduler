# 产品对比：Apache DolphinScheduler vs 阿里云 DataStudio

> 信息来源：DolphinScheduler 部分基于本仓库源码盘点；DataStudio 部分基于阿里云官方公开文档（DataWorks「新版数据开发概述」等，检索于 2026-09）。

## 1. 产品定位

| 维度 | Apache DolphinScheduler | 阿里云 DataStudio（DataWorks 新版数据开发） |
| --- | --- | --- |
| 一句话定位 | 分布式、易扩展的**可视化 DAG 工作流调度系统** | 阿里巴巴基于 15 年大数据经验打造的**智能湖仓一体数据开发平台** |
| 解决的核心问题 | "任务怎么按时、按依赖、可靠地跑起来" | "数据怎么被开发、编排、治理、共享" |
| 所属生态 | Apache 开源顶级项目，多云、自建部署 | 阿里云 DataWorks 的核心模块，深度绑定阿里云计算服务 |
| 商业模式 | 开源免费（Apache-2.0），商业版由各厂商提供 | 闭源商业产品，按版本（基础/标准/专业/企业）与资源规格计费 |
| 典型用户 | 数据平台团队、需要自建调度与任务编排的团队 | 使用 MaxCompute/Hologres/EMR/Flink/PAI 等阿里云引擎的团队 |

**本质区别**：DolphinScheduler 是"调度器"（Scheduler），DataStudio 是"数据开发平台 + 调度器"（Data Platform）。前者以**工作流 DAG** 为一等公民，后者以**数据节点/脚本** 为一等公民，调度只是节点的一项属性。

## 2. 整体架构对比

### 2.1 DolphinScheduler 架构（本仓库源码视角）

```
┌─────────────────────────────────────────────────────────────┐
│ dolphinscheduler-ui (Vue3 + TS + Naive UI + X6 + Monaco)     │
│   工作流定义/实例、任务定义/实例、DAG 画布、资源中心、       │
│   数据源中心、监控中心、安全中心                              │
└────────────────────────────┬────────────────────────────────┘
                             │ REST
┌────────────────────────────▼────────────────────────────────┐
│ dolphinscheduler-api (Spring Boot)                           │
│   33 类 REST 服务：workflow-definition、task-definition、    │
│   schedules、lineages、data-source、resources、audit 等     │
└──────┬───────────────────────────────────────────────────────┘
       │
┌──────▼──────┐   ┌──────────────┐   ┌─────────────────────────┐
│   master    │◄──│ registry(ZK) │──►│ worker                  │
│ DAG 解析/调度 │   └──────────────┘   │ task-executor          │
└──────┬──────┘                      │  └─ task-plugin (37 种) │
       │ 容错/failover                │     shell/sql/spark/    │
┌──────▼──────────────────────────────│     flink/datax/...    │
│ dolphinscheduler-dao (MySQL/PG)     └─────────────────────────┘
└─────────────────────────────────────┘
```

关键事实（源码盘点）：

- 前端技术栈：`Vue 3.4 + TypeScript + Naive UI 2.33 + Pinia + vue-router + vue-i18n`，DAG 画布基于 `@antv/x6`，代码编辑基于 `monaco-editor 0.50`，构建工具 `Vite 6`。
- 任务插件 37 种：`src/views/projects/task/components/node/tasks/` 下含 shell、sql、spark、flink、flink-stream、python、mr、datax、datasync、sea-tunnel、sqoop、http、grpc、procedure、sub-workflow、dependent、conditions、switch、emr、emr-serverless、aliyun-serverless-spark、dms、dinky、linkis、mlflow、sagemaker、kubeflow、jupyter、zeppelin、openmldb、hive-cli、remote-shell、java、k8s、dvc、data-factory、chunjun 等。
- 后端模块：`dolphinscheduler-api`（REST）、`master`（DAG 调度）、`worker`/`task-executor`（执行）、`task-plugin`（任务插件）、`datasource-plugin`（多引擎数据源）、`storage-plugin`（资源存储）、`alert`（告警）、`registry`（注册中心）、`scheduler-plugin`（定时调度）、`extract`、`meter`、`auth` 等。
- 已有血缘接口雏形：`src/service/modules/lineages/`。

### 2.2 DataStudio 架构（官方公开信息）

```
┌────────────────────────────────────────────────────────────┐
│ DataStudio（Web IDE 形态）                                  │
│  ┌──────────┐ ┌────────────────────┐ ┌───────────────────┐  │
│  │ 数据目录  │ │ Workflow / 节点编辑 │ │ Notebook          │  │
│  │ (元数据)  │ │ (智能 SQL 编辑器)    │ │ (交互式分析)      │  │
│  └──────────┘ └────────────────────┘ └───────────────────┘  │
├────────────────────────────────────────────────────────────┤
│ 调度体系：定时/事件/外部触发 · 同周期/跨周期依赖 · 补数据    │
├────────────────────────────────────────────────────────────┤
│ DataWorks 全家桶：数据集成 · 数据建模 · 数据质量 ·          │
│ 数据地图 · 数据服务 · 运维中心 · 数据保护伞 · 治理中心      │
├────────────────────────────────────────────────────────────┤
│ 阿里云计算引擎：MaxCompute · Hologres · EMR · Flink ·       │
│ PAI · ADB · StarRocks · OSS/NAS 存储                        │
└────────────────────────────────────────────────────────────┘
```

四大基础能力（官方口径）：**数据目录**（湖仓一体元数据管理）、**Workflow**（编排数十种引擎的实时/离线开发节点及 AI 节点）、**个人开发环境**（Python 开发调试、Notebook、Git 集成、NAS/OSS 存储）、**Notebook**（多引擎 SQL/Python 交互式分析）。

## 3. 功能矩阵对比

| 能力域 | 子能力 | DolphinScheduler（3.x 现状） | DataStudio | 差距 |
| --- | --- | --- | --- | --- |
| **开发范式** | 主界面 | DAG 画布拖拽 + 节点侧滑表单（`dag-task-panel.tsx`、`detail-modal.tsx`） | IDE 布局：目录树 + 多 Tab 代码编辑 + 底部日志/结果面板 | 大 |
| | 代码编辑 | 任务表单内嵌 Monaco（SQL/Shell/Python） | 智能 SQL 编辑器：智能提示、算子结构可视化、权限校验 | 大 |
| | 临时查询（ad-hoc） | 无（必须先建工作流/任务） | Notebook 交互式分析 + 临时查询 | 大 |
| | Notebook | 无 | 原生支持（多引擎 SQL/Python、可视化结果） | 大 |
| **工作流** | 可视化编排 | 强项：X6 DAG 画布、动态 DAG（`dynamic-dag/`）、自动布局、节点搜索 | DAG 可视化工作流（周期/触发式/手动业务流程，单工作流上限 400 节点） | DS 略优 |
| | 通用节点 | conditions、switch、sub-workflow、dependent | 条件分支、循环、外部触发等通用节点 | 相当 |
| **调度模型** | 调度粒度 | **工作流级**：整个 DAG 一个定时（`schedules` 模块 + `timing/`） | **节点级**：每个节点独立定时属性，依赖驱动触发 | 大 |
| | 依赖机制 | 工作流内 DAG 边 + dependent 任务（跨流程依赖，配置繁琐） | 输出名（全局唯一）/输出表名 + 同周期/跨周期依赖 + 血缘解析上游自动触发 | 大 |
| | 触发方式 | 定时、手动、API | 定时、事件触发、外部系统触发、血缘解析上游触发 | 中 |
| | 执行控制 | 重试、超时、失败告警、优先级、任务组 | 重跑、空跑（不执行不阻塞）、冻结（不执行且阻塞）、生效日期、幂等重跑条件 | 中 |
| | 补数据 | 工作流级补数（指定时间范围重跑） | 节点级按业务日期批量补数据，联动跨周期依赖 | 中 |
| **环境与发布** | 开发/生产隔离 | 无双环境，工作流定义直接生效（靠版本管理回滚） | 标准模式：开发 → 调试 → 调度配置 → **发布** → 运维 | 大 |
| | 代码评审 | 无 | 代码评审（可阻塞发布）、治理项检查 | 大 |
| **数据治理** | 元数据/数据目录 | 无（仅数据源连接管理） | 数据目录（湖仓一体元数据管理） | 大 |
| | 数据地图 | 无 | 表检索、详情、预览、血缘 | 大 |
| | 数据血缘 | 有雏形（`lineages` API，基于任务解析） | 全链路血缘（表级/字段级） | 中 |
| | 数据建模 | 无 | 数据建模模块（维度建模、数仓分层 ODS/DIM/DWD/DWS/ADS、物理化） | 大 |
| | 数据质量 | 无（仅任务失败告警） | 质量规则（空值/唯一/波动）、质量监控与调度节点关联、DQC 阻断 | 大 |
| **数据集成** | 离线同步 | DataX、SeaTunnel、Sqoop、ChunJun 任务插件（表单配置） | 数据集成模块（向导式/脚本模式，可视化字段映射） | 中 |
| | 实时同步 | Flink/SeaTunnel 任务 | 数据集成实时同步（Kafka→Hologres 等） | 中 |
| **数据服务** | API 发布 | 无 | 数据服务模块（数据表/API 注册、鉴权、限流、监控） | 大 |
| **运维监控** | 实例运维 | 工作流/任务实例列表、状态统计、日志查看 | 运维中心：周期任务运维、补数据任务、运行大盘 | 中 |
| | 告警 | 强项：独立 alert 模块、多种告警插件、告警组 | 钉钉/短信/电话等告警 + 质量告警 | DS 略优 |
| **平台管理** | 多租户/权限 | 用户/项目/租户/授权 | 工作空间成员、角色、界面功能权限 + 数据访问权限 | 中 |
| | 开放性 | 开源、OpenAPI、插件机制（任务/数据源/告警可插拔） | OpenAPI 开放能力，但引擎绑定阿里云 | DS 优 |
| **AI 能力** | 智能辅助 | 无 | DataStudio 智能开发（AI 补全等）+ PAI 节点 | 大 |

## 4. 核心差异详解

### 4.1 交互范式：DAG 画布 vs IDE

DolphinScheduler 的核心入口是**工作流定义列表 → DAG 画布**：

- `src/views/projects/workflow/definition/`：工作流列表
- `src/views/projects/workflow/components/dag/`：画布核心（`dag-canvas.tsx`、`dag-sidebar.tsx` 拖拽侧栏、`dag-toolbar.tsx` 工具栏）
- 双击节点弹出 `dag-task-panel.tsx` / `detail-modal.tsx` **侧滑表单**编辑任务

DataStudio 的核心入口是**IDE**：

- 左侧：数据目录/业务流程目录树（脚本、节点、资源、表）
- 中央：**多 Tab 编辑区**（SQL/代码编辑器、节点属性面板、DAG 依赖视图）
- 底部：运行日志、查询结果、编译信息
- 开发者的日常动线是"写代码 → 点运行 → 看结果"，而不是"拖节点 → 填表单 → 保存 DAG"

这决定了两者面向的人群差异：DS 面向"编排者"（数据平台工程师），DataStudio 面向"开发者"（数仓开发、分析师）。

### 4.2 调度模型：工作流级 vs 节点级

| 对比项 | DolphinScheduler | DataStudio |
| --- | --- | --- |
| 定时配置挂在哪 | 工作流上（`schedules`：一个工作流一个 cron） | 节点上（每个节点有独立"调度配置"属性页） |
| 跨流程依赖 | `dependent` 任务节点（需手动配置依赖的工作流/任务） | 节点依赖：依赖上一周期/依赖当前周期，通过全局唯一"输出名"自动关联 |
| 依赖发现 | 手动连边 | 可基于血缘解析自动建立上游依赖 |
| 语义 | "这个 DAG 每天 2 点跑" | "这张产出表的数据每天 2 点就绪，下游谁依赖我谁就绪后跑" |

DataStudio 的"输出名/输出表名 + 业务日期"模型让**数据即依赖**：调度围绕"表数据的产出时间"组织，天然支持跨流程、跨周期依赖与按业务日期补数。DS 的模型则围绕"流程"，跨流程依赖是补丁式能力（dependent 任务），补数据也只能整流程补。

### 4.3 数据开发体验

- **DS**：SQL 写在任务表单的 Monaco 编辑器里（`node/fields/use-editor.ts` 等），无表名补全、无库表元数据侧栏、无"运行选中"、查询结果只能在任务实例日志里看。
- **DataStudio**：智能 SQL 编辑器（基于元数据的表/字段补全、语法校验、算子结构可视化）、临时查询/Notebook 即席执行、结果面板分页预览与导出、cost 与权限校验。

### 4.4 数据治理：DS 的最大空白

DS 目前具备：数据源管理（`datasource-plugin` 支持 MySQL/PG/Hive/Spark 等）、资源中心（文件/UDF）、血缘雏形。缺失：元数据中心、数据地图、数据建模、数据质量、数据服务。这些恰是 DataStudio（及其所在的 DataWorks 全家桶）的核心价值——"开发治理一体"。

### 4.5 环境隔离与发布

- **DS**：单环境。工作流定义保存即生效，靠定义版本（`workflow-definition` 版本接口）回滚。开发测试与生产共用一套流程，靠项目隔离。
- **DataStudio**：标准模式双环境。开发环境开发调试 → 发布流程打包 → 生产环境生效，支持代码评审阻塞发布。这是企业级数仓"变更管控"的关键能力。

### 4.6 生态与开放性

- **DS 优势**：开源、引擎无关（37 种任务插件、多数据源插件）、可自建、可深度二次开发（本改造的前提）。
- **DataStudio 优势**：与 MaxCompute/Hologres/PAI 等引擎深度协同（权限、元数据、血缘原生打通），但封闭、绑定阿里云、不可私有化定制。

## 5. 基于 dolphinscheduler-ui 源码的现状盘点

| 现状模块 | 代码位置 | 与 DataStudio 的对应关系 |
| --- | --- | --- |
| DAG 画布编排 | `src/views/projects/workflow/components/dag/`（33 文件：画布、侧栏、工具栏、右键菜单、自动布局、状态渲染） | 对应 Workflow 的 DAG 依赖视图，**可保留复用** |
| 动态 DAG | `src/views/projects/workflow/components/dynamic-dag/` | DataStudio 无直接对应，属 DS 特色 |
| 任务表单（37 种） | `src/views/projects/task/components/node/`（`tasks/` + `fields/` 77 个字段组件 + `use-task.ts`） | 对应节点编辑器，需改造为 **Tab + 代码编辑器 + 属性面板** 形态 |
| 工作流定义/实例 | `src/views/projects/workflow/definition/`、`instance/` | 对应周期任务运维，需按节点维度重组 |
| 定时调度 | `src/views/projects/workflow/timing/` + `src/service/modules/schedules/` | 对应节点级调度配置，**粒度需下沉** |
| 数据源中心 | `src/views/datasource/` + `dolphinscheduler-datasource-plugin` | 对应数据目录的"连接管理"，**可复用为元数据采集入口** |
| 资源中心 | `src/views/resource/` | 对应资源/函数管理，可并入 IDE 目录树 |
| 血缘 | `src/service/modules/lineages/` | 对应数据地图血缘，**需扩展为表级/字段级** |
| 监控中心 | `src/views/monitor/`（master/worker/DB/统计） | 对应运维中心基础设施部分 |
| 安全中心 | `src/views/security/`（用户/租户/告警/环境/集群/令牌/审计） | 对应工作空间管理，需增加**数据权限** |
| Monaco 编辑器 | 已引入 `monaco-editor@0.50`（任务表单内使用） | 对应智能 SQL 编辑器，**基础已具备** |

## 6. 结论：差距清单（改造输入）

按优先级排序的 Top 差距：

1. **IDE 交互范式缺失**：无目录树、无多 Tab 编辑、无运行结果面板、无临时查询。
2. **调度模型粒度不同**：工作流级调度 → 需下沉为节点级调度 + 输出名依赖。
3. **元数据能力空白**：无数据目录/数据地图/表级血缘，SQL 补全与质量校验都依赖它。
4. **无开发/生产双环境与发布流程**。
5. **数据治理套件空白**：建模、质量、数据服务。
6. **无 Notebook/交互式分析**。
7. **无 AI 辅助开发**。

其中 1、3、4 是"平台感"差距的关键；2 是调度内核的语义升级；5、6、7 是增值能力，可分阶段补齐。具体改造方案见《[02-改造方案-从DolphinScheduler到DataStudio.md](./02-改造方案-从DolphinScheduler到DataStudio.md)》。
