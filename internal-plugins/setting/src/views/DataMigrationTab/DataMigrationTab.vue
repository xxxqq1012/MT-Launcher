<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useToast } from '@/components'

const { success, error, confirm } = useToast()

interface DataDirInfo {
  name: string
  path: string
  exists: boolean
}

interface MigrationInfo {
  success: boolean
  currentRoot?: string
  dataDirs?: DataDirInfo[]
  dataPathConfig?: string
  configWritable?: boolean
  error?: string
}

const loading = ref(true)
const info = ref<MigrationInfo | null>(null)
const targetDir = ref('')
const migrating = ref(false)
const migratedResult = ref<{
  migrated: string[]
  skipped: string[]
  target: string
  currentRoot: string
} | null>(null)

async function loadInfo(): Promise<void> {
  loading.value = true
  try {
    const result = await window.ztools.internal.getDataMigrationInfo()
    info.value = result || null
  } catch (err: any) {
    error(`读取数据目录信息失败：${err.message}`)
  } finally {
    loading.value = false
  }
}

async function handleSelectTarget(): Promise<void> {
  try {
    const result = await window.ztools.internal.selectDataMigrationTarget()
    if (result?.cancelled) return
    if (!result?.success || !result.target) {
      error(result?.error || '选择目录失败')
      return
    }
    targetDir.value = result.target
  } catch (err: any) {
    error(`选择目录失败：${err.message}`)
  }
}

async function handleMigrate(): Promise<void> {
  if (!targetDir.value) {
    error('请先选择迁移目标目录')
    return
  }
  const confirmed = await confirm({
    title: '确认迁移全部数据',
    message: `将把当前数据目录（${info.value?.currentRoot || ''}）下的全部数据复制到新目录（${targetDir.value}）。\n\n迁移完成后应用会自动重启，之后 MT Launcher 将使用新目录读写数据。旧目录数据不会被删除，确认无误后可手动清理。\n\n迁移期间请勿进行其他操作。`,
    type: 'warning',
    confirmText: '开始迁移',
    cancelText: '取消'
  })
  if (!confirmed) return

  migrating.value = true
  try {
    const result = await window.ztools.internal.performDataMigration(targetDir.value)
    if (!result?.success) {
      error(result?.error || '迁移失败')
      return
    }
    migratedResult.value = {
      migrated: result.migrated || [],
      skipped: result.skipped || [],
      target: result.target || targetDir.value,
      currentRoot: result.currentRoot || info.value?.currentRoot || ''
    }
    success('数据迁移完成')
  } catch (err: any) {
    error(`迁移失败：${err.message}`)
  } finally {
    migrating.value = false
  }
}

async function handleRestart(): Promise<void> {
  try {
    await window.ztools.internal.restartAfterDataMigration()
  } catch (err: any) {
    error(`重启失败：${err.message}`)
  }
}

onMounted(() => {
  void loadInfo()
})
</script>

<template>
  <div class="content-panel">
    <div class="main-content">
      <div class="migration-hero">
        <div class="hero-title">迁移 MT Launcher 数据目录</div>
        <div class="hero-desc">
          将全部数据（插件、插件数据、数据库、剪贴板、头像、扩展、缓存与日志）复制到新的数据目录，
          迁移完成后应用自动重启并从新目录读写。旧目录数据保留，不自动删除。
        </div>
      </div>

      <div class="setting-group">
        <div class="setting-item">
          <div class="setting-label">
            <span>当前数据目录</span>
            <span class="setting-desc">MT Launcher 当前读写数据的位置</span>
          </div>
          <div class="setting-control">
            <code class="path-value">{{ loading ? '加载中…' : info?.currentRoot || '未知' }}</code>
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <span>数据子目录</span>
            <span class="setting-desc">将随根目录一并迁移的目录</span>
          </div>
          <div class="setting-control">
            <span class="status-value"
              >{{ info?.dataDirs?.length || 0 }} 个目录（plugins / plugins-data / lmdb / clipboard /
              avatar / extends / temp / logs）</span
            >
          </div>
        </div>
      </div>

      <div class="setting-group">
        <div class="setting-item">
          <div class="setting-label">
            <span>迁移目标目录</span>
            <span class="setting-desc">选择一个空目录作为新的数据根目录</span>
          </div>
          <div class="setting-control">
            <code v-if="targetDir" class="path-value">{{ targetDir }}</code>
            <span v-else class="status-value">尚未选择</span>
            <button
              class="btn btn-sm"
              :disabled="migrating || !!migratedResult"
              @click="handleSelectTarget"
            >
              选择目录
            </button>
          </div>
        </div>

        <div v-if="info && info.configWritable === false" class="migration-warning">
          检测到程序安装目录可能没有写入权限，迁移时写入引导文件（mt-data-path.txt）可能失败。
          如迁移失败，请以管理员身份运行 MT Launcher 后重试。
        </div>
      </div>

      <div v-if="!migratedResult" class="setting-group">
        <button
          class="btn btn-solid btn-danger-migrate"
          :disabled="migrating || !targetDir"
          @click="handleMigrate"
        >
          {{ migrating ? '正在迁移…' : '确认迁移全部数据' }}
        </button>
      </div>

      <div v-else class="setting-group">
        <div class="migration-result">
          <div class="result-title">迁移完成</div>
          <div class="result-line">
            已迁移 {{ migratedResult.migrated.length }} 个目录
            <template v-if="migratedResult.skipped.length"
              >，跳过已存在目录 {{ migratedResult.skipped.join('、') }}</template
            >
          </div>
          <div class="result-line">新数据目录：{{ migratedResult.target }}</div>
          <div class="result-line">旧数据目录：{{ migratedResult.currentRoot }}（已保留）</div>
        </div>
        <button class="btn btn-primary btn-sm" style="margin-top: 12px" @click="handleRestart">
          立即重启应用
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.content-panel {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-color);
}

.main-content {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
}

.migration-hero {
  margin-bottom: 24px;
}

.hero-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 6px;
}

.hero-desc {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.7;
}

.setting-group {
  margin-bottom: 28px;
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 0;
  border-bottom: 1px solid var(--divider-color);
  gap: 20px;
}

.setting-label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.setting-label > span:first-child {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
}

.setting-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.path-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 12px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
  max-width: 420px;
}

.status-value {
  font-size: 13px;
  color: var(--text-secondary);
}

.migration-warning {
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--warning-color, #f0a020);
  background: color-mix(in srgb, var(--warning-color, #f0a020), transparent 90%);
}

.btn-danger-migrate {
  background: var(--primary-color);
  color: #fff;
  border: none;
  padding: 10px 22px;
  font-size: 13.5px;
  border-radius: 8px;
  cursor: pointer;
}

.btn-danger-migrate:disabled {
  opacity: 0.55;
  cursor: default;
}

.migration-result {
  padding: 14px 16px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: color-mix(in srgb, var(--success-color, #18a058), transparent 92%);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.result-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--success-color, #18a058);
}

.result-line {
  font-size: 12.5px;
  color: var(--text-color);
  line-height: 1.5;
}
</style>
