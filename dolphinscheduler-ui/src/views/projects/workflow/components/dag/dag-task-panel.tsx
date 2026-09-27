/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  defineComponent,
  PropType,
  ref,
  computed,
  provide,
  onMounted,
  nextTick,
  h,
  Ref
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { NTabs, NTabPane, NButton, NSpace, NIcon, NTooltip } from 'naive-ui'
import {
  HistoryOutlined,
  ProfileOutlined,
  QuestionCircleTwotone,
  BranchesOutlined,
  DoubleLeftOutlined,
  DoubleRightOutlined
} from '@vicons/antd'
import ButtonLink from '@/components/button-link'
import Detail from '@/views/projects/task/components/node/detail'
import { formatModel } from '@/views/projects/task/components/node/format-data'
import { useTaskNodeStore } from '@/store/project/task-node'
import { useThemeStore } from '@/store/theme/theme'
import { queryProjectPreferenceByProjectCode } from '@/service/modules/projects-preference'
import { TASK_TYPES_MAP } from '@/views/projects/task/constants/task-type'
import Styles from './dag-task-panel.module.scss'
import type {
  EditWorkflowDefinition,
  WorkflowInstance
} from './types'
import type { PanelTab } from './use-task-panel'

import type {
  ITaskData,
  IWorkflowTaskInstance,
  INodeData
} from '@/views/projects/task/components/node/types'

const MIN_WIDTH = 30
const MAX_WIDTH = 80

/**
 * One editable task node inside the panel.
 * It reuses the exact same Detail form as NodeDetailModal,
 * so all history configurations are compatible.
 */
const PanelItem = defineComponent({
  name: 'DagTaskPanelItem',
  props: {
    data: {
      type: Object as PropType<ITaskData>,
      required: true
    },
    projectCode: {
      type: Number as PropType<number>,
      default: 0
    },
    readonly: {
      type: Boolean as PropType<boolean>,
      default: false
    },
    definition: {
      type: Object as PropType<Ref<EditWorkflowDefinition>>
    },
    workflowInstance: {
      type: Object as PropType<WorkflowInstance>
    },
    taskInstance: {
      type: Object as PropType<IWorkflowTaskInstance>
    }
  },
  emits: ['submit', 'cancel', 'viewLog'],
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const router = useRouter()
    const taskStore = useTaskNodeStore()

    const detailRef = ref()
    const headerLinks = ref([] as any)
    const projectPreferences = ref({} as any)

    const handleViewLog = () => {
      if (props.taskInstance) {
        emit('viewLog', props.taskInstance.id, props.taskInstance.taskType)
      }
    }

    const initProjectPreferences = (projectCode: number) => {
      queryProjectPreferenceByProjectCode(projectCode).then((result: any) => {
        if (result?.preferences && result.state === 1) {
          projectPreferences.value = JSON.parse(result.preferences)
        }
      })
    }

    const restructureNodeData = (data: INodeData) => {
      if (!data?.id) {
        const allowedFields = [
          'taskPriority',
          'workerGroup',
          'environmentCode',
          'failRetryTimes',
          'failRetryInterval',
          'cpuQuota',
          'memoryMax',
          'timeoutFlag',
          'timeoutNotifyStrategy',
          'timeout'
        ]
        for (const item in projectPreferences.value) {
          if (
            projectPreferences.value[item] !== null &&
            allowedFields.includes(item)
          ) {
            Object.assign(data, { [item]: projectPreferences.value[item] })
          }
        }
      }
    }

    const initHeaderLinks = (workflowInstance: any, taskType?: string) => {
      headerLinks.value = [
        {
          text: t('project.node.instructions'),
          //show: !!(taskType && !TASK_TYPES_MAP[taskType]?.helperLinkDisable),
          show: !!(
            taskType &&
            !TASK_TYPES_MAP[taskType as keyof typeof TASK_TYPES_MAP]
              ?.helperLinkDisable
          ),

          action: () => {
            let linkedTaskType = taskType?.toLowerCase().replace('_', '-')
            if (taskType === 'PROCEDURE') linkedTaskType = 'stored-procedure'
            const helpUrl =
              'https://dolphinscheduler.apache.org/' +
              locale.value.toLowerCase().replace('_', '-') +
              '/docs/latest/user_doc/guide/task/' +
              linkedTaskType +
              '.html'
            window.open(helpUrl)
          },
          icon: () =>
            h(NIcon, null, { default: () => h(QuestionCircleTwotone) })
        },
        {
          text: t('project.node.view_history'),
          show: !!props.taskInstance,
          action: () => {
            router.push({
              name: 'task-instance',
              query: {
                taskCode: props.data.code
              }
            })
          },
          icon: () => h(NIcon, null, { default: () => h(HistoryOutlined) })
        },
        {
          text: t('project.node.view_log'),
          show: !!props.taskInstance,
          action: () => {
            handleViewLog()
          },
          icon: () => h(NIcon, null, { default: () => h(ProfileOutlined) })
        },
        {
          text: t('project.node.enter_this_child_node'),
          show: props.data.taskType === 'SUB_WORKFLOW',
          disabled:
            !props.data.id ||
            (router.currentRoute.value.name === 'workflow-instance-detail' &&
              !props.taskInstance),
          action: () => {
            if (router.currentRoute.value.name === 'workflow-instance-detail') {
              router.push({
                name: 'workflow-instance-detail',
                params: { id: props.taskInstance?.id },
                query: { code: props.data.taskParams?.workflowDefinitionCode }
              })
            } else {
              router.push({
                name: 'workflow-definition-detail',
                params: { code: props.data.taskParams?.workflowDefinitionCode }
              })
            }
          },
          icon: () => h(NIcon, null, { default: () => h(BranchesOutlined) })
        }
      ]
    }

    const onTaskTypeChange = (taskType: string) => {
      // eslint-disable-next-line vue/no-mutating-props
      props.data.taskType = taskType as any
      initHeaderLinks(props.workflowInstance, props.data.taskType)
    }

    provide(
      'data',
      computed(() => ({
        projectCode: props.projectCode,
        data: props.data,
        from: 0,
        readonly: props.readonly,
        definition: props.definition
      }))
    )

    onMounted(async () => {
      initProjectPreferences(props.projectCode)
      initHeaderLinks(props.workflowInstance, props.data.taskType)
      taskStore.init()
      const nodeData = formatModel(props.data)
      await nextTick()
      restructureNodeData(nodeData)
      detailRef.value.value.setValues(nodeData)
    })

    const onConfirm = async () => {
      await detailRef.value.value.validate()
      emit('submit', {
        data: detailRef.value.value.getValues(),
        code: props.data.code
      })
    }

    return () => (
      <div class={Styles['panel-item']}>
        <div class={Styles['panel-links']}>
          <NSpace justify='space-between' align='center' wrap={false}>
            <NSpace wrap={false} size='small' align='center'>
              {headerLinks.value
                .filter((item: any) => item.show)
                .map((item: any) => (
                  <ButtonLink onClick={item.action} disabled={item.disabled}>
                    {{
                      default: () => item.text,
                      icon: () => item.icon()
                    }}
                  </ButtonLink>
                ))}
            </NSpace>
            <NSpace wrap={false} size='small'>
              <NButton
                class='btn-cancel'
                quaternary
                size='small'
                onClick={() => emit('cancel', props.data.code)}
              >
                {t('modal.cancel')}
              </NButton>
              <NButton
                class='btn-submit'
                type='info'
                size='small'
                onClick={onConfirm}
                disabled={props.readonly}
              >
                {t('modal.confirm')}
              </NButton>
            </NSpace>
          </NSpace>
        </div>
        <div class={Styles['panel-form']}>
          <Detail
            ref={detailRef}
            onTaskTypeChange={onTaskTypeChange}
            key={props.data.taskType}
          />
        </div>
      </div>
    )
  }
})

/**
 * The right-side tabbed panel for editing task nodes,
 * an optional plugin to replace NodeDetailModal.
 * Controlled by the `editPanelMode` switch in the UI setting store.
 */
const DagTaskPanel = defineComponent({
  name: 'DagTaskPanel',
  props: {
    tabs: {
      type: Array as PropType<PanelTab[]>,
      default: () => []
    },
    activeCode: {
      type: Number as PropType<number>,
      default: 0
    },
    definition: {
      type: Object as PropType<Ref<EditWorkflowDefinition>>
    },
    projectCode: {
      type: Number as PropType<number>,
      default: 0
    },
    readonly: {
      type: Boolean as PropType<boolean>,
      default: false
    },
    workflowInstance: {
      type: Object as PropType<WorkflowInstance>
    },
    taskList: {
      type: Array as PropType<IWorkflowTaskInstance[]>,
      default: () => []
    }
  },
  emits: ['close', 'confirm', 'update:activeCode', 'resizeEnd', 'viewLog'],
  setup(props, { emit }) {
    const { t } = useI18n()
    const theme = useThemeStore()

    const panelRef = ref()
    const width = ref(50)
    const dragging = ref(false)
    const collapsed = ref(false)
    const lastWidth = ref(50)
    let startX = 0
    let startWidth = 50

    const toggleCollapse = () => {
      if (!collapsed.value) {
        lastWidth.value = width.value
      }
      collapsed.value = !collapsed.value
      nextTick(() => emit('resizeEnd'))
    }

    const onDragMove = (e: MouseEvent) => {
      const container = panelRef.value?.parentElement
      const containerWidth =
        container?.getBoundingClientRect().width || window.innerWidth
      const delta = startX - e.clientX
      const next = startWidth + (delta / containerWidth) * 100
      width.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next))
    }

    const onDragEnd = () => {
      dragging.value = false
      document.removeEventListener('mousemove', onDragMove)
      document.removeEventListener('mouseup', onDragEnd)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      emit('resizeEnd')
    }

    const onDragStart = (e: MouseEvent) => {
      dragging.value = true
      startX = e.clientX
      startWidth = width.value
      document.addEventListener('mousemove', onDragMove)
      document.addEventListener('mouseup', onDragEnd)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    const findTask = (code: number) =>
      props.definition?.value?.taskDefinitionList?.find(
        (task) => task.code === code
      )

    return () => {
      if (!props.tabs.length) return null

      return (
        <div
          ref={panelRef}
          class={[
            Styles.panel,
            theme.darkTheme ? Styles['panel-dark'] : Styles['panel-light'],
            dragging.value && Styles.dragging,
            collapsed.value && Styles.collapsed
          ]}
          style={{ width: collapsed.value ? '16px' : `${width.value}%` }}
        >
          <div
            class={[Styles['drag-bar'], dragging.value && Styles.active]}
            onMousedown={onDragStart}
          />
          <NTooltip>
            {{
              trigger: () => (
                <div
                  class={Styles['collapse-bar']}
                  onClick={toggleCollapse}
                >
                  <NIcon size={12}>
                    {collapsed.value ? (
                      <DoubleLeftOutlined />
                    ) : (
                      <DoubleRightOutlined />
                    )}
                  </NIcon>
                </div>
              ),
              default: () =>
                collapsed.value
                  ? t('project.workflow.panel_expand')
                  : t('project.workflow.panel_collapse')
            }}
          </NTooltip>
          <div
            v-show={!collapsed.value}
            class={Styles['panel-header']}
          >
            <NTabs
              type='card'
              size='small'
              value={String(props.activeCode)}
              onUpdate:value={(v: string | number) =>
                emit('update:activeCode', Number(v))
              }
              onClose={(name: string | number) => emit('close', Number(name))}
            >
              {props.tabs.map((tab) => {
                const task = findTask(tab.code)
                if (!task) return null
                const taskInstance = props.taskList.find(
                  (t) => t.taskCode === tab.code
                )
                return (
                  <NTabPane
                    name={String(tab.code)}
                    tab={tab.name || tab.taskType}
                    display-directive='show:lazy'
                    closable
                  >
                    <PanelItem
                      data={task as any}
                      projectCode={props.projectCode}
                      readonly={props.readonly}
                      definition={props.definition}
                      workflowInstance={props.workflowInstance}
                      taskInstance={taskInstance}
                      onSubmit={(payload: any) => emit('confirm', payload)}
                      onCancel={(code: number) => emit('close', code)}
                      onViewLog={(taskId: number, taskType: string) =>
                        emit('viewLog', taskId, taskType)
                      }
                    />
                  </NTabPane>
                )
              })}
            </NTabs>
          </div>
        </div>
      )
    }
  }
})

export default DagTaskPanel
