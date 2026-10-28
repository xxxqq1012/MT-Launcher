<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useToast } from '@/components'

const { info, error } = useToast()

interface UToolsPluginInfo {
  installId: string
  name: string
  version: string
  title: string
  description: string
  adopted: boolean
  adoptedVersion?: string
}

type ImportState = 'checking' | 'not-found' | 'ready' | 'importing'
const state = ref<ImportState>('checking')
const plugins = ref<UToolsPluginInfo[]>([])
const selected = ref<Set<string>>(new Set())

const importableCount = computed(() => plugins.value.filter((p) => !p.adopted).length)
const selectedCount = computed(
  () =>
    [...selected.value].filter((id) => {
      const p = plugins.value.find((x) => x.installId === id)
      return p && !p.adopted
    }).length
)

function versionDiffers(p: UToolsPluginInfo): boolean {
  return p.adopted && p.adoptedVersion !== undefined && p.adoptedVersion !== p.version
}

onMounted(async () => {
  await refresh()
})

async function refresh(): Promise<void> {
  state.value = 'checking'
  try {
    const r = await window.ztools.internal.mtoolsCheckUToolsPlugins()
    plugins.value = r.plugins || []
    if (!r.utoolsInstalled || plugins.value.length === 0) {
      state.value = 'not-found'
    } else {
      state.value = 'ready'
      // 默认全选未导入项
      selected.value = new Set(plugins.value.filter((p) => !p.adopted).map((p) => p.installId))
    }
  } catch (e) {
    console.error('检测 uTools 插件失败:', e)
    state.value = 'not-found'
  }
}

function toggle(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function openUToolsSite(): void {
  window.ztools.shellOpenExternal('https://www.u-tools.cn/')
}

async function doImport(): Promise<void> {
  if (state.value !== 'ready' || selectedCount.value === 0) return
  state.value = 'importing'
  try {
    await window.ztools.internal.mtoolsImportUToolsPlugins([...selected.value])
    info(`导入完成，共登记 ${selectedCount.value} 个插件`)
    await refresh()
  } catch (e: any) {
    console.error('导入 uTools 插件失败:', e)
    error('导入失败: ' + (e?.message || '未知错误'))
    state.value = 'ready'
  }
}
</script>

<template>
  <div class="utools-import-panel">
    <div class="utools-import-head">
      <div class="utools-import-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M4 17V6C4 4.89543 4.89543 4 6 4H18C19.1046 4 20 4.89543 20 6V14C20 15.1046 19.1046 16 18 16H9L5 20V17"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M12 7V13M12 13L9.5 10.5M12 13L14.5 10.5"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
      <div class="utools-import-meta">
        <div class="utools-import-title">从 uTools 导入插件</div>
        <div class="utools-import-desc">
          <template v-if="state === 'checking'">正在检测 uTools 插件…</template>
          <template v-else-if="state === 'not-found'">
            未检测到可导入的插件。安装 uTools 并在其中使用过的插件，可一键迁移到 MT Launcher。
          </template>
          <template v-else>
            检测到 {{ plugins.length }} 个已安装的 uTools 插件（已导入
            {{ plugins.length - importableCount }} 个），勾选后导入，无需重新开发。
          </template>
        </div>
      </div>
      <div v-if="state === 'ready'" class="utools-import-actions">
        <button class="utools-import-btn" @click="openUToolsSite">uTools 官网</button>
        <button
          class="utools-import-btn primary"
          :disabled="state === 'importing' || selectedCount === 0"
          @click="doImport"
        >
          {{ state === 'importing' ? '正在导入…' : `导入勾选项（${selectedCount}）` }}
        </button>
      </div>
      <button v-else-if="state === 'not-found'" class="utools-import-btn" @click="openUToolsSite">
        打开 uTools 官网
      </button>
    </div>

    <!-- 插件明细列表 -->
    <div v-if="state === 'ready'" class="utools-import-list">
      <label
        v-for="p in plugins"
        :key="p.installId"
        class="utools-import-item"
        :class="{ disabled: p.adopted }"
      >
        <input
          type="checkbox"
          :checked="selected.has(p.installId)"
          :disabled="p.adopted"
          @change="toggle(p.installId)"
        />
        <span class="utools-item-name">{{ p.title }}</span>
        <span class="utools-item-ver">v{{ p.version }}</span>
        <span v-if="p.adopted" class="utools-item-tag adopted">
          {{ versionDiffers(p) ? `已导入 v${p.adoptedVersion}（源为 v${p.version}）` : '已导入' }}
        </span>
        <span v-else class="utools-item-tag pending">可导入</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.utools-import-panel {
  border-radius: 12px;
  background: linear-gradient(135deg, #3b5bdb 0%, #312e81 100%);
  color: #fff;
  margin-bottom: 16px;
  overflow: hidden;
}
.utools-import-head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
}
.utools-import-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.16);
}
.utools-import-meta {
  flex: 1;
  min-width: 0;
}
.utools-import-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.5;
}
.utools-import-desc {
  font-size: 12px;
  opacity: 0.85;
  margin-top: 4px;
  line-height: 1.6;
}
.utools-import-actions {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
}
.utools-import-btn {
  padding: 6px 16px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.45);
  background: transparent;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}
.utools-import-btn:hover {
  background: rgba(255, 255, 255, 0.14);
}
.utools-import-btn.primary {
  background: #fff;
  color: #312e81;
  border: none;
  font-weight: 600;
}
.utools-import-btn.primary:hover {
  background: #eef2ff;
}
.utools-import-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.utools-import-list {
  background: rgba(255, 255, 255, 0.08);
  border-top: 1px solid rgba(255, 255, 255, 0.14);
  padding: 8px 18px;
}
.utools-import-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
  font-size: 13px;
}
.utools-import-item:last-child {
  border-bottom: none;
}
.utools-import-item.disabled {
  opacity: 0.72;
  cursor: default;
}
.utools-import-item input[type='checkbox'] {
  flex-shrink: 0;
  width: 15px;
  height: 15px;
  accent-color: #fff;
}
.utools-item-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.utools-item-ver {
  flex-shrink: 0;
  font-size: 12px;
  opacity: 0.8;
}
.utools-item-tag {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 999px;
}
.utools-item-tag.adopted {
  background: rgba(255, 255, 255, 0.22);
}
.utools-item-tag.pending {
  background: #4ade80;
  color: #14532d;
  font-weight: 600;
}
</style>
