import { createApp } from 'vue'
import App from './App.vue'
import './assets/styles'
import { router } from './router'
import { dispatchZtoolsCodeEvent, initZtoolsBaseEventHandler } from '@/events'
import { refreshAccountProfile } from '@/composables'
// 单独导入注册事件
import './events/allCodeEvent'

// 统一对 ztools onPluginEnter 事件进行派发, 内部不要再对 ztools.onPluginEnter 进行监听
ztools.onPluginEnter((action) => {
  // 将 utools 事件派发根据不同的 code 进行派发出去
  console.log('[插件事件: onPluginEnter]', action)
  dispatchZtoolsCodeEvent(action, router)
  // 3.2.23：宿主带 tab 打开设置（如 mindnote「模型设置」→ 'ai'）→ 直达「高级服务」对应页签
  // 3.2.25：宿主 onPluginEnter 回调收到的 action 就是本次启动参数本身（{tab:'ai'}），
  // 并非 uTools 标准的 {code,type,payload} 包装 —— 旧实现只读 action.payload 导致 tab 永远读不到，
  // 点「模型配置」只落设置主页。这里对两种结构做兼容（action.payload 或 action 本身）。
  const raw = (action && (action.payload || action)) || {}
  const tab = typeof raw === 'object' && typeof raw.tab === 'string' ? raw.tab : ''
  if (tab) {
    void router.replace({ path: '/providers', query: { tab } }).catch((error) => {
      console.error('[插件事件] 页签跳转失败', error)
    })
  }
  // 设置视图会被宿主缓存复用，每次重新进入都要从服务端刷新账号资料。
  void refreshAccountProfile({ force: true })
})

ztools.onPluginOut(() => {
  if (router.currentRoute.value.name === 'GeneralSetting') {
    return
  }

  void router.replace({ name: 'GeneralSetting' }).catch((error) => {
    console.error('[插件事件: onPluginOut] 重置设置页路由失败', error)
  })
})

// 检测操作系统并添加类名到 html 元素
function detectOS(): void {
  if (window.ztools.isWindows()) {
    document.documentElement.classList.add('os-windows')
  } else if (window.ztools.isMacOS()) {
    document.documentElement.classList.add('os-mac')
  } else {
    document.documentElement.classList.add('os-linux')
  }
}

// 在应用初始化前检测操作系统
detectOS()

const app = createApp(App)
// 注册路由
app.use(router)

app.mount('#app')

// 注册 ztools 关键字跳转事件
initZtoolsBaseEventHandler()
