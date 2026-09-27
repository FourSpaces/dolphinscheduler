# 阶段一功能开发文档：Studio 数据开发 IDE（基于现有 API）

> 前置阅读：《[02-改造方案-从DolphinScheduler到DataStudio.md](./02-改造方案-从DolphinScheduler到DataStudio.md)》
> 本文档是阶段一的**细化开发规格**，目标：AI/开发者可按文档直接实施，**全部功能基于现有后端接口实现，不要求后端改动**。
> 参考原型：阿里云 DataWorks DataStudio（目录树 + 多 Tab 编辑 + 调试配置 + 运行/日志）。

## 1. 功能总览与需求映射

| # | 需求 | 实现要点 | 依赖的现有 API |
| --- | --- | --- | --- |
| R1 | Studio 菜单放在「任务实例」菜单下面 | 修改 `use-dataList.ts` 菜单树 + `router/modules/projects.ts` 路由 | 无（纯前端） |
| R2 | 目录树根目录 = 项目名称 | 路由参数 `projectCode` + `query.projectName` | `GET /projects`（兜底） |
| R3 | 工作流标签 = 目录名称；无标签工作流直接挂根目录 | 名称前缀约定分组（P0，纯前端）；可选 tags 字段（P1） | `GET /projects/{code}/workflow-definition` |
| R4 | 双击目录树中的工作流 → 打开 DAG 依赖编辑 Tab | 复用 `views/projects/workflow/components/dag/` 画布 | `GET/PUT .../workflow-definition/{code}` |
| R5 | 双击工作流下节点 → 打开 SQL/节点内容编辑 Tab | 复用 `node/fields/` 表单体系 + Monaco | `GET .../query-task-definition-list`、`PUT .../workflow-definition/{code}` |
| R6 | 运行（整图/单节点）+ 日志 | `startNodeList` + `taskDependType=TASK_ONLY` | `executors/start-workflow-instance`、`task-instances`、`log/detail` |
| R7 | 我的文件（临时查询 .sql） | 资源中心 FILE 目录承载 | `resources/*` |
| R8 | 临时查询执行 | P0：动态创建隐藏工作流执行（复用现有链路） | `gen-task-codes`、`workflow-definition`、`executors` |

## 2. 菜单与路由接入（R1）

### 2.1 路由（`src/router/modules/projects.ts`）

在 `task-instance` 路由（`/projects/:projectCode/task/instances`）**之后**追加：

```ts
{
  path: '/projects/:projectCode/studio',
  name: 'projects-studio',
  component: components['projects-studio'],
  meta: {
    title: '数据开发（Studio）',
    activeMenu: 'projects',
    showSide: true,
    auth: []
  }
}
```

说明：本项目路由组件通过 `import.meta.glob('/src/views/**/**.tsx')` 自动映射，组件文件必须放在 `src/views/projects/studio/index.tsx`（映射键 `projects-studio`）。

### 2.2 菜单（`src/layouts/content/use-dataList.ts`）

「任务实例」位于 `projects` 分组 → `task` 子分组（key `'task'`）的 children 中。在 `task_instance` 项之后追加：

```ts
{
  label: t('menu.task'),
  key: 'task',
  icon: renderIcon(SettingOutlined),
  children: [
    {
      label: t('menu.task_instance'),
      key: `/projects/${projectCode}/task/instances`,
      payload: { projectName: projectName }
    },
    {                       // ← 新增：紧跟任务实例之后
      label: t('menu.studio'),
      key: `/projects/${projectCode}/studio`,
      payload: { projectName: projectName }
    }
  ]
}
```

### 2.3 国际化

- `src/locales/zh_CN/menu.ts`：`studio: '数据开发（Studio）'`
- `src/locales/en_US/menu.ts`：`studio: 'Data Development (Studio)'`
- 其余 35 个 locale 文件可先回退英文 key，不阻塞开发。

## 3. 页面布局设计

```
┌──────────────┬──────────────────────────────────────────┬──────────────┐
│ 目录树(300px) │ Tab: 工作流DAG │ Tab: 节点编辑 │ Tab: a.sql │  调试配置抽屉  │
│              │──────────────────────────────────────────│  (n-drawer,  │
│  搜索框       │           编辑区（Monaco / DAG / 表单）    │   右侧滑出)   │
│  n-tree      │──────────────────────────────────────────│              │
│  (可折叠)     │ 底部面板: [运行日志] [运行历史]  (可折叠)    │              │
└──────────────┴──────────────────────────────────────────┴──────────────┘
```

- 布局：Naive UI `n-layout` + `n-layout-sider`（左右栏）+ 底部可折叠面板。
- 编辑区顶部工具条：`运行 ▶`、`停止 ■`、`保存`、`格式化`、`刷新`、`调试配置`、`上线/下线`（对照截图 1/2 顶部按钮排布）。
- 停止：对运行中实例调 `POST /projects/{code}/task-instances/{id}/stop`。

## 4. 目录树详细设计（R2/R3/R4/R5 核心）

### 4.1 树结构

```
📦 {项目名称}                          ← 根目录（R2）
├─ 📁 {标签A}                          ← 目录（R3：由工作流标签/前缀分组）
│   ├─ 🔗 {工作流1}  [ONLINE/OFFLINE]   ← 双击 → DAG Tab（R4）
│   │   ├─ 🟢 {SQL任务节点}             ← 双击 → 节点编辑 Tab（R5）
│   │   └─ ⚙️ {SHELL任务节点}
│   └─ 🔗 {工作流2}
├─ 🔗 {无标签工作流3}                   ← R3：无标签直接挂根目录
└─ 📂 我的文件                          ← 临时查询虚拟目录（R7）
    ├─ 📄 a.sql
    └─ 📄 untitled-1.sql
```

### 4.2 前端类型定义（`src/views/projects/studio/types.ts`）

```ts
type TreeKind = 'project' | 'folder' | 'workflow' | 'task' | 'adhoc-dir' | 'adhoc-file'

interface StudioTreeNode {
  key: string                    // 唯一 key：kind:code，如 'workflow:8392' / 'task:91023'
  kind: TreeKind
  label: string                  // 显示名（工作流显示"短名"，见 4.3）
  code?: number                  // workflow code 或 task code
  taskType?: string              // SQL/SHELL/PYTHON/...
  releaseState?: 'ONLINE' | 'OFFLINE'
  workflowCode?: number          // task 节点回链所属工作流
  isLeaf?: boolean
  children?: StudioTreeNode[]
}
```

### 4.3 分组规则（R3 的落地——重要设计决策）

**现状**：DS 工作流定义（`WorkflowDefinitionReq`）**没有标签字段**。为满足"充分使用现有接口"，P0 采用**名称前缀约定**：

- 约定：工作流名称使用 `目录名/工作流名`（推荐，正斜杠分隔）。
- 解析规则（`utils/tree-group.ts`）：
  1. `name` 含 `/` → 首段为目录名，其余为工作流短名，归入对应目录；
  2. `name` 不含 `/` → 直接挂在根目录下；
  3. 目录按名称排序，同名目录自动合并；目录名即"标签"。
- 示例：`3.0业务/零售汇总` → 目录 `3.0业务` 下工作流 `零售汇总`；`dw_qa_2022`（无 `/`）→ 根目录下。
- **改名安全性**：DS 依赖关系基于 `code` 而非名称，重命名工作流不影响依赖；右键"重命名"时仍需提示检查 dependent 配置。
- **P1 增强（可选，最小后端改动）**：`t_ds_process_definition` 增加 `tags varchar(255)`，`WorkflowDefinitionReq` 增加可选 `tags` 并透传；前端分组优先读 `tags`，无 tags 回退前缀解析。本阶段不实施，`tree-group.ts` 预留策略接口。

### 4.4 树数据组装（`components/explorer/use-tree-data.ts`）

| 层级 | 数据来源（现有 API） | 加载时机 |
| --- | --- | --- |
| 根（项目名） | 路由 `route.params.projectCode` + `route.query.projectName`；兜底 `GET /projects?searchVal=` 按 code 过滤取 `name` | 进入页面 |
| 目录 | 前端解析（4.3），无 API | 随工作流列表 |
| 工作流 | `GET /projects/{code}/workflow-definition?pageNo=&pageSize=100&searchVal=`（`queryListPaging`），循环翻页取全量；取 `name/releaseState/description` | 进入页面 |
| 任务节点 | `GET /projects/{code}/workflow-definition/query-task-definition-list?workflowDefinitionCode={wfCode}`（`getTasksByDefinitionList`），取 `code/name/taskType` | **懒加载**：展开工作流时 |
| 我的文件 | `GET /resources?type=FILE&fullName={baseDir}/studio&pageNo=&pageSize=`（`queryResourceListPaging`） | 展开时 |

组装伪代码：

```ts
async function loadTree(projectCode: number): Promise<StudioTreeNode[]> {
  const wfList = await fetchAllWorkflowDefinitions(projectCode) // 循环分页
  const groups = groupByTag(wfList.map(toWorkflowNode))          // 4.3 规则
  return [{
    key: `project:${projectCode}`, kind: 'project', label: projectName,
    children: [...groups.folders, ...groups.rootWorkflows, adhocDirNode()]
  }]
}

async function loadTasks(projectCode: number, wfCode: number) {
  const { tasks } = await getTasksByDefinitionList(projectCode, wfCode)
  return tasks.map(t => ({
    key: `task:${t.code}`, kind: 'task', label: t.name,
    taskType: t.taskType, workflowCode: wfCode, isLeaf: true
  }))
}
```

### 4.5 树交互规格

| 交互 | 行为 |
| --- | --- |
| **双击工作流** | 打开/激活该工作流的 **DAG Tab**（R4，第 6 节） |
| **双击任务节点** | 打开/激活该节点的 **节点编辑 Tab**（R5，第 7 节） |
| 展开工作流 | 懒加载任务节点（4.4） |
| 双击 `.sql` 文件 | 打开 **临时查询 Tab**（第 9 节） |
| 树顶部工具 | 搜索（前端过滤 label）、刷新（重拉工作流列表）、折叠 |
| 右键-项目根 | 新建工作流（弹窗：名称/目录下拉/描述 → `POST workflow-definition` 空图）、新建目录（见下）、刷新 |
| 右键-目录 | 新建工作流（自动带 `目录名/` 前缀）、重命名目录（批量改前缀：逐个 `PUT workflow-definition/{code}` 更新 name）、删除目录（提示需先清空） |
| 右键-工作流 | 上线/下线（`POST .../{code}/release`）、运行、打开 DAG、重命名（`PUT` 改 name，保持前缀）、删除（`DELETE .../{code}`，需先下线）、定时管理（跳转现有 `workflow-definition-timing` 页） |
| 右键-任务节点 | 打开编辑、从当前节点运行、查看日志 |
| 右键-我的文件 | 新建 SQL 文件（`POST /resources/online-create`）、重命名、删除 |

> 「新建目录」P0 简化：目录是名称前缀的派生物，创建目录 = 创建一个名为 `目录名/未命名工作流` 的空工作流占位（`POST workflow-definition`，空 taskDefinitionJson）。UI 需有说明文案。

### 4.6 图标

- 工作流：`releaseState === 'ONLINE'` 绿色 / `OFFLINE` 灰色（数据来自 4.4 分页接口）。
- 任务节点：按 `taskType` 映射，复用 DAG 侧栏已有图标资源与 `store/project/task-type`。

## 5. Tab 系统（`components/tabs/`）

### 5.1 状态管理（`src/store/projects/studio.ts`，Pinia）

```ts
type TabType = 'welcome' | 'dag' | 'node' | 'adhoc'

interface StudioTab {
  id: string              // `${type}:${code}`，如 'dag:8392'、'node:91023'、'adhoc:/studio/a.sql'
  type: TabType
  title: string           // 工作流名 / 节点名 / 文件名
  closable: boolean
  dirty: boolean          // 未保存标记，标题旁显示 •
  payload: {
    workflowCode?: number
    taskCode?: number
    taskType?: string
    filePath?: string     // adhoc 文件全路径
  }
}
// state: tabs[], activeTabId；openTab(tab) 去重激活；closeTab 对 dirty Tab 拦截确认
```

- 使用 `pinia-plugin-persistedstate` 持久化已打开 Tab（项目已引入）。
- 同一 `id` 全局唯一：双击树节点时若 Tab 已存在则激活。
- Tab 条用 `n-tabs type="card" closable`，超出宽度横向滚动（对照截图多 Tab 形态）。

### 5.2 Tab 类型与渲染

| Tab | 渲染组件 | 内容 |
| --- | --- | --- |
| welcome | 内置 | 空态欢迎页（对照截图 4） |
| dag | `components/dag-tab/index.tsx` | 工作流 DAG 依赖编辑（第 6 节） |
| node | `components/node-edit/index.tsx` | 节点编辑（第 7 节） |
| adhoc | `components/adhoc/index.tsx` | 临时查询 SQL 编辑（第 9 节） |

## 6. DAG 依赖编辑 Tab（R4）

双击目录树工作流 → 打开 `dag:{workflowCode}` Tab。

### 6.1 复用现有 DAG 画布

复用 `src/views/projects/workflow/components/dag/` 全套组件（画布、侧栏、工具栏、保存弹窗、启动参数）。嵌入方式：

- **方案 1（推荐）**：新建 `components/dag-tab/index.tsx` 包装 `dag/index.tsx`，给后者增加可选 props `projectCode`/`definitionCode`（缺省回退路由参数 `route.params.code`），改动小且不影响旧页面；
- 方案 2：Tab 内 `<router-view>` 渲染现有 `/projects/:projectCode/workflow/definitions/:code` 页（零改动，但路由嵌套与 Tab 生命周期管理复杂）。

- 画布"保存"沿用 `dag-save-modal.tsx` → `PUT /projects/{code}/workflow-definition/{wfCode}`（完整提交 `taskDefinitionJson` + `taskRelationJson` + `locations`）。
- 保存成功后：刷新目录树该工作流下的任务节点，Tab `dirty=false`。

### 6.2 工作流数据加载

```
GET /projects/{code}/workflow-definition/{wfCode}
  → { name, taskDefinitionJson, taskRelationJson, locations, globalParams, timeout, executionType, releaseState }
```

- `taskDefinitionJson`：任务定义数组（含 taskParams）；`taskRelationJson`：依赖边（preTaskCode/postTaskCode）；`locations`：节点坐标，保存时回传。

## 7. 节点编辑 Tab（R5）

双击任务节点 → 打开 `node:{taskCode}` Tab。

### 7.1 布局（对照截图 1/5）

```
┌──────────────────────────────────────────────┐
│ 工具条: 运行 停止 保存 格式化 | 调试配置 | 版本  │
├──────────────────────────────────────────────┤
│ [代码型任务] 上部：Monaco 代码编辑器（60%高）    │
│──────────────────────────────────────────────│
│ 下部：属性表单（折叠面板）                       │
│  · 数据源（SQL 型必选） · 环境 · 资源 · 参数    │
│  · 前置/后置 SQL · 超时/重试 · 描述             │
└──────────────────────────────────────────────┘
```

### 7.2 任务分类与渲染

| 分类 | taskType | 渲染 |
| --- | --- | --- |
| 代码型-SQL | `SQL`、`PROCEDURE` | 上部 Monaco（方言按数据源类型切换）+ 下部表单 |
| 代码型-脚本 | `SHELL`、`PYTHON`、`JAVA`、`HTTP` | 上部 Monaco（对应语言）+ 下部表单 |
| 配置型 | `DATA_X`、`SEA_TUNNEL`、`SPARK`、`FLINK`、`MR`、`K8S` 等 | 全区表单（复用 `node/fields/` 字段组件） |
| 依赖型 | `DEPENDENT`、`CONDITIONS`、`SWITCH`、`SUB_WORKFLOW` | 表单 + 提示"依赖关系请在 DAG Tab 中连线维护" |

**表单体系完全复用**：`views/projects/task/components/node/` 下的 `use-task.ts`（表单模型）、`format-data.ts`（`paramsTransform`/`paramsDecode` 编解码）、`fields/`（77 个字段组件）、`tasks/`（37 种任务组装器）。节点编辑 Tab 只替换"容器"（弹窗 → Tab），不重写任何任务表单。

### 7.3 数据加载与保存链路

**加载**：

```
1. GET /projects/{code}/workflow-definition/{wfCode}        → taskDefinitionJson
2. JSON.parse(taskDefinitionJson).find(t => t.code === taskCode)
   → { code, name, taskType, taskParams, timeout, delayTime, description, flag, failRetryTimes... }
3. taskParams 交由对应 tasks/use-xxx.ts 的解码逻辑回填表单
```

**保存（与 DAG 保存同链路，保证一致性）**：

```
1. 表单校验（复用 use-task 校验规则）
2. 重新编码 taskParams（format-data.ts）
3. 读最新工作流详情 → 替换 taskDefinitionJson 中 code===taskCode 的定义
4. PUT /projects/{code}/workflow-definition/{wfCode}
   body: { name, locations, taskDefinitionJson(替换后), taskRelationJson(不变),
           executionType, description, globalParams, timeout }
5. 成功后：Tab dirty=false；刷新树节点（任务名可能变更）
```

> 若工作流 `releaseState=ONLINE`，保存前检测并弹窗"该工作流已上线，保存需先下线"，提供一键下线（`POST .../release {releaseState:'OFFLINE'}`）→ 保存 → 可选重新上线。

### 7.4 调试配置抽屉（对照截图 1 右侧「调试配置」）

右侧 `n-drawer`，分组与 API 映射：

| 分组 | DS 对应概念 | API | 说明 |
| --- | --- | --- | --- |
| 数据源 | SQL 任务目标数据源 | `GET /datasources/list?type={type}`（`queryDataSourceList`） | 写入 `taskParams.datasource`；类型联动 Monaco 方言 |
| 计算配置 | 环境管理 | `GET /environments/list`（`environment` 模块） | 运行时经 `WorkflowInstanceReq.environmentCode` 传入 |
| 资源组 | Worker 分组 | `GET /worker-groups/list`（`worker-groups` 模块） | 运行时经 `WorkflowInstanceReq.workerGroup` 传入 |
| 脚本参数 | 启动参数/全局变量 | 静态：`GET .../{wfCode}/view-variables`；动态：`startParams` | 键值对编辑器，运行时传入 |

调试配置持久化在 `store/projects/studio.ts`（按 Tab 维度），运行时组装进启动请求。

## 8. 运行与日志（R6）

### 8.1 运行链路（整图 / 单节点，同一 API）

```
POST /projects/{code}/executors/start-workflow-instance
```

| 场景 | 关键参数（`WorkflowInstanceReq`） |
| --- | --- |
| DAG Tab「运行」整图 | 不传 `startNodeList`，`taskDependType: 'TASK_PRE'` |
| 节点 Tab「运行」当前节点 | `startNodeList: String(taskCode)`，`taskDependType: 'TASK_ONLY'` |
| 树右键「从当前节点运行」 | `startNodeList: String(taskCode)`，`taskDependType: 'TASK_PRE'`（含上游） |

公共参数：`failureStrategy: 'END'`、`workflowInstancePriority: 'MEDIUM'`、`warningType: 'NONE'`、`runMode: 'RUN_MODE_SERIAL'`、`execType: 'START_PROCESS'`、`dryRun: 0`，外加调试配置的 `environmentCode`/`workerGroup`/`startParams`。

**前置检查**：启动前检查 `releaseState`，`OFFLINE` 时弹窗"运行需先上线"→ 确认后 `POST .../release {releaseState:'ONLINE'}` 再启动。

### 8.2 状态轮询与日志

```
1. 启动成功 → 返回 workflowInstanceId
2. 轮询 GET /projects/{code}/workflow-instances/{instanceId}   （2s 间隔）
   → state 终态（SUCCESS/FAILURE/STOP/...）停止轮询
3. 轮询 GET /projects/{code}/task-instances?workflowInstanceId={id}&pageNo=1&pageSize=50
   → 定位目标任务的 taskInstanceId 与 state（TaskListReq 已支持 workflowInstanceId 过滤）
4. 日志：GET /log/detail?taskInstanceId={id}&skipLineNum=0&limit=1000
   → 增量拉取（skipLineNum=已读行数），渲染到底部「运行日志」面板
5. 终态后：面板显示状态徽标 + 耗时；「停止」调 POST .../task-instances/{id}/stop
```

- 底部「运行历史」页签：`GET /projects/{code}/task-instances?workflowDefinitionName={name}&pageNo=&pageSize=`，点击行切换日志。
- 失败实例支持「置成功」：`POST .../task-instances/{id}/force-success`。

## 9. 我的文件与临时查询（R7/R8）

### 9.1 我的文件（资源中心承载）

- 「我的文件」虚拟目录对应资源中心 FILE 类型下 `/{租户基目录}/studio/`（首次进入不存在则 `POST /resources/directory` 创建）。

| 操作 | API |
| --- | --- |
| 列目录 | `GET /resources?type=FILE&fullName={dir}&pageNo=&pageSize=` |
| 新建 .sql | `POST /resources/online-create`（`fileName`、`fileSuffix: 'sql'`、`content`、`currentDir`） |
| 读取内容 | `GET /resources/view?fullName={path}&limit=&skipLineNum=`（`viewResource`） |
| 保存内容 | `PUT /resources/{resourceCode}`（`updateResource`） |
| 重命名/删除 | `PUT /resources/{code}`（name）、`DELETE /resources/{code}` |

- 双击 `.sql` → 打开 `adhoc:{filePath}` Tab：数据源选择条（对照截图 1「选择数据源」）+ Monaco SQL 编辑器 + 底部日志/结果。

### 9.2 临时查询执行（P0：完全复用现有执行链路）

DS 无即席执行 API，P0 采用"动态隐藏工作流"方案（无后端改动）：

```
1. GET  /projects/{code}/task-definition/gen-task-codes?genNum=1        → 生成任务 code
2. POST /projects/{code}/workflow-definition                            → 创建隐藏工作流
      name: `_adhoc_{userId}_{yyyyMMddHHmmss}`（下划线开头，目录树过滤不显示）
      taskDefinitionJson: 单个 SQL 任务 { datasource: 当前选择数据源, sql: 编辑器内容 }
      taskRelationJson: '[]'，locations: '{}'
3. POST .../{wfCode}/release { releaseState: 'ONLINE' }
4. POST /projects/{code}/executors/start-workflow-instance              → 启动（8.1 参数）
5. 轮询实例/任务实例状态（8.2 流程），日志写入该 Tab 底部面板
6. 终态后可选清理：POST .../release OFFLINE → DELETE .../workflow-definition/{wfCode}
   （默认保留供追溯；提供「清空临时查询工作流」批量删除入口）
```

- **结果集**：P0 查询结果以日志形式展示；结构化结果表（分页/导出）依赖 02 文档 4.4 的 `query-service`（P1）。
- **限制**：store 中记录 `adhocTab → workflowInstanceId` 映射，Tab 关闭时提示未完成实例。

## 10. 现有 API 利用总表

| 功能点 | service 模块函数（前端） | REST 端点 |
| --- | --- | --- |
| 项目名（根目录） | `projects/queryProjectListPaging` | `GET /projects` |
| 工作流列表（树） | `workflow-definition/queryListPaging` | `GET /projects/{code}/workflow-definition` |
| 工作流详情（DAG/节点编辑） | `queryWorkflowDefinitionByCode` | `GET .../workflow-definition/{wfCode}` |
| 创建工作流 | `createWorkflowDefinition` | `POST .../workflow-definition` |
| 保存工作流/DAG/节点 | `updateWorkflowDefinition` | `PUT .../workflow-definition/{wfCode}` |
| 删除工作流 | `deleteByCode` | `DELETE .../workflow-definition/{wfCode}` |
| 上线/下线 | `release` | `POST .../{wfCode}/release` |
| 名称校验 | `verifyName` | `GET .../verify-name` |
| 工作流下任务列表（树懒加载） | `getTasksByDefinitionList` | `GET .../query-task-definition-list` |
| 批量查任务 | `getTaskListByDefinitionCodes` | `GET .../batch-query-tasks` |
| 全局变量 | `viewWorkflowDefinitionVariables` | `GET .../{wfCode}/view-variables` |
| 版本/回滚 | `queryVersions` / `switchVersion` | `GET .../{wfCode}/versions[/v]` |
| 生成任务 code | `task-definition/genTaskCodeList` | `GET .../task-definition/gen-task-codes` |
| 定时管理（跳转现有页） | `schedules/*` | `GET/POST/PUT .../schedules*` |
| 启动运行（整图/单节点） | `executors/startWorkflowInstance` | `POST .../executors/start-workflow-instance` |
| 实例状态轮询 | `workflow-instances/queryWorkflowInstanceById` | `GET .../workflow-instances/{id}` |
| 任务实例列表/停止/置成功 | `task-instances/*` | `GET .../task-instances`、`POST .../{id}/stop`、`POST .../{id}/force-success` |
| 运行日志 | `log/queryLog` | `GET /log/detail` |
| 数据源（调试配置/临时查询） | `data-source/queryDataSourceList` | `GET /datasources/list` |
| 环境（调试配置） | `environment` 模块 | `GET /environments/list` |
| Worker 分组（调试配置） | `worker-groups` 模块 | `GET /worker-groups/list` |
| 我的文件（临时查询） | `resources/*` | `GET/POST/PUT/DELETE /resources*` |

**结论：阶段一所有功能 0 新增后端接口。**

## 11. 新增/修改文件清单

```
新增：
src/views/projects/studio/
  index.tsx                        # Studio 容器（三栏布局 + 底部面板 + 组装）
  types.ts                         # StudioTreeNode / StudioTab 等（4.2 / 5.1）
  utils/tree-group.ts              # 名称前缀分组解析（含策略接口，预留 P1 tags）
  components/
    explorer/index.tsx             # 目录树（n-tree + 懒加载 + 右键菜单）
    explorer/use-tree-data.ts      # 树数据组装（4.4）
    explorer/tree-context-menu.tsx # 右键菜单（4.5）
    tabs/index.tsx                 # Tab 条（n-tabs card + dirty 标记）
    dag-tab/index.tsx              # DAG Tab（包装现有 dag 组件，6.1）
    node-edit/index.tsx            # 节点编辑 Tab（复用 node/fields 表单，7 节）
    node-edit/debug-config.tsx     # 调试配置抽屉（7.4）
    adhoc/index.tsx                # 临时查询 Tab（9 节）
    adhoc/use-adhoc-run.ts         # 隐藏工作流执行链路（9.2）
    bottom-panel/index.tsx         # 底部面板（运行日志 / 运行历史，8.2）

修改：
src/router/modules/projects.ts                       # 追加 studio 路由（2.1）
src/layouts/content/use-dataList.ts                  # task 分组追加 studio 菜单（2.2）
src/locales/zh_CN/menu.ts、src/locales/en_US/menu.ts # menu.studio 文案（2.3）
src/views/projects/workflow/components/dag/index.tsx # 增加可选 props（6.1 方案 1）

复用（不改动）：
src/views/projects/task/components/node/**           # 37 种任务表单体系
src/views/projects/workflow/components/dag/**        # DAG 画布全套
src/components/monaco-editor/**                      # 代码编辑器
src/store/project/**、src/service/modules/**         # 现有 store 与 API 封装
```

## 12. 开发任务拆分（AI 可执行 Checklist）

按依赖顺序排列，每个任务可独立提交：

- [ ] **T1 路由与菜单**（2.1/2.2/2.3）：studio 路由 + 菜单项 + i18n；验收：菜单出现在「任务实例」下方，点击进入空白页。
- [ ] **T2 Studio 容器布局**（第 3 节）：三栏 + 底部面板骨架，左右栏可折叠；验收：布局渲染正常、响应式。
- [ ] **T3 Tab 系统**（5 节）：studio store + Tab 条 + welcome Tab + dirty 拦截 + 持久化；验收：Tab 打开/激活/关闭/刷新恢复。
- [ ] **T4 目录树**（4 节）：use-tree-data + 前缀分组 + 工作流懒加载任务 + 状态图标 + 搜索/刷新；验收：R2/R3 完整呈现（根=项目名、标签=目录、无标签挂根、节点=DS 任务）。
- [ ] **T5 树右键菜单**（4.5）：新建工作流/目录、上线/下线、重命名、删除、运行入口；验收：各操作正确调用对应 API 并刷新树。
- [ ] **T6 DAG Tab**（6 节）：包装 dag 组件 + props 注入 + 保存联动树刷新；验收：R4——双击工作流打开可编辑 DAG，保存生效。
- [ ] **T7 节点编辑 Tab**（7.1~7.3）：加载/回填/保存链路，先支持 SQL 型，再扩展 SHELL/PYTHON，其余类型走表单；验收：R5——双击节点打开编辑，保存后 DAG 与树同步。
- [ ] **T8 调试配置抽屉**（7.4）：数据源/环境/资源组/脚本参数四组配置 + 持久化；验收：配置可保存并参与运行。
- [ ] **T9 运行与日志**（8 节）：整图/单节点运行 + 状态轮询 + 增量日志 + 停止/置成功 + 运行历史；验收：R6 全链路可跑通。
- [ ] **T10 我的文件与临时查询**（9 节）：资源目录挂载 + SQL 文件 CRUD + 隐藏工作流执行链路；验收：R7/R8——新建 a.sql、编辑、运行、看日志。
- [ ] **T11 联调回归**：旧页面（工作流定义列表/DAG 编辑页/任务实例）回归不受影响；`pnpm lint`、`pnpm build:prod` 通过。

## 13. 验收标准（对照需求）

1. **R1**：项目内左侧菜单「任务」分组下，「任务实例」下方出现「数据开发（Studio）」，点击进入 IDE 页面。
2. **R2**：目录树根节点显示当前项目名称。
3. **R3**：名为 `标签A/工作流1` 的工作流出现在「标签A」目录下；无 `/` 前缀的工作流直接出现在根目录下；同名标签目录自动合并。
4. **R4**：双击树中工作流 → 新开/激活该工作流的 DAG Tab，可拖拽连线、保存，保存后旧「工作流定义」页面可见变更。
5. **R5**：双击树中 SQL 节点 → 新开节点编辑 Tab，代码与属性回填正确；修改 SQL 后保存，再打开内容一致；非 SQL 节点打开对应表单可编辑。
6. **R6**：节点 Tab 点「运行」仅执行该节点（TASK_ONLY），底部日志实时滚动，终态显示状态；DAG Tab 点「运行」执行整图。
7. **R7/R8**：「我的文件」可新建/编辑/保存 .sql；选择数据源后点「运行」，日志面板返回查询输出。

## 14. 边界与注意事项

1. **上线状态约束**：DS 中运行实例要求工作流 ONLINE；保存 ONLINE 工作流受限。所有保存/运行入口必须先检查 `releaseState` 并给出引导（7.3/8.1）。
2. **并发编辑冲突**：同一工作流在旧 DAG 页与 Studio 同时编辑会互相覆盖（整图提交）。P0 在 Studio 顶部提示"请勿在旧页面同时编辑同一工作流"；P1 可用版本号乐观锁（`version` 字段已在启动参数中存在，工作流更新接口带版本校验需后端支持，暂缓）。
3. **隐藏工作流治理**：`_adhoc_*` 工作流需在目录树、旧工作流定义列表中过滤展示（旧列表页 P0 不动，仅树过滤；提供批量清理入口）。
4. **权限**：Studio 复用项目级权限（进入即校验 projectCode 授权）；上线/下线、运行等敏感操作沿用后端既有权限校验，前端对 403 统一 toast。
5. **性能**：工作流全量分页拉取（pageSize=100 循环）在千级工作流内可接受；任务节点必须懒加载；Monaco 实例按 Tab 懒创建、关闭销毁。
6. **i18n**：新增文案统一放 `locales/*/studio.ts` 命名空间，避免散落。
7. **兼容回退**：Studio 为增量入口，旧「工作流定义/任务实例」页面全部保留；出现问题时用户可回退旧路径操作，无数据迁移风险。

## 15. 与总体路线的关系

本文档覆盖 02 文档「阶段一」中的 **IDE 化 UI + 目录树 + 节点 Tab 化 + 运行/日志 + 临时查询（P0）**。02 文档阶段一中的「元数据服务、SQL 智能补全、结构化结果集（query-service）」需要后端新增模块，不在本阶段 P0 范围，其规格见 02 文档 4.3~4.6 节；本阶段预留的扩展点：`tree-group.ts` 策略接口（tags 分组）、`adhoc/use-adhoc-run.ts`（未来切换 query-service 执行）、Monaco 扩展目录（未来补全 provider）。
