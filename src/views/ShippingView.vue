<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Download, Link, Van } from '@element-plus/icons-vue'
import type { CollectionEvent } from '../types/models'
import { collectionSettings, eventSubmissions, events } from '../services/records'
import { collectionReady, exportEventSubmissionsXlsx, trackUrlFor } from '../services/events'
import { shippingStats } from '../services/shipping'
import { copyText } from '../utils/clipboard'

const router = useRouter()

function statsOf(event: CollectionEvent) {
  return shippingStats(eventSubmissions(event.id))
}

function exportEvent(event: CollectionEvent): void {
  const list = eventSubmissions(event.id)
  if (list.length === 0) {
    ElMessage.warning('这个活动还没有收集到地址')
    return
  }
  exportEventSubmissionsXlsx(event, list)
  ElMessage.success('已导出 Excel（明文文件，请妥善保管）')
}

async function copyTrackLink(event: CollectionEvent): Promise<void> {
  if (!collectionReady(collectionSettings.value)) {
    ElMessage.warning('请先在「设置 → 收集仓库」里配置全局收集仓库')
    return
  }
  if (!event.lastTrackingPublishedAt) {
    ElMessage.warning('还没有发布过快递单号，粉丝暂时查不到。请先到活动里发货并点击「更新查询数据」')
    return
  }
  await copyText(trackUrlFor(event))
  ElMessage.success('查询链接已复制，可以发给粉丝')
}
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1 class="page-title">发货</h1>
        <p class="page-desc">
          选择活动进入发货台：上传或填写快递单号 → 核对预填结果 → 一键发货，粉丝即可用手机号查询。
        </p>
      </div>
    </header>

    <div v-if="events.length === 0" class="panel empty-hint">
      还没有活动。先到「活动」创建一场周边发放活动并收集地址。
    </div>

    <div v-else class="ship-grid">
      <article v-for="event in events" :key="event.id" class="panel ship-card">
        <div class="ship-card__head">
          <h2 class="ship-card__name">{{ event.name }}</h2>
          <span class="stamp" :class="event.status === 'collecting' ? 'stamp--green' : 'stamp--ink'">
            {{ event.status === 'collecting' ? '收集中' : '已停止' }}
          </span>
        </div>
        <dl class="ship-card__stats">
          <div>
            <dt>待填写</dt>
            <dd><span class="mono">{{ statsOf(event).pending }}</span></dd>
          </div>
          <div>
            <dt>待确认</dt>
            <dd><span class="mono ship-amber">{{ statsOf(event).ready }}</span></dd>
          </div>
          <div>
            <dt>已发货</dt>
            <dd><span class="mono ship-green">{{ statsOf(event).shipped }}</span></dd>
          </div>
        </dl>
        <p class="ship-card__total">共 {{ statsOf(event).total }} 条地址</p>
        <div class="ship-card__actions">
          <el-button type="primary" :icon="Van" @click="router.push({ name: 'shipping-detail', params: { id: event.id } })">
            进入发货
          </el-button>
          <el-button :icon="Link" @click="copyTrackLink(event)">复制查询链接</el-button>
          <el-button class="ship-wide" :icon="Download" @click="exportEvent(event)">导出 Excel</el-button>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.ship-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.ship-card {
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
}

.ship-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.ship-card__name {
  margin: 0;
  font-size: 16.5px;
  font-weight: 700;
  line-height: 1.4;
}

.ship-card__stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin: 16px 0 6px;
}

.ship-card__stats dt {
  font-size: 11.5px;
  color: var(--muted);
}

.ship-card__stats dd {
  margin: 2px 0 0;
  font-size: 20px;
  font-weight: 600;
}

.ship-amber {
  color: var(--stamp-amber);
}

.ship-green {
  color: var(--stamp-green);
}

.ship-card__total {
  margin: 0 0 14px;
  color: var(--muted);
  font-size: 12.5px;
}

.ship-card__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: auto;
}

.ship-card__actions :deep(.el-button) {
  width: 100%;
}

.ship-card__actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.ship-card__actions :deep(.ship-wide) {
  grid-column: 1 / -1;
}
</style>
