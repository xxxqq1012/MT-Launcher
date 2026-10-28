<script setup lang="ts">
import defaultAvatar from '@/assets/image/default.png'
import { useToast } from '@/components'
import { ACCOUNT_CHANGED_EVENT } from '@/composables/useZToolsAccount'
import { MenuRouterItemType } from '@/router'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAccountProfile, useNotificationCenter } from '@/composables'
import { useRoute, useRouter } from 'vue-router'

const router = useRouter()
const route = useRoute()
const { success, error, warning, confirm } = useToast()
const { unreadCount, unreadLabel } = useNotificationCenter()
const { state: accountProfile, refresh: refreshAccountProfile } = useAccountProfile()

const menuRoutes = ref<MenuRouterItemType[]>([] as MenuRouterItemType[])
let stopSyncStatusListener: (() => void) | null = null

const loggedIn = computed(() => accountProfile.loggedIn)
const avatar = computed(() => accountProfile.avatarUrl || defaultAvatar)
const displayName = computed(() => accountProfile.nickname || accountProfile.uid || 'ZTools 用户')

/**
 * 切换右侧设置页面。
 * @param item 要切换到的菜单路由项
 * @returns 无返回值
 */
const setActiveMenu = (item: MenuRouterItemType): void => {
  // 菜单导航直接替换右侧路由内容。
  router.replace({ name: item.name })
}

// 自动加载路由
const autoLoadRouter = (): void => {
  menuRoutes.value = router
    .getRoutes()
    .filter((item) => item.meta)
    .filter((item) => item.path.split('/').length <= 2)
    .filter((item) => item.meta.menu) as MenuRouterItemType[]
}

onMounted(() => {
  autoLoadRouter()
  void loadAccount(false)
  window.addEventListener(ACCOUNT_CHANGED_EVENT, handleAccountChanged)
  stopSyncStatusListener =
    window.ztools.internal.onSyncStatusChanged?.((payload = {}) => {
      if (payload.credentialsInvalidated || payload.accountCredentialsInvalidated) {
        void loadAccount(true)
      }
    }) || null
})

onBeforeUnmount(() => {
  window.removeEventListener(ACCOUNT_CHANGED_EVENT, handleAccountChanged)
  stopSyncStatusListener?.()
  stopSyncStatusListener = null
})

/**
 * 响应账号会话或资料变化并强制刷新共享状态。
 * @returns 无返回值
 */
function handleAccountChanged(): void {
  void loadAccount(true)
}

/**
 * 刷新共享账号资料，并在登录态失效时退出个人中心。
 * @param force 是否废弃正在执行的刷新并重新请求服务端
 * @returns 刷新完成后结束的 Promise
 */
async function loadAccount(force: boolean = false): Promise<void> {
  await refreshAccountProfile({ force })
  if (!accountProfile.loggedIn && route.name === 'Account') {
    // 登录态失效后离开账号页面，避免继续展示过期账号信息。
    await router.replace({ name: 'GeneralSetting' })
  }
}

/**
 * 打开设置插件内的消息中心。
 * @returns 无返回值。
 */
function openNotifications(): void {
  void router.replace({ name: 'Notifications' })
}
</script>

<template>
  <!-- 左侧菜单 -->
  <div class="settings-sidebar">
    <div class="menu-list">
      <div
        v-for="menuRoute in menuRoutes"
        :key="menuRoute.name"
        class="menu-item"
        :class="{ active: route.name === menuRoute.name }"
        @click="setActiveMenu(menuRoute)"
      >
        <div :class="menuRoute.meta?.menu?.icon ?? ''" class="menu-icon" style="font-size: 18px" />
        <span class="menu-label">{{ menuRoute.meta?.menu?.label ?? '' }}</span>
      </div>
    </div>

    <div class="sidebar-footer" :class="{ active: route.name === 'Notifications' }">
      <button
        class="notification-dock"
        :class="{ active: route.name === 'Notifications' }"
        type="button"
        title="消息中心"
        @click="openNotifications"
      >
        <div class="i-z-bell" />
        <span v-if="unreadCount > 0" class="notification-badge">{{ unreadLabel }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 左侧菜单 */
.settings-sidebar {
  display: flex;
  flex-direction: column;
  width: 200px;
  height: 100%;
  border-right: 1px solid var(--divider-color);
  min-height: 0;
}

.menu-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 10px;
  padding: 8px;
}

.menu-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  gap: 10px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text-color);
  border-radius: 8px;
}

.menu-item:last-child {
  margin-bottom: 0;
}

.menu-item:hover {
  background: var(--hover-bg);
}

.menu-item.active {
  background: var(--active-bg);
  color: var(--primary-color);
  font-weight: 500;
}

.account-dock {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  padding: 10px;
  text-align: left;
  transition: all 0.2s;
}

.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 8px 8px;
  border-radius: 8px;
}

.sidebar-footer.active {
  background: var(--active-bg);
}

.sidebar-footer:not(.active):hover {
  background: var(--hover-bg);
}

.notification-dock {
  position: relative;
  flex: none;
  width: 38px;
  height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 18px;
}

.notification-dock:hover {
  background: transparent;
  color: var(--text-color);
}

.notification-dock.active {
  background: transparent;
  color: var(--primary-color);
}

.notification-badge {
  position: absolute;
  top: 1px;
  right: 0;
  min-width: 15px;
  height: 15px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--bg-color);
  border-radius: 8px;
  background: #ef4444;
  color: white;
  padding: 0 3px;
  font-size: 8px;
  font-weight: 700;
  line-height: 1;
}

.account-dock:hover {
  background: transparent;
  border-color: color-mix(in srgb, var(--primary-color) 35%, var(--divider-color));
}

.account-dock.active {
  background: transparent;
  color: var(--primary-color);
}

.account-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--hover-bg);
}

.account-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-color);
  font-size: 18px;
}

.account-info {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.account-info strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.account-info span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 12px;
}
</style>
