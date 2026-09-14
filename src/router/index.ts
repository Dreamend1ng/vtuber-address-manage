import { createRouter, createWebHashHistory } from 'vue-router'
import { vaultState } from '../services/vault'

export const router = createRouter({
  // hash 模式：在 GitHub Pages 等纯静态托管上无需任何回退配置
  history: createWebHashHistory(),
  routes: [
    { path: '/setup', name: 'setup', component: () => import('../views/SetupView.vue') },
    { path: '/unlock', name: 'unlock', component: () => import('../views/UnlockView.vue') },
    // 粉丝填表页与查询页：无需保险库即可访问
    { path: '/f', name: 'fan', component: () => import('../views/FanFormView.vue') },
    { path: '/t', name: 'track', component: () => import('../views/TrackView.vue') },
    {
      path: '/',
      component: () => import('../layout/AppLayout.vue'),
      children: [
        { path: '', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
        { path: 'events', name: 'events', component: () => import('../views/EventsView.vue') },
        {
          path: 'events/:id',
          name: 'event-detail',
          component: () => import('../views/EventDetailView.vue'),
        },
        { path: 'shipping', name: 'shipping', component: () => import('../views/ShippingView.vue') },
        {
          path: 'shipping/:id',
          name: 'shipping-detail',
          component: () => import('../views/ShippingDetailView.vue'),
        },
        { path: 'backup', name: 'backup', component: () => import('../views/BackupView.vue') },
        { path: 'settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  if (to.name === 'fan' || to.name === 'track') return true
  const status = vaultState.status
  if (status === 'empty') {
    return to.name === 'setup' ? true : { name: 'setup' }
  }
  if (status === 'locked') {
    return to.name === 'unlock' ? true : { name: 'unlock' }
  }
  if (status === 'unlocked' && (to.name === 'unlock' || to.name === 'setup')) {
    return { name: 'dashboard' }
  }
  return true
})
