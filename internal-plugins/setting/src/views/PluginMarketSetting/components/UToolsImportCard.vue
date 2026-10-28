<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useToast } from '@/components'

const { info, error } = useToast()

type ImportState = 'checking' | 'not-found' | 'ready' | 'importing'
const state = ref<ImportState>('checking')
const available = ref(0)
const imported = ref(0)

onMounted(async () => {
  try {
    const r = await window.ztools.internal.mtoolsCheckUToolsPlugins()
    if (!r.utoolsInstalled || r.available === 0) {
      state.value = 'not-found'
    } else {
      state.value = 'ready'
      available.value = r.available
      imported.value = r.imported
    }
  } catch (e) {
    console.error('检测 uTools 插件失败:', e)
    state.value = 'not-found'
  }
})

function openUToolsSite(): void {
  window.ztools.shellOpenExternal('https://www.u-tools.cn/')
}

async function doImport(): Promise<void> {
  if (state.value !== 'ready') return
  state.value = 'importing'
  try {
    await window.ztools.internal.mtoolsImportUToolsPlugins()
    info('导入完成，插件已登记到 MT Launcher')
    imported.value = available.value
    state.value = 'ready'
  } catch (e: any) {
    console.error('导入 uTools 插件失败:', e)
    error('导入失败: ' + (e?.message || '未知错误'))
    state.value = 'ready'
  }
}
</script>

<template>
  <div class="utools-import-card">
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

    <div class="utools-import-body">
      <template v-if="state === 'checking'">
        <div class="utools-import-title">正在检测 uTools 插件…</div>
      </template>

      <template v-else-if="state === 'not-found'">
        <div class="utools-import-title">从 uTools 导入插件</div>
        <div class="utools-import-desc">
          未检测到 uTools 插件。安装 uTools 并在其中使用过的插件，可一键迁移到 MT
          Launcher，无需重新开发。
        </div>
        <button class="utools-import-btn" @click="openUToolsSite">打开 uTools 官网</button>
      </template>

      <template v-else>
        <div class="utools-import-title">从 uTools 导入插件</div>
        <div class="utools-import-desc">
          检测到 {{ available }} 个已安装的 uTools 插件（已导入
          {{ imported }} 个），点击下方按钮一键迁移。
        </div>
        <button
          class="utools-import-btn primary"
          :disabled="state === 'importing'"
          @click="doImport"
        >
          {{ state === 'importing' ? '正在导入…' : '一键导入全部' }}
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.utools-import-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  border-radius: 12px;
  background: linear-gradient(135deg, #3b5bdb 0%, #312e81 100%);
  color: #fff;
  margin-bottom: 16px;
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
.utools-import-body {
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
.utools-import-btn {
  margin-top: 10px;
  padding: 6px 16px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.45);
  background: transparent;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
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
</style>
