<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Delete, Download, Link, Plus, View } from '@element-plus/icons-vue'
import type { CollectionEvent } from '../types/models'
import { collectionSettings, eventSubmissions, events, removeEvent } from '../services/records'
import {
  collectionReady,
  createEventWithKeys,
  exportEventSubmissionsXlsx,
  shareUrlFor,
} from '../services/events'
import { copyText } from '../utils/clipboard'
import { formatShortDateTime } from '../utils/format'

const router = useRouter()

const createDialog = ref(false)
const creating = ref(false)
const draft = reactive({ name: '', description: '' })

function submissionCount(event: CollectionEvent): number {
  return eventSubmissions(event.id).length
}

async function copyShareLink(event: CollectionEvent): Promise<void> {
  if (!collectionReady(collectionSettings.value)) {
    ElMessage.warning('请先在「设置 → 收集仓库」里配置全局收集仓库')
    return
  }
  try {
    await copyText(shareUrlFor(event))
  } catch {
    ElMessage.error('浏览器拒绝了剪贴板访问，请到活动详情里手动复制')
    return
  }
  if (!event.lastPublishedAt) {
    ElMessage.warning('链接已复制，但表单还没有发布到收集仓库，请先在活动详情里点击「发布表单」')
  } else {
    ElMessage.success('收集链接已复制，可以发给粉丝了')
  }
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

async function confirmRemove(event: CollectionEvent): Promise<void> {
  const count = submissionCount(event)
  try {
    await ElMessageBox.confirm(
      `将删除活动「${event.name}」。${
        count > 0 ? `已收集的 ${count} 条地址会保留在地址簿中，但不再关联该活动。` : ''
      }`,
      '删除活动',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' },
    )
  } catch {
    return
  }
  await removeEvent(event.id)
  ElMessage.success('活动已删除')
}

async function createEventNow(): Promise<void> {
  const name = draft.name.trim()
  if (name === '' || creating.value) return
  creating.value = true
  try {
    const created = await createEventWithKeys(name, draft.description.trim())
    createDialog.value = false
    draft.name = ''
    draft.description = ''
    ElMessage.success('活动已创建，接下来设计表单并发布')
    await router.push({ name: 'event-detail', params: { id: created.id } })
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '创建失败')
  } finally {
    creating.value = false
  }
}

const collectionAvailable = computed(() => collectionReady(collectionSettings.value))
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1 class="page-title">活动</h1>
        <p class="page-desc">
          每场周边发放创建一个活动，生成收集表单发给粉丝填写，主播随时同步地址并导出。
        </p>
      </div>
      <el-button type="primary" :icon="Plus" @click="createDialog = true">新建活动</el-button>
    </header>

    <div v-if="events.length === 0" class="panel empty-hint">
      还没有活动。点击「新建活动」，例如「梦末百天纪念回」，然后设计表单、生成链接发给粉丝。
    </div>

    <div v-else class="event-grid">
      <article v-for="event in events" :key="event.id" class="panel event-card">
        <div class="event-card__head">
          <h2 class="event-card__name">{{ event.name }}</h2>
          <span class="stamp" :class="event.status === 'collecting' ? 'stamp--green' : 'stamp--ink'">
            {{ event.status === 'collecting' ? '收集中' : '已停止' }}
          </span>
        </div>
        <p class="event-card__desc">{{ event.description || '（没有填写说明）' }}</p>
        <dl class="event-card__meta">
          <div>
            <dt>已收集</dt>
            <dd><span class="mono">{{ submissionCount(event) }}</span> 条地址</dd>
          </div>
          <div>
            <dt>发布状态</dt>
            <dd>{{ event.lastPublishedAt ? '已发布' : '未发布' }}</dd>
          </div>
          <div>
            <dt>更新于</dt>
            <dd>{{ formatShortDateTime(event.updatedAt) }}</dd>
          </div>
        </dl>
        <div class="event-card__actions">
          <el-button type="primary" :icon="View" @click="router.push({ name: 'event-detail', params: { id: event.id } })">
            打开
          </el-button>
          <el-button :icon="Link" @click="copyShareLink(event)">复制链接</el-button>
          <el-button :icon="Download" @click="exportEvent(event)">导出 Excel</el-button>
          <el-button :icon="Delete" type="danger" plain @click="confirmRemove(event)">删除</el-button>
        </div>
      </article>
    </div>

    <p v-if="events.length > 0 && !collectionAvailable" class="events-tip">
      提示：复制链接前需要先在「设置 → 收集仓库」配置专用私有仓库和 Token，所有活动共用这一套配置。
    </p>

    <el-dialog v-model="createDialog" title="新建活动" width="520px">
      <el-form label-position="top">
        <el-form-item label="活动名称">
          <el-input
            v-model="draft.name"
            placeholder="例如：梦末百天纪念回"
            maxlength="60"
            show-word-limit
            @keyup.enter="createEventNow"
          />
        </el-form-item>
        <el-form-item label="表单说明">
          <el-input
            v-model="draft.description"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 5 }"
            placeholder="写给粉丝的话，例如：感谢陪伴，填写后我们会寄出纪念周边～"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <p class="dialog-hint">
        创建时会为本活动生成独立密钥对：粉丝提交的地址会先加密再上传，只有你的保险库能解开。
      </p>
      <template #footer>
        <el-button @click="createDialog = false">取消</el-button>
        <el-button type="primary" :loading="creating" :disabled="draft.name.trim() === ''" @click="createEventNow">
          创建并继续
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.event-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.event-card {
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
}

.event-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.event-card__name {
  margin: 0;
  font-size: 16.5px;
  font-weight: 700;
  line-height: 1.4;
}

.event-card__desc {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.65;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.4em;
}

.event-card__meta {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin: 14px 0 0;
  padding: 12px 0 0;
  border-top: 1px solid var(--line);
}

.event-card__meta dt {
  font-size: 11.5px;
  color: var(--muted);
}

.event-card__meta dd {
  margin: 2px 0 0;
  font-size: 13px;
}

.event-card__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 16px;
}

.event-card__actions :deep(.el-button) {
  width: 100%;
}

.event-card__actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.events-tip {
  margin: 16px 0 0;
  color: var(--muted);
  font-size: 12.5px;
}

.dialog-hint {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.7;
}
</style>
