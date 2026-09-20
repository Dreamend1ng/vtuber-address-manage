<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Calendar, FolderOpened, Setting, Van } from '@element-plus/icons-vue'
import { siteConfig } from '../config'
import { addresses, events } from '../services/records'
import { vaultState } from '../services/vault'
import { formatDateTime } from '../utils/format'

const router = useRouter()

const counts = computed(() => ({
  events: events.value.length,
  addresses: addresses.value.length,
  pending: addresses.value.filter((address) => !address.shippedAt).length,
  shipped: addresses.value.filter((address) => address.shippedAt).length,
}))

const recentShipped = computed(() =>
  addresses.value
    .filter((address) => address.shippedAt)
    .sort((a, b) => (b.shippedAt ?? 0) - (a.shippedAt ?? 0))
    .slice(0, 6),
)

const autoLockText = computed(() => {
  if (vaultState.autoLockMode === 'interval') return '每 30 分钟检查一次活动'
  return vaultState.autoLockMinutes > 0 ? `${vaultState.autoLockMinutes} 分钟无操作后锁定` : '已关闭自动锁定'
})

const clipboardText = computed(() =>
  vaultState.clipboardClearSeconds > 0
    ? `${vaultState.clipboardClearSeconds} 秒后自动清空剪贴板`
    : '复制后不自动清空剪贴板',
)
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1 class="page-title">概览</h1>
        <p class="page-desc">欢迎回来，数据已在本机解锁。</p>
      </div>
      <div class="header-actions">
        <el-button :icon="Calendar" @click="router.push({ name: 'events' })">活动</el-button>
        <el-button type="primary" :icon="Van" @click="router.push({ name: 'shipping' })">
          进入发货
        </el-button>
      </div>
    </header>

    <section class="panel stat-board">
      <div class="stat">
        <span class="stat__label">活动</span>
        <span class="stat__value">{{ counts.events }}</span>
      </div>
      <div class="stat">
        <span class="stat__label">已收集地址</span>
        <span class="stat__value">{{ counts.addresses }}</span>
      </div>
      <div class="stat">
        <span class="stat__label">待发货</span>
        <span class="stat__value stat__value--amber">{{ counts.pending }}</span>
      </div>
      <div class="stat stat--last">
        <span class="stat__label">已发货</span>
        <span class="stat__value stat__value--green">{{ counts.shipped }}</span>
      </div>
    </section>

    <div class="home-grid">
      <section class="panel home-panel">
        <div class="home-panel__head">
          <h2 class="home-panel__title">最近发货</h2>
          <el-link type="primary" :underline="false" @click="router.push({ name: 'shipping' })">
            进入发货
          </el-link>
        </div>
        <div v-if="recentShipped.length === 0" class="empty-hint">
          还没有发货记录。到「发货」页上传或填写快递单号，一键发货后这里会显示最近记录。
        </div>
        <ul v-else class="recent-list">
          <li v-for="address in recentShipped" :key="address.id" class="recent-item">
            <div class="recent-item__main">
              <span class="recent-item__title">{{ address.name }}</span>
              <span class="recent-item__meta">
                <template v-if="address.carrier">{{ address.carrier }} · </template>
                <span class="mono">{{ address.trackingNo }}</span>
              </span>
            </div>
            <div class="recent-item__side">
              <span class="stamp stamp--green">已发货</span>
              <span class="recent-item__time muted">{{ formatDateTime(address.shippedAt ?? 0) }}</span>
            </div>
          </li>
        </ul>
      </section>

      <section class="panel home-panel">
        <div class="home-panel__head">
          <h2 class="home-panel__title">保险库状态</h2>
          <el-link type="primary" :underline="false" @click="router.push({ name: 'settings' })">
            安全设置
          </el-link>
        </div>
        <dl class="vault-list">
          <div class="vault-row">
            <dt>加密方式</dt>
            <dd>AES-256-GCM · PBKDF2 600,000 次</dd>
          </div>
          <div class="vault-row">
            <dt>存储位置</dt>
            <dd>仅本机浏览器，不上传服务器</dd>
          </div>
          <div class="vault-row">
            <dt>自动锁定</dt>
            <dd>{{ autoLockText }}</dd>
          </div>
          <div class="vault-row">
            <dt>剪贴板</dt>
            <dd>{{ clipboardText }}</dd>
          </div>
        </dl>
        <div class="vault-actions">
          <el-button :icon="FolderOpened" @click="router.push({ name: 'backup' })">
            导出加密备份
          </el-button>
          <el-button :icon="Setting" @click="router.push({ name: 'settings' })">
            安全设置
          </el-button>
        </div>
        <p class="vault-note">
          {{ siteConfig.appName }} 不会联网发送你的任何数据。建议每次集中发货结束后导出一份加密备份。
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.stat-board {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  overflow: hidden;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 22px;
  border-right: 1px solid var(--line);
}

.stat--last {
  border-right: none;
}

.stat__label {
  font-size: 12.5px;
  color: var(--muted);
}

.stat__value {
  font-family: var(--font-mono);
  font-size: 30px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.01em;
}

.stat__value--amber {
  color: var(--stamp-amber);
}

.stat__value--green {
  color: var(--stamp-green);
}

.home-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 16px;
  margin-top: 16px;
}

.home-panel {
  padding: 18px 20px 20px;
}

.home-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.home-panel__title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.recent-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.recent-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--line);
}

.recent-item:last-child {
  border-bottom: none;
}

.recent-item__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.recent-item__title {
  font-weight: 600;
  font-size: 13.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-item__meta {
  color: var(--muted);
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-item__side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.recent-item__time {
  font-size: 11.5px;
}

.vault-list {
  margin: 4px 0 16px;
}

.vault-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}

.vault-row:last-child {
  border-bottom: none;
}

.vault-row dt {
  color: var(--muted);
  flex-shrink: 0;
}

.vault-row dd {
  margin: 0;
  text-align: right;
}

.vault-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.vault-note {
  margin: 12px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

@media (max-width: 980px) {
  .stat-board {
    grid-template-columns: repeat(2, 1fr);
  }

  .stat:nth-child(2) {
    border-right: none;
  }

  .stat:nth-child(1),
  .stat:nth-child(2) {
    border-bottom: 1px solid var(--line);
  }

  .home-grid {
    grid-template-columns: 1fr;
  }
}
</style>
