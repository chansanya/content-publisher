<script setup lang="ts">
import { LoaderCircle } from 'lucide-vue-next'

defineProps<{
  visible: boolean
  title: string
  name?: string
  target?: string
  hint?: string
}>()
</script>

<template>
  <Teleport to="body">
    <Transition name="operation-loading">
      <div v-if="visible" class="operation-loading-overlay" role="status" aria-live="polite">
        <div class="operation-loading-panel">
          <div class="operation-loading-icon">
            <LoaderCircle :size="34" :stroke-width="1.8" />
          </div>
          <div class="operation-loading-title">{{ title }}</div>
          <div v-if="name" class="operation-loading-name mono">{{ name }}</div>
          <div v-if="target" class="operation-loading-target mono" :title="target">{{ target }}</div>
          <div class="operation-loading-track"><span /></div>
          <div v-if="hint" class="operation-loading-hint">{{ hint }}</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.operation-loading-overlay {
  position: fixed;
  inset: 0;
  z-index: 3200;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(5, 9, 15, 0.78);
  backdrop-filter: blur(9px);
}

.operation-loading-panel {
  width: min(420px, 100%);
  padding: 32px 36px 28px;
  border: 1px solid rgba(248, 113, 113, 0.25);
  border-radius: 20px;
  text-align: center;
  background:
    radial-gradient(circle at 50% 0, rgba(248, 113, 113, 0.1), transparent 52%),
    #101722;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.48);
}

.operation-loading-icon {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin: 0 auto 18px;
  border: 1px solid rgba(248, 113, 113, 0.25);
  border-radius: 18px;
  color: var(--fp-danger);
  background: rgba(248, 113, 113, 0.08);
}

.operation-loading-icon .lucide {
  animation: operation-loading-spin 0.9s linear infinite;
}

.operation-loading-title {
  color: var(--fp-text);
  font-size: 18px;
  font-weight: 800;
}

.operation-loading-name {
  margin-top: 9px;
  color: var(--fp-danger);
  font-size: 13px;
  font-weight: 700;
}

.operation-loading-target {
  margin-top: 6px;
  overflow: hidden;
  color: var(--fp-text-muted);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operation-loading-track {
  height: 4px;
  margin-top: 22px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.1);
}

.operation-loading-track span {
  display: block;
  width: 42%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, var(--fp-danger), transparent);
  animation: operation-loading-track 1.3s ease-in-out infinite;
}

.operation-loading-hint {
  margin-top: 12px;
  color: var(--fp-text-faint);
  font-size: 11px;
}

.operation-loading-enter-active,
.operation-loading-leave-active {
  transition: opacity 0.18s ease;
}

.operation-loading-enter-from,
.operation-loading-leave-to {
  opacity: 0;
}

@keyframes operation-loading-spin {
  to { transform: rotate(360deg); }
}

@keyframes operation-loading-track {
  from { transform: translateX(-120%); }
  to { transform: translateX(340%); }
}
</style>
