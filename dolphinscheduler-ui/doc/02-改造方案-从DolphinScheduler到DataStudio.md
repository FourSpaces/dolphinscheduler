# 改造方案：从 DolphinScheduler 到 DataStudio 风格数据开发平台

> 前置阅读：《[01-产品对比-DolphinScheduler-vs-阿里云DataStudio.md](./01-产品对比-DolphinScheduler-vs-阿里云DataStudio.md)》
> 范围说明：DataStudio 为闭源商业产品，本方案仅参考其**公开的产品形态与交互范式**进行自主设计与实现，不涉及对其代码/素材的复刻。

## 1. 改造目标与原则

**目标**：将 DolphinScheduler 从"工作流调度系统"升级为"IDE 化的一站式数据开发平台"，达到 DataStudio 的核心产品体验：

1. 开发者以 IDE 方式开发 SQL/脚本，双击节点打开代码 Tab 而非侧滑表单；
2. 调度粒度从工作流级下沉为节点级，支持输出名依赖与按业务日期补数据；
3. 具备元数据中心（数据目录）、智能 SQL 编辑、临时查询、数据质量等平台能力。

**原则**：

- **保留调度内核**：`master`/`worker`/`task-plugin`/`alert` 是 DS 的核心竞争力，全部保留复用；
- **渐进式改造**：三阶段推进，每阶段独立可交付、可回滚，旧 DAG 模式与新 IDE 模式并存过渡；
- **开源引擎中立**：对标 DataStudio 的产品形态，但不绑定单一云厂商，元数据/血缘面向多引擎设计；
- **API 先行**：所有新能力先定义 REST API 契约，前端与后端并行开发。

## 2. 总体架构演进

```
现状：
  UI(DAG画布+表单) ──► api ──► master ──► worker ──► task-plugin ──► 引擎
                                  └► schedules(工作流级定时)

目标：
  UI(IDE: 目录树+多Tab+结果面板) ──► api ──┬─► master ──► worker ──► task-plugin ──► 引擎
                                          ├─► metadata-service(元数据/血缘/数据目录)  ──► datasource-plugin
                                          ├─► query-service(临时查询/结果集/Notebook)  ──► datasource-plugin
                                          ├─► schedule-service(节点级调度/补数据)
                                          └─► quality-service(质量规则/校验) ──► alert
```

新增后端服务模块（4 个），前端新增 `views/studio/` IDE 模块，改造 `views/projects/` 为兼容模式。

## 3. 改造路线图（三阶段）

| 阶段 | 主题 | 周期估算 | 交付物 |
| --- | --- | --- | --- |
| 阶段一 | IDE 化 UI + 临时查询 + 元数据基础 | 3~4 个月 | IDE 界面、节点 Tab 编辑、SQL 补全、运行结果面板、临时查询、库表浏览 |
| 阶段二 | 节点级调度 + 依赖升级 + 补数据 + 发布 | 3~4 个月 | 节点调度属性、输出名依赖、跨流程依赖视图、补数据中心、开发/生产发布 |
| 阶段三 | 数据治理套件 | 4~6 个月 | 数据地图、数据建模、数据质量、数据服务、Notebook |

## 4. 阶段一：IDE 化 UI 改造（前端为主）

### 4.1 新增 IDE 布局

新增 `src/views/studio/`，采用三栏 + 底部面板布局：

```
┌────────┬──────────────────────────────────────┬────────────┐
│ 目录树  │  Tab: SQL编辑 │ Tab: DAG依赖 │ Tab: 属性 │  属性面板   │
│ (可折叠) │──────────────────────────────────────│  (可折叠)   │
│        │  底部面板: 运行日志 │ 查询结果 │ 历史记录  │            │
└────────┴──────────────────────────────────────┴────────────┘
```

新增文件规划：

```
src/views/studio/
  ├─ index.tsx                       # IDE 容器（布局组装、快捷键、Tab 状态）
  ├─ explorer/                       # 左侧目录树
  │   ├─ use-tree-data.ts            # 聚合 工作流/任务/资源/临时查询/表 五棵树
  │   └─ tree-node-actions.ts        # 右键菜单（新建/重命名/删除/提交）
  ├─ editor-tabs/                    # 多 Tab 编辑区
  │   ├─ use-tabs.ts                 # Tab 状态机（打开/关闭/脏检查/未保存提示）
  │   ├─ code-editor-tab.tsx         # 代码类节点 Tab（monaco 包装）
  │   ├─ dag-tab.tsx                 # 复用 dag/ 画布作为依赖视图
  │   └─ property-panel.tsx          # 节点属性（复用 node/fields/ 字段组件）
  ├─ result-panel/                   # 底部面板
  │   ├─ log-panel.tsx               # 运行日志（复用 log 组件）
  │   ├─ result-table.tsx            # 查询结果（虚拟滚动 + 分页 + 导出 CSV）
  │   └─ history-panel.tsx           # 临时查询历史
  └─ adhoc-query/                    # 临时查询（ad-hoc）
      ├─ use-adhoc-execution.ts
      └─ query-editor.tsx
```

关键实现点：

- **Tab 状态管理**：新增 Pinia store `src/store/studio/studio-tabs.ts`，持久化已打开 Tab（复用 `pinia-plugin-persistedstate`，项目已引入）。
- **路由设计**：新增 `/studio/:projectCode`，Tab 切换不走路由（避免路由栈爆炸），用 query 参数同步当前激活 Tab 便于分享链接。
- **布局组件**：可直接使用 Naive UI 的 `n-layout` + `n-split`（2.33 版本已支持分割面板）。

### 4.2 节点编辑 Tab 化（改造现有表单模式）

现状：`src/views/projects/task/components/node/detail-modal.tsx` 弹窗 + `dag-task-panel.tsx` 侧滑面板。

改造：

1. 抽象"节点编辑器"为三种视图，由配置决定打开方式：
   - **代码型任务**（sql/shell/python/java/procedure/hive-cli/http 等）：Tab 内上下分区——上部 Monaco 代码编辑器，下部属性表单（资源、参数、环境、前置/后置语句）；
   - **配置型任务**（datax/sea-tunnel/k8s/mlflow 等）：Tab 内表单页（复用现有 `fields/` 77 个字段组件）；
   - **依赖型任务**（dependent/conditions/switch/sub-workflow）：Tab 内简化表单。
2. `use-task.ts` 的表单模型（`format-data.ts` 的 `paramsTransform`/`paramsDecode`）保持不变，仅替换渲染容器，**37 种任务插件零改动**。
3. DAG 画布双击节点 → `emit('open-tab', taskCode)`，由 IDE 容器接管；旧工作流页面保留原侧滑面板作为兼容模式。

### 4.3 智能 SQL 编辑器

基于已引入的 `monaco-editor@0.50` 增强，新增 `src/components/monaco-editor/extensions/`：

| 能力 | 实现方式 |
| --- | --- |
| 多方言语法 | 按 datasource type 注册 Monaco language（hive/spark/mysql/pg/odps…），SQL 任务根据所选数据源切换 |
| 表/字段补全 | 新增元数据 API（见 4.5），`monaco.languages.registerCompletionItemProvider` 异步拉取当前库表的 schema 提示 |
| SQL 格式化 | 引入 `sql-formatter`，注册为 Monaco action（Shift+Alt+F） |
| 执行选中 | Monaco 选区 → 临时查询 API 只执行选中片段 |
| 关键字/函数提示 | 内置各方言关键字表 + UDF 列表（来自资源中心 UDF） |
| 代码片段 | 按任务类型内置 snippets（如 `INSERT OVERWRITE ...`） |

### 4.4 运行结果面板

- SQL 任务执行后，`worker` 侧新增"结果集回传"通道：任务执行插件将 SELECT 结果写入 `storage-plugin`（HDFS/OSS/JDBC 临时表），返回 `resultToken`；
- 前端 `result-panel/result-table.tsx` 按 `resultToken` 分页拉取（新增 API：`/query-results/{token}/page/{pageNo}`）；
- 支持导出 CSV、单元格复制、行数统计；日志面板复用现有 `src/views/projects/task/components/` 的日志组件。

### 4.5 元数据服务（阶段一后端核心）

**这是 SQL 补全、数据目录、血缘、质量校验的共同地基**，必须最先做。

后端新增模块 `dolphinscheduler-metadata`：

```
dolphinscheduler-metadata/
  ├─ api/          # MetadataController: 库/表/字段/DDL/预览/检索
  ├─ collector/    # 元数据采集器（复用 dolphinscheduler-datasource-plugin 的连接池）
  │   ├─ jdbc-collector      # MySQL/PG/Oracle... (information_schema)
  │   ├─ hive-collector      # metastore thrift
  │   └─ spark-collector     # catalog api
  ├─ lineage/      # 血缘解析：SQL 解析（Apache Calcite / Druid SQL Parser）
  │               # 任务保存时解析 SQL → 表级/字段级血缘 → 入库
  └─ service/     # 元数据查询、检索（ES/DB 全文索引）
```

数据模型（新增表，见第 7 节）：`t_ds_metadata_database` / `t_ds_metadata_table` / `t_ds_metadata_column` / `t_ds_lineage_table` / `t_ds_lineage_column`。

采集策略：

- **拉模式**：定时任务（复用 DS 自身调度）周期采集库表结构；
- **推模式**：SQL 任务保存/执行时解析血缘即时写入。

### 4.6 临时查询（ad-hoc）

- 新增业务对象"查询"（Query）：绑定数据源 + SQL 文本，可保存、可执行、可查看历史；
- 执行走 `query-service`（新增后端模块 `dolphinscheduler-query`）：**不经过 master/worker 调度链路**，直接在 query-server 上通过 `datasource-plugin` 连接执行，带超时、行数上限、并发上限、队列控制；
- 权限：复用数据源授权 + 新增"查询隔离级别"（开发/生产数据源标记）。

阶段一 API 清单：

| API | 说明 |
| --- | --- |
| `GET /metadata/datasources/{id}/databases` | 库列表 |
| `GET /metadata/databases/{dbId}/tables` | 表列表 |
| `GET /metadata/tables/{tableId}` | 表详情（字段、分区、DDL、统计） |
| `GET /metadata/tables/{tableId}/preview` | 数据预览（前 N 行） |
| `GET /metadata/search?keyword=` | 元数据检索 |
| `POST /queries` / `POST /queries/{id}/execute` | 保存/执行临时查询 |
| `GET /queries/{executionId}/status` / `GET /queries/{executionId}/results` | 执行状态/分页结果 |
| `GET /lineages/tables/{tableId}` | 表级血缘 |

## 5. 阶段二：调度模型升级（内核改动）

### 5.1 节点级调度属性

现状：定时挂在 workflow 上（`schedules` API + `src/views/projects/workflow/timing/`）。

改造：

- `t_ds_task_definition` 增加调度属性字段：`cron_expression`、`schedule_enabled`、`schedule_params`（超时/重试/空跑/冻结/生效日期）；
- `dolphinscheduler-scheduler-plugin`（现有定时插件）从"扫描 workflow 定时"扩展为"扫描节点定时"；
- **兼容策略**：workflow 定时仍然有效，等价于"批量设置所有节点定时"；节点定时优先级高于工作流定时。master 调度 DAG 时按节点依赖拓扑 + 节点就绪时间触发，而非整图同一时刻触发。

### 5.2 输出名依赖（对标 DataStudio 核心概念）

- 每个节点可声明**输出名**（全局唯一，如 `ods_user_detail`）与**输出表**；
- 新增 `t_ds_task_dependency`：`task_code` / `dependency_type`(同周期 SELF / 跨周期 CROSS) / `dependency_output_name` / `offset`(跨周期偏移，如"依赖上一周期")；
- 依赖解析：master 启动实例时，将输出名依赖解析为跨工作流 DAG 边，统一进入现有 DAG 执行引擎（**复用 master 的 DAG 拓扑能力，不改执行内核**）；
- UI：DAG 画布对跨流程依赖渲染为虚线边（`dag-canvas` 扩展 `use-custom-cell-builder.ts`）；节点属性面板新增"依赖"配置区。

### 5.3 补数据中心

- 新增 `t_ds_backfill_job`（补数任务单：节点/输出名集合 + 业务日期区间 + 并发数）；
- 后端按业务日期逐日生成节点实例，跨周期依赖自动串联（D 日依赖 D-1 日）；
- 前端新增 `views/studio/ops/backfill/`：创建向导、进度甘特图、失败重跑；
- 复用现有工作流实例补数接口的生成逻辑，粒度下沉到节点。

### 5.4 开发/生产环境与发布

- 引入"环境"维度：项目可绑定 dev/prod 两个环境（复用 `t_ds_environment`？不行——现有 environment 是"运行环境"语义，需新增 `t_ds_workspace_env`）；
- 工作流/任务定义增加 `env_code` 字段，dev 环境保存 → **发布单**（`t_ds_publish_ticket`：变更 diff、评审人、状态）→ 评审通过后克隆至 prod 环境；
- 前端：IDE 目录树顶部环境切换器；新增"发布"面板（变更对比复用现有定义版本 diff 能力）。

## 6. 阶段三：数据治理套件

### 6.1 数据地图（元数据门户）

- 前端新增 `views/studio/catalog/`：表检索、表详情（字段/分区/血缘/产出任务/质量分/预览）、域-主题-分层导航（ODS/DIM/DWD/DWS/ADS 打标）；
- 全部基于阶段一元数据服务，无新增后端。

### 6.2 数据建模

- 新增 `dolphinscheduler-modeling` 模块：维度建模（维度表/事实表/指标定义）、分层归属、字段映射、**DDL 生成与物理化**（通过元数据服务下发引擎执行）；
- 模型 → 生成 SQL 节点（挂接现有 SQL 任务），实现"建模驱动开发"；
- 数据模型：`t_ds_model` / `t_ds_model_field` / `t_ds_model_relation`。

### 6.3 数据质量

- 新增 `dolphinscheduler-quality` 模块：规则配置（表行数波动、空值率、唯一性、正则、自定义 SQL）；
- 质量规则与节点绑定：任务执行前/后触发校验，不达标按策略**告警或阻断**（复用 `alert` 模块与 master 的失败策略）；
- 数据模型：`t_ds_quality_rule` / `t_ds_quality_result`；前端新增质量报告页。

### 6.4 数据服务

- 新增 `dolphinscheduler-dataservice` 模块：向导式注册 API（表/SQL 模式）→ 生成 REST 端点（鉴权、限流、审计）；
- 数据模型：`t_ds_api_service` / `t_ds_api_call_log`。

### 6.5 Notebook

- 前端引入开源 Notebook 内核（如 JupyterLite 或自研轻量 Cell 组件），后端复用阶段一 `query-service` 执行 Cell；
- Notebook 文件存入资源中心（`storage-plugin`），可作为节点挂入工作流。

## 7. 数据模型变更汇总

| 新增表 | 阶段 | 说明 |
| --- | --- | --- |
| `t_ds_metadata_database` | 一 | 元数据库 |
| `t_ds_metadata_table` | 一 | 元数据表 |
| `t_ds_metadata_column` | 一 | 元数据字段 |
| `t_ds_lineage_table` / `t_ds_lineage_column` | 一 | 表级/字段级血缘 |
| `t_ds_query` / `t_ds_query_execution` | 一 | 临时查询与执行记录 |
| `t_ds_task_dependency` | 二 | 输出名/跨周期依赖 |
| `t_ds_backfill_job` / `t_ds_backfill_item` | 二 | 补数据任务 |
| `t_ds_workspace_env` / `t_ds_publish_ticket` | 二 | 环境与发布 |
| `t_ds_model` / `t_ds_model_field` / `t_ds_model_relation` | 三 | 数据建模 |
| `t_ds_quality_rule` / `t_ds_quality_result` | 三 | 数据质量 |
| `t_ds_api_service` / `t_ds_api_call_log` | 三 | 数据服务 |

变更表：`t_ds_task_definition`（+ 调度属性、输出名、env_code）、`t_ds_process_definition`（+ env_code）。

DDL 落地位置：`dolphinscheduler-dao/src/main/resources/sql/upgrade/`（沿用现有版本升级机制）。

## 8. 前端工程改造要点

| 事项 | 说明 |
| --- | --- |
| 新增依赖 | `sql-formatter`（SQL 格式化）、`virtual-scroll-table`（可用 Naive UI 内置虚拟滚动替代）、Notebook 内核（阶段三） |
| 路由 | 新增 `/studio/:projectCode` IDE 入口；`/projects/:projectCode` 保留为兼容模式，双模式并存 1~2 个版本后下线旧编辑入口 |
| 状态管理 | 新增 `store/studio/`（tabs、explorer、result-panel）；`store/project/` 基本不动 |
| 国际化 | `locales/`（37 个文件）按模块追加 studio 命名空间 |
| 主题 | `themes/` 已支持暗色，IDE 布局需适配 Monaco 主题联动 |
| 权限 | IDE 入口权限沿用项目授权；新增"临时查询""发布""数据服务"权限点，接入 `store/user/` 的权限指令 |
| 组件复用 | DAG 画布（`dag/`）、任务字段组件（`node/fields/`）、日志组件、数据源表单全部复用，**不重写** |

## 9. 里程碑与工作量估算

| 里程碑 | 内容 | 估算 |
| --- | --- | --- |
| M1（第 1 月） | IDE 布局 + Tab 状态机 + 目录树 + 节点 Tab 化（代码型任务） | 前端 2~3 人 |
| M2（第 2 月） | 元数据服务（JDBC/Hive 采集）+ SQL 补全 + 库表浏览 | 后端 2 人 + 前端 1 人 |
| M3（第 3~4 月） | query-service + 临时查询 + 运行结果面板 + 血缘解析 | 后端 2 人 + 前端 1~2 人 |
| M4（第 5~6 月） | 节点级调度 + 输出名依赖 + 补数据中心 | 后端 3 人（含 master 内核）+ 前端 1~2 人 |
| M5（第 7~8 月） | 双环境 + 发布流程 | 前后端各 2 人 |
| M6（第 9~12 月） | 数据地图、建模、质量、数据服务、Notebook | 后端 3~4 人 + 前端 2~3 人 |

> 估算为净开发人月，按 30%~40% 加上联调、测试、文档开销。

## 10. 风险与挑战

| 风险 | 影响 | 缓解措施 |
| --- | --- | --- |
| 节点级调度改造触碰 master 内核 | 调度正确性回归风险大 | 兼容模式优先（工作流定时 = 节点定时批量预设）；`dolphinscheduler-e2e` 补齐调度回归用例；灰度开关按项目启用 |
| 元数据采集的引擎差异大 | 采集器维护成本高 | 阶段一只做 JDBC 系 + Hive；采集器接口化，后续按需扩展；血缘解析统一走 Calcite |
| 临时查询直连生产库 | 安全与资源风险 | 查询走独立 query-server 资源组；行数/超时/并发硬限制；生产数据源默认只读 + 权限校验 |
| 双环境发布的数据一致性 | 发布遗漏/冲突 | 发布单携带完整 diff；版本号单调递增；发布动作幂等 |
| 双模式并存的代码腐化 | 维护成本翻倍 | 设定下线时间表；`dag/` 画布只保留一份，两种模式共用 |
| 与上游社区版本的分叉 | 合并冲突 | 改造尽量以"新增模块"为主（studio/metadata/query 均为独立目录/独立 Maven 模块），少改存量文件；定期 rebase 上游 |
| SQL 解析引擎方言覆盖不全 | 血缘/质量误报 | 解析失败降级为"无血缘"而非报错；方言解析器白名单制 |

## 11. 附录：DataStudio 功能 → DS 现状 → 改造动作映射表

| DataStudio 能力 | DS 现状 | 改造动作 | 阶段 |
| --- | --- | --- | --- |
| IDE 布局（目录树/多Tab/结果面板） | 无 | 新增 `views/studio/` | 一 |
| 智能 SQL 编辑器（补全/格式化） | Monaco 裸用 | monaco 扩展 + 元数据 API | 一 |
| 数据目录（库表浏览/预览） | 仅数据源连接 | metadata-service + catalog 页 | 一 |
| 临时查询/Notebook | 无 | query-service + adhoc 模块（Notebook 三） | 一/三 |
| 表级/字段级血缘 | `lineages` 雏形 | Calcite 解析 + 血缘表 + 画布渲染 | 一 |
| 节点级定时调度 | 工作流级定时 | task_definition 扩展 + scheduler-plugin 扩展 | 二 |
| 输出名/同周期/跨周期依赖 | dependent 任务 | `t_ds_task_dependency` + master 解析 | 二 |
| 空跑/冻结/生效日期 | 无 | 节点调度属性 + 执行控制 | 二 |
| 补数据（按业务日期） | 工作流级补数 | backfill-service + 运维页 | 二 |
| 开发/生产双环境 + 发布评审 | 单环境 | workspace-env + publish-ticket | 二 |
| 代码评审/质量管控 | 无 | 发布评审流 + quality-service | 二/三 |
| 数据建模（维度建模/分层） | 无 | modeling 模块 + 模型页 | 三 |
| 数据质量（DQC） | 仅任务告警 | quality 模块 + 规则绑定节点 | 三 |
| 数据服务（API 发布） | 无 | dataservice 模块 | 三 |
| DAG 可视化工作流 | **已具备（X6）** | 保留为依赖视图，双模式过渡 | 一 |
| 37 种任务插件 | **已具备** | 全部复用，编辑容器 Tab 化 | 一 |
| 告警体系 | **已具备（alert 模块）** | 复用，质量/发布事件接入 | 二/三 |
| 多租户/权限 | **已具备（security）** | 复用，新增数据权限点 | 二 |

## 12. 建议的启动顺序（Sprint 0 清单）

1. 冻结 IDE 信息架构设计（目录树五棵树、Tab 类型枚举、底部面板状态机）；
2. 定义 metadata-service 与 query-service 的 OpenAPI 契约（先于编码）；
3. 搭建 `views/studio/` 骨架与 `store/studio/`，打通 Tab 打开/关闭/持久化；
4. 选定 SQL 解析器（建议 Apache Calcite，Druid Parser 作为轻量备选）并做方言 POC；
5. 在 `dolphinscheduler-e2e` 中补充"双模式并存"的回归用例框架。
