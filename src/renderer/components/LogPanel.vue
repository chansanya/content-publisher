<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, Terminal, Trash2 } from 'lucide-vue-next'
import { useLogsStore } from '@renderer/stores/logs'

const HEIGHT_KEY = 'fp-log-panel-height'

const logs = useLogsStore()
const collapsed = ref(true)
const listRef = ref<HTMLElement | null>(null)
const count = computed(() => logs.entries.length)

const height = ref(clampHeight(Number(localStorage.getItem(HEIGHT_KEY)) || 148))
const dragging = ref(false)
let startY = 0
let startHeight = 0

function clampHeight(value: number): number {
  return Math.min(480, Math.max(72, Math.round(value)))
}

function onResizeStart(event: PointerEvent): void {
  dragging.value = true
  startY = event.clientY
  startHeight = height.value
  collapsed.value = false
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  document.body.style.userSelect = 'none'
}

function onResizeMove(event: PointerEvent): void {
  if (!dragging.value) return
  height.value = clampHeight(startHeight + (startY - event.clientY))
}

function onResizeEnd(event: PointerEvent): void {
  if (!dragging.value) return
  dragging.value = false
  document.body.style.userSelect = ''
  localStorage.setItem(HEIGHT_KEY, String(height.value))
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
}

onBeforeUnmount(() => {
  if (dragging.value) document.body.style.userSelect = ''
})

watch(
  () => logs.entries.length,
  async () => {
    const latest = logs.entries.at(-1)
    if (
      latest?.scope === 'publish' &&
      (latest.message.startsWith('正在读取远程目录') || latest.message.startsWith('[1/'))
    ) {
      collapsed.value = false
    }
    if (collapsed.value) return
    await nextTick()
    listRef.value?.scrollTo({ top: listRef.value.scrollHeight })
  }
)
</script>

<template>
  <section class="log-panel">
    <div
      class="log-panel-resizer"
      :class="{ 'is-active': dragging }"
      title="拖动调整高度"
      @pointerdown="onResizeStart"
      @pointermove="onResizeMove"
      @pointerup="onResizeEnd"
      @pointercancel="onResizeEnd"
    >
      <span class="grip" />
    </div>
    <div class="log-panel-head" @click="collapsed = !collapsed">
      <Terminal :size="14" class="lucide" style="color: var(--fp-accent)" />
      <span class="title">全局日志</span>
      <span class="mono" style="color: var(--fp-text-faint); font-size: 11px">{{ count }}</span>
      <span style="flex: 1" />
      <button
        class="el-button el-button--small is-text"
        style="padding: 2px 6px"
        title="清空日志"
        @click.stop="logs.clear()"
      >
        <Trash2 :size="13" />
      </button>
      <component :is="collapsed ? ChevronUp : ChevronDown" :size="14" style="color: var(--fp-text-faint)" />
    </div>
    <div v-show="!collapsed" ref="listRef" class="log-list" :style="{ height: `${height}px` }">
      <div v-if="logs.entries.length === 0" class="log-line">
        <span class="msg" style="color: var(--fp-text-faint)">暂无日志</span>
      </div>
      <div
        v-for="entry in logs.entries"
        :key="entry.id"
        class="log-line"
        :class="`is-${entry.level}`"
      >
        <span class="t">{{ entry.time }}</span>
        <span class="scope">{{ entry.scope }}</span>
        <span class="msg">{{ entry.message }}</span>
      </div>
    </div>
  </section>
</template>
