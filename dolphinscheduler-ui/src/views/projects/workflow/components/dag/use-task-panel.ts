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

import { ref } from 'vue'
import type { Ref } from 'vue'
import type { NodeData } from './types'

export interface PanelTab {
  code: number
  name: string
  taskType: string
}

/**
 * State of the right-side panel edit mode:
 * multiple task nodes can be opened as tabs at the same time
 */
export function useTaskPanel() {
  const tabs = ref<PanelTab[]>([])
  const activeCode = ref(0)

  /**
   * Open a task node as a tab (or activate it if already opened)
   */
  function openTab(task: Pick<NodeData, 'code' | 'name' | 'taskType'>) {
    const exist = tabs.value.find((t) => t.code === task.code)
    if (exist) {
      if (task.name) exist.name = task.name
      activeCode.value = task.code
      return
    }
    tabs.value.push({
      code: task.code,
      name: task.name || task.taskType,
      taskType: task.taskType as string
    })
    activeCode.value = task.code
  }

  /**
   * Close a tab, activate the nearest neighbor when the active one is closed
   */
  function closeTab(code: number) {
    const index = tabs.value.findIndex((t) => t.code === code)
    if (index === -1) return
    tabs.value.splice(index, 1)
    if (activeCode.value === code) {
      const next = tabs.value[index] || tabs.value[index - 1]
      activeCode.value = next ? next.code : 0
    }
  }

  /**
   * Rename a tab (after the node is confirmed with a new name)
   */
  function renameTab(code: number, name: string) {
    const tab = tabs.value.find((t) => t.code === code)
    if (tab && name) tab.name = name
  }

  return {
    tabs,
    activeCode,
    openTab,
    closeTab,
    renameTab
  } as {
    tabs: Ref<PanelTab[]>
    activeCode: Ref<number>
    openTab: (task: Pick<NodeData, 'code' | 'name' | 'taskType'>) => void
    closeTab: (code: number) => void
    renameTab: (code: number, name: string) => void
  }
}
