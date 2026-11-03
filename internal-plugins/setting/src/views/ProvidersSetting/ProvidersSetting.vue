<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import AiModelsSetting from '@/views/AiModelsSetting/AiModelsSetting.vue'
import TranslationProviders from './components/TranslationProviders.vue'
import McpServiceSetting from '@/views/McpServiceSetting/McpServiceSetting.vue'
import DebugSetting from '@/views/DebugSetting/DebugSetting.vue'
import PermissionSetting from '@/views/PermissionSetting/PermissionSetting.vue'
import HttpServiceSetting from '@/views/HttpServiceSetting/HttpServiceSetting.vue'

type Tab = 'ai' | 'translation' | 'mcp' | 'debug' | 'permissions' | 'http'

const route = useRoute()

// 支持通过 query.tab 深链直达某个 tab（如通用设置页的「前往翻译」）
const initialTab = ((): Tab => {
  const t = typeof route.query.tab === 'string' ? route.query.tab : ''
  const validTabs: Tab[] = ['ai', 'translation', 'mcp', 'debug', 'permissions', 'http']
  return validTabs.includes(t as Tab) ? (t as Tab) : 'ai'
})()

const activeTab = ref<Tab>(initialTab)

const tabs: Array<{ key: Tab; label: string }> = [
  { key: 'ai', label: 'AI' },
  { key: 'translation', label: '翻译' },
  { key: 'mcp', label: 'MCP服务' },
  { key: 'debug', label: '调试日志' },
  { key: 'permissions', label: '高级权限' },
  { key: 'http', label: 'HTTP服务' }
]
</script>

<template>
  <div class="providers-container">
    <!-- 顶部 Tab -->
    <div class="providers-tabs">
      <div class="tab-group">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="tab-btn"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!-- 内容区：每个 tab 独立视图 -->
    <div class="providers-content">
      <AiModelsSetting v-show="activeTab === 'ai'" />
      <TranslationProviders v-if="activeTab === 'translation'" />
      <McpServiceSetting v-if="activeTab === 'mcp'" />
      <DebugSetting v-if="activeTab === 'debug'" />
      <PermissionSetting v-if="activeTab === 'permissions'" />
      <HttpServiceSetting v-if="activeTab === 'http'" />
    </div>
  </div>
</template>

<style scoped>
.providers-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-color);
}

.providers-tabs {
  padding: 12px 20px 0;
  flex-shrink: 0;
  overflow-x: auto;
}

.providers-content {
  flex: 1;
  min-height: 0;
  position: relative;
}

/* Tab 样式与 PluginsSetting 一致 */
.tab-group {
  display: flex;
  gap: 6px;
  background: var(--control-bg);
  padding: 3px;
  border-radius: 8px;
  width: fit-content;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  font-size: 13px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 500;
  white-space: nowrap;
}

.tab-btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.tab-btn.active {
  background: var(--active-bg);
  color: var(--primary-color);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
</style>
