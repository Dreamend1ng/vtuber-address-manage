<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Delete, Download, Link, Plus, Refresh, Upload, View } from '@element-plus/icons-vue'
import type { Address } from '../types/models'
import { collectionSettings, eventSubmissions, findEvent, removeAddress, saveEvent } from '../services/records'
import {
  addManualSubmission,
  collectionReady,
  exportEventSubmissionsXlsx,
  previewUrlFor,
  publishEvent,
  shareUrlFor,
  syncEventSubmissions,
  testCollection,
  trackUrlFor,
} from '../services/events'
import { addressStatus } from '../services/shipping'
import { loadAssetBlob, removeAsset, saveAssetBlob } from '../services/assets'
import { copyText } from '../utils/clipboard'
import { fileToResizedJpeg, readFileInput } from '../utils/image'
import { formatDateTime } from '../utils/format'

const route = useRoute()
const router = useRouter()

const eventId = computed(() => String(route.params.id))
const event = computed(() => findEvent(eventId.value))

const activeTab = ref<'design' | 'collect' | 'submissions'>('design')
const COLOR_PRESETS = ['#2E4E9E', '#C6473F', '#2F7D5B', '#A9761F', '#7C4DFF', '#D6336C', '#0C8599', '#495057']

const message = (error: unknown, fallback = '操作失败'): string =>
  error instanceof Error && error.message ? error.message : fallback

/* ---------- 表单设计 ---------- */

const design = reactive({ name: '', description: '', themeColor: '#2E4E9E' })
const backgroundAssetId = ref<string | null>(null)
const backgroundUrl = ref<string | null>(null)
let saveTimer: ReturnType<typeof setTimeout> | undefined

function syncDesign(): void {
  const value = event.value
  if (!value) return
  design.name = value.name
  design.description = value.description
  design.themeColor = value.themeColor
  backgroundAssetId.value = value.backgroundAssetId
  void refreshBackground()
}

async function refreshBackground(): Promise<void> {
  if (backgroundUrl.value) {
    URL.revokeObjectURL(backgroundUrl.value)
    backgroundUrl.value = null
  }
  if (backgroundAssetId.value) {
    const blob = await loadAssetBlob(backgroundAssetId.value)
    if (blob) backgroundUrl.value = URL.createObjectURL(blob)
  }
}

watch(() => event.value?.id, syncDesign, { immediate: true })

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void persistDesign()
  }, 600)
}

async function persistDesign(): Promise<void> {
  const value = event.value
  if (!value) return
  value.name = design.name.trim() || '未命名活动'
  value.description = design.description
  value.themeColor = design.themeColor
  await saveEvent(value)
}

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  void persistDesign()
  if (backgroundUrl.value) URL.revokeObjectURL(backgroundUrl.value)
})

async function onBackgroundFile(inputEvent: Event): Promise<void> {
  const file = readFileInput(inputEvent)
  if (!file) return
  try {
    const jpeg = await fileToResizedJpeg(file)
    const id = await saveAssetBlob(jpeg, 'image/jpeg')
    const previous = backgroundAssetId.value
    backgroundAssetId.value = id
    const value = event.value
    if (value) {
      value.backgroundAssetId = id
      await saveEvent(value)
    }
    if (previous) await removeAsset(previous)
    await refreshBackground()
    ElMessage.success('背景图已更新，发布后粉丝端生效')
  } catch {
    ElMessage.error('无法处理这张图片，请换一张重试')
  }
}

async function clearBackground(): Promise<void> {
  const value = event.value
  const previous = backgroundAssetId.value
  backgroundAssetId.value = null
  if (value) {
    value.backgroundAssetId = null
    await saveEvent(value)
  }
  if (previous) await removeAsset(previous)
  await refreshBackground()
  ElMessage.success('背景图已移除')
}

const previewStyle = computed(() => {
  const color = design.themeColor
  if (backgroundUrl.value) {
    return {
      backgroundImage: `linear-gradient(rgba(13, 19, 33, 0.45), rgba(13, 19, 33, 0.72)), url(${backgroundUrl.value})`,
    }
  }
  return {
    backgroundImage: `radial-gradient(520px 240px at 50% -50px, ${color}66, transparent 70%), linear-gradient(160deg, #1a2438, #0f1524)`,
  }
})

/* ---------- 发布与链接 ---------- */

const publishing = ref(false)

async function doPublish(): Promise<void> {
  const value = event.value
  if (!value) return
  if (!collectionReady(collectionSettings.value)) {
    ElMessage.warning('请先在「设置 → 收集仓库」里配置全局收集仓库')
    activeTab.value = 'collect'
    return
  }
  publishing.value = true
  try {
    await publishEvent(value)
    ElMessage.success('表单已发布，收集链接现在可以发给粉丝了')
  } catch (error) {
    ElMessage.error(message(error, '发布失败'))
  } finally {
    publishing.value = false
  }
}

const shareLink = computed(() => {
  const value = event.value
  if (!value || !collectionReady(collectionSettings.value)) return ''
  try {
    return shareUrlFor(value)
  } catch {
    return ''
  }
})

async function copyShare(): Promise<void> {
  if (!shareLink.value) {
    ElMessage.warning('请先在「设置 → 收集仓库」里配置全局收集仓库')
    activeTab.value = 'collect'
    return
  }
  await copyText(shareLink.value)
  ElMessage.success('收集链接已复制')
}

async function copyTrackLink(): Promise<void> {
  const value = event.value
  if (!value || !collectionReady(collectionSettings.value)) {
    ElMessage.warning('请先在「设置 → 收集仓库」里配置全局收集仓库')
    activeTab.value = 'collect'
    return
  }
  await copyText(trackUrlFor(value))
  ElMessage.success('查询链接已复制，可以发给粉丝')
}

function openPreview(): void {
  const value = event.value
  if (!value) return
  window.open(previewUrlFor(value), '_blank', 'noopener')
}

/* ---------- 收集状态 ---------- */

const testing = ref(false)

async function testConnection(): Promise<void> {
  const settings = collectionSettings.value
  if (!collectionReady(settings)) {
    ElMessage.warning('还没有配置收集仓库，请先到「设置」里填写')
    activeTab.value = 'collect'
    return
  }
  testing.value = true
  try {
    const info = await testCollection(settings!.repo, settings!.token)
    ElMessage.success(`连接成功：${info}`)
  } catch (error) {
    ElMessage.error(message(error, '连接失败'))
  } finally {
    testing.value = false
  }
}

/* ---------- 提交列表 ---------- */

const keyword = ref('')
const submissions = computed(() =>
  eventSubmissions(eventId.value).sort(
    (a, b) => (b.submittedAt ?? b.updatedAt) - (a.submittedAt ?? a.updatedAt),
  ),
)

const filteredSubmissions = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  if (query === '') return submissions.value
  return submissions.value.filter((item) =>
    [
      item.douyinId ?? '',
      item.name,
      item.phone,
      item.detail,
      item.submitterIp ?? '',
      item.deviceInfo ?? '',
      item.deviceId ?? '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(query),
  )
})

/** 同一设备的提交次数（用于识别批量捣乱） */
const deviceCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const item of submissions.value) {
    if (item.deviceId) counts.set(item.deviceId, (counts.get(item.deviceId) ?? 0) + 1)
  }
  return counts
})

function repeatCount(item: Address): number {
  return item.deviceId ? (deviceCounts.value.get(item.deviceId) ?? 0) : 0
}

const syncing = ref(false)
const syncProgress = ref('')

async function syncNow(): Promise<void> {
  const value = event.value
  if (!value) return
  if (!collectionReady(collectionSettings.value)) {
    ElMessage.warning('请先在「设置 → 收集仓库」里配置全局收集仓库')
    activeTab.value = 'collect'
    return
  }
  syncing.value = true
  syncProgress.value = ''
  try {
    const result = await syncEventSubmissions(value, (done, total) => {
      syncProgress.value = `${done} / ${total}`
    })
    if (result.added === 0 && result.failed === 0) {
      ElMessage.success('没有新的提交')
    } else {
      ElMessage.success(`同步完成：新增 ${result.added} 条，失败 ${result.failed} 条，跳过 ${result.skipped} 条`)
    }
  } catch (error) {
    ElMessage.error(message(error, '同步失败'))
  } finally {
    syncing.value = false
    syncProgress.value = ''
  }
}

function exportSubmissions(): void {
  const value = event.value
  if (!value) return
  if (submissions.value.length === 0) {
    ElMessage.warning('还没有收集到地址')
    return
  }
  exportEventSubmissionsXlsx(value, submissions.value)
  ElMessage.success('已导出 Excel（明文文件，请妥善保管）')
}

async function copySubmission(item: Address): Promise<void> {
  await copyText([item.name, item.phone, item.detail].filter(Boolean).join(' '))
  ElMessage.success('收件信息已复制')
}

async function confirmRemoveSubmission(item: Address): Promise<void> {
  try {
    await ElMessageBox.confirm(`将删除「${item.douyinId || item.name}」的这条地址。`, '删除地址', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  await removeAddress(item.id)
  ElMessage.success('已删除')
}

/* ---------- 手动补录 ---------- */

const manualDialog = ref(false)
const manualSaving = ref(false)
const manual = reactive({ douyinId: '', recipientName: '', phone: '', address: '' })

async function submitManual(): Promise<void> {
  const value = event.value
  if (!value) return
  if (manual.recipientName.trim() === '' || manual.phone.trim() === '' || manual.address.trim() === '') {
    ElMessage.warning('请填写收件人、手机号和地址')
    return
  }
  manualSaving.value = true
  try {
    await addManualSubmission(value, {
      douyinId: manual.douyinId.trim(),
      recipientName: manual.recipientName.trim(),
      phone: manual.phone.trim(),
      address: manual.address.trim(),
    })
    manualDialog.value = false
    manual.douyinId = ''
    manual.recipientName = ''
    manual.phone = ''
    manual.address = ''
    ElMessage.success('已补录一条地址')
  } catch (error) {
    ElMessage.error(message(error, '补录失败'))
  } finally {
    manualSaving.value = false
  }
}

/* ---------- 状态切换 ---------- */

async function toggleStatus(): Promise<void> {
  const value = event.value
  if (!value) return
  value.status = value.status === 'collecting' ? 'closed' : 'collecting'
  await saveEvent(value)
  if (collectionReady(collectionSettings.value) && value.lastPublishedAt) {
    try {
      await publishEvent(value)
      ElMessage.success(value.status === 'collecting' ? '已重新开启收集' : '已停止收集（线上表单已同步）')
      return
    } catch {
      ElMessage.warning('状态已更新，但同步到收集仓库失败，请手动点击「发布表单」')
      return
    }
  }
  ElMessage.success(value.status === 'collecting' ? '已重新开启收集' : '已停止收集')
}

const sourceLabel = (item: Address): string =>
  item.source === 'form' ? '表单' : item.source === 'import' ? '导入' : '手动'
</script>

<template>
  <div v-if="event">
    <header class="page-header">
      <div class="detail-head">
        <el-button :icon="ArrowLeft" text class="back-button" @click="router.push({ name: 'events' })">
          活动列表
        </el-button>
        <h1 class="page-title">{{ event.name }}</h1>
        <p class="page-desc">
          <span class="stamp" :class="event.status === 'collecting' ? 'stamp--green' : 'stamp--ink'">
            {{ event.status === 'collecting' ? '收集中' : '已停止' }}
          </span>
          <span class="detail-meta">
            已收集 <span class="mono">{{ submissions.length }}</span> 条地址
            <template v-if="event.lastPublishedAt">
              · 上次发布 {{ formatDateTime(event.lastPublishedAt) }}
            </template>
          </span>
        </p>
      </div>
      <div class="header-actions">
        <el-button @click="toggleStatus">
          {{ event.status === 'collecting' ? '停止收集' : '开启收集' }}
        </el-button>
        <el-button :icon="View" @click="openPreview">预览表单</el-button>
        <el-button type="primary" :icon="Upload" :loading="publishing" @click="doPublish">
          发布 / 更新表单
        </el-button>
      </div>
    </header>

    <el-tabs v-model="activeTab" class="detail-tabs">
      <!-- ---------- 表单设计 ---------- -->
      <el-tab-pane label="表单设计" name="design">
        <div class="design-grid">
          <section class="panel panel-pad">
            <h2 class="panel-title">基本信息</h2>
            <el-form label-position="top">
              <el-form-item label="活动名称">
                <el-input v-model="design.name" maxlength="60" show-word-limit @input="scheduleSave" />
              </el-form-item>
              <el-form-item label="表单说明">
                <el-input
                  v-model="design.description"
                  type="textarea"
                  :autosize="{ minRows: 3, maxRows: 5 }"
                  maxlength="200"
                  show-word-limit
                  placeholder="写给粉丝的话，会显示在表单顶部"
                  @input="scheduleSave"
                />
              </el-form-item>
              <el-form-item label="主题色">
                <el-color-picker v-model="design.themeColor" :predefine="COLOR_PRESETS" @change="scheduleSave" />
                <span class="color-value mono">{{ design.themeColor }}</span>
              </el-form-item>
              <el-form-item label="背景图片">
                <div class="background-row">
                  <div v-if="backgroundUrl" class="background-thumb" :style="{ backgroundImage: `url(${backgroundUrl})` }" />
                  <div v-else class="background-thumb background-thumb--empty">未设置</div>
                  <div class="background-actions">
                    <label class="background-upload">
                      <input type="file" accept="image/*" hidden @change="onBackgroundFile" />
                      <el-button :icon="Upload" tag="span">上传背景图</el-button>
                    </label>
                    <el-button v-if="backgroundUrl" text type="danger" @click="clearBackground">移除</el-button>
                  </div>
                </div>
                <p class="field-hint">建议横版图片，会自动压缩到 1600px 宽以控制仓库体积。</p>
              </el-form-item>
            </el-form>
            <p class="field-hint">修改会自动保存；发布后粉丝端立即生效。</p>
          </section>

          <section class="preview-panel">
            <h2 class="panel-title">粉丝端预览</h2>
            <div class="fan-preview" :style="previewStyle">
              <div class="fan-preview__card">
                <span class="fan-preview__eyebrow">收件信息收集</span>
                <h3 class="fan-preview__title">{{ design.name || '未命名活动' }}</h3>
                <p class="fan-preview__desc">{{ design.description || '表单说明会显示在这里' }}</p>
                <div class="fan-preview__input">抖音号</div>
                <div class="fan-preview__input">收件人姓名</div>
                <div class="fan-preview__input">手机号</div>
                <div class="fan-preview__input fan-preview__input--area">收件地址</div>
                <div class="fan-preview__button">提交收件信息</div>
              </div>
            </div>
            <div class="link-row">
              <el-input :model-value="shareLink" readonly placeholder="配置收集仓库后生成链接" />
              <el-button :icon="Link" :disabled="!shareLink" @click="copyShare">复制</el-button>
            </div>
          </section>
        </div>
      </el-tab-pane>

      <!-- ---------- 收集与发布 ---------- -->
      <el-tab-pane label="收集与发布" name="collect">
        <section class="panel panel-pad">
          <h2 class="panel-title">全局收集仓库</h2>
          <p class="panel-desc">
            所有活动共用一套收集配置，链接生成、发布和同步都使用它。在「设置 → 收集仓库」里修改。
          </p>

          <template v-if="collectionReady(collectionSettings)">
            <dl class="collect-status collect-status--top">
              <div class="status-row">
                <dt>仓库</dt>
                <dd class="mono">{{ collectionSettings?.repo }}</dd>
              </div>
              <div class="status-row">
                <dt>分支</dt>
                <dd class="mono">{{ collectionSettings?.branch || 'main' }}</dd>
              </div>
            </dl>
            <div class="collect-actions">
              <el-button :loading="testing" @click="testConnection">测试连接</el-button>
              <el-button @click="router.push({ name: 'settings' })">在设置中修改</el-button>
              <el-button :icon="Link" @click="copyTrackLink">复制查询链接</el-button>
              <el-button type="primary" :icon="Upload" :loading="publishing" @click="doPublish">
                发布 / 更新表单
              </el-button>
            </div>
          </template>

          <el-alert v-else type="warning" :closable="false" class="collect-alert">
            <template #title>还没有配置收集仓库</template>
            <p>
              到「设置 → 收集仓库」填写专用私有仓库和 Token 后，所有活动就可以发布表单、生成链接了。
              也可以先用「手动补录」把私聊收到的地址存进来。
            </p>
            <el-button type="primary" size="small" class="alert-button" @click="router.push({ name: 'settings' })">
              去设置
            </el-button>
          </el-alert>

          <el-alert type="info" :closable="false" class="collect-alert">
            <template #title>仓库准备指南（只需做一次）</template>
            <ol class="guide-list">
              <li>新建一个 <strong>私有仓库</strong>（例如 <span class="mono">vam-collect</span>），专门存放提交。</li>
              <li>
                在<a
                  href="https://github.com/settings/personal-access-tokens/new"
                  target="_blank"
                  rel="noopener noreferrer"
                >GitHub 的 fine-grained tokens 页面</a>新建 Token，只授权这个仓库的 <strong>Contents: Read and write</strong>。
              </li>
              <li>把仓库名和 Token 填到设置页，测试连接通过后，回到这里点击「发布 / 更新表单」。</li>
            </ol>
          </el-alert>

          <el-alert type="warning" :closable="false" class="collect-alert collect-alert--safety">
            <template #title>安全说明</template>
            <p>
              收集链接里会携带 Token（粉丝浏览器需要它写入仓库），因此请务必使用<strong>专用仓库 + 专用 Token</strong>，不要授权到主仓库。提交内容已用活动公钥加密，即使 Token 或仓库泄漏，地址也无法被他人读取；活动结束后可以在 GitHub 上直接吊销 Token。
            </p>
          </el-alert>

          <dl class="collect-status">
            <div class="status-row">
              <dt>本次上次发布</dt>
              <dd>{{ event.lastPublishedAt ? formatDateTime(event.lastPublishedAt) : '尚未发布' }}</dd>
            </div>
            <div class="status-row">
              <dt>上次同步</dt>
              <dd>{{ event.lastSyncedAt ? formatDateTime(event.lastSyncedAt) : '尚未同步' }}</dd>
            </div>
            <div class="status-row">
              <dt>已导入文件</dt>
              <dd><span class="mono">{{ event.importedRemotePaths.length }}</span> 个</dd>
            </div>
          </dl>
        </section>
      </el-tab-pane>

      <!-- ---------- 提交列表 ---------- -->
      <el-tab-pane label="提交列表" name="submissions">
        <div class="toolbar">
          <el-button type="primary" :icon="Refresh" :loading="syncing" @click="syncNow">
            同步提交
            <template v-if="syncProgress">&nbsp;{{ syncProgress }}</template>
          </el-button>
          <el-button :icon="Download" @click="exportSubmissions">导出 Excel</el-button>
          <el-button :icon="Plus" @click="manualDialog = true">手动补录</el-button>
          <el-input
            v-model="keyword"
            class="search-input"
            placeholder="搜索抖音号 / 姓名 / 手机号"
            clearable
          />
        </div>

        <el-alert v-if="!collectionReady(collectionSettings)" type="warning" :closable="false" class="collect-alert">
          <template #title>还没有配置收集仓库</template>
          <p>
            配置后粉丝才能通过链接提交；也可以先用「手动补录」把私聊收到的地址存进来，之后在发货台填写单号并发货、导出 Excel。
          </p>
        </el-alert>

        <section class="panel">
          <el-table :data="filteredSubmissions" style="width: 100%" row-key="id">
            <el-table-column label="抖音号" min-width="130">
              <template #default="{ row }">
                <span v-if="row.douyinId" class="mono">{{ row.douyinId }}</span>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column prop="name" label="收件名" min-width="110" />
            <el-table-column label="手机号" min-width="130">
              <template #default="{ row }">
                <span class="mono">{{ row.phone }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="detail" label="收件地址" min-width="240" show-overflow-tooltip />
            <el-table-column label="发货" width="140">
              <template #default="{ row }">
                <span class="stamp" :class="`stamp--${addressStatus(row).tone}`">{{ addressStatus(row).label }}</span>
                <div v-if="row.trackingNo" class="cell-sub mono">{{ row.trackingNo }}</div>
              </template>
            </el-table-column>
            <el-table-column label="IP / 设备" min-width="200">
              <template #default="{ row }">
                <template v-if="row.submitterIp || row.deviceInfo">
                  <div v-if="row.submitterIp" class="mono">{{ row.submitterIp }}</div>
                  <div v-if="row.submitterRegion" class="cell-sub muted">
                    {{ row.submitterRegion }}<template v-if="row.submitterIsp"> · {{ row.submitterIsp }}</template>
                  </div>
                  <div class="cell-sub">
                    <el-tooltip v-if="row.userAgent" :content="row.userAgent" placement="top" :show-after="300">
                      <span class="muted device-text">{{ row.deviceInfo || '未知设备' }}</span>
                    </el-tooltip>
                    <span v-else class="muted">{{ row.deviceInfo || '未知设备' }}</span>
                    <el-tag
                      v-if="repeatCount(row) > 1"
                      size="small"
                      type="warning"
                      effect="plain"
                      class="repeat-tag"
                    >
                      同设备 ×{{ repeatCount(row) }}
                    </el-tag>
                  </div>
                </template>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="提交时间" width="150">
              <template #default="{ row }">
                <span class="muted">{{ formatDateTime(row.submittedAt ?? row.updatedAt) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="来源" width="80">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" type="info">{{ sourceLabel(row) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="130" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="copySubmission(row)">复制</el-button>
                <el-button link type="danger" :icon="Delete" @click="confirmRemoveSubmission(row)">删除</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <div class="empty-hint">
                {{
                  submissions.length === 0
                    ? '还没有收到地址。发布表单并把链接发给粉丝，或点击「手动补录」。'
                    : '没有符合搜索条件的地址。'
                }}
              </div>
            </template>
          </el-table>
        </section>
      </el-tab-pane>
    </el-tabs>

    <!-- 手动补录 -->
    <el-dialog v-model="manualDialog" title="手动补录地址" width="520px">
      <el-form label-position="top">
        <el-form-item label="抖音号">
          <el-input v-model="manual.douyinId" placeholder="选填" maxlength="60" />
        </el-form-item>
        <el-form-item label="收件人姓名">
          <el-input v-model="manual.recipientName" maxlength="60" />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="manual.phone" maxlength="20" />
        </el-form-item>
        <el-form-item label="收件地址">
          <el-input v-model="manual.address" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" maxlength="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="manualDialog = false">取消</el-button>
        <el-button type="primary" :loading="manualSaving" @click="submitManual">保存</el-button>
      </template>
    </el-dialog>
  </div>

  <div v-else class="panel empty-hint">
    <p>没有找到这个活动，可能已被删除。</p>
    <el-button @click="router.push({ name: 'events' })">返回活动列表</el-button>
  </div>
</template>

<style scoped>
.detail-head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.back-button {
  margin-left: -8px;
  color: var(--muted);
}

.detail-meta {
  margin-left: 10px;
  color: var(--muted);
  font-size: 12.5px;
}

.header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.detail-tabs {
  margin-top: 4px;
}

.design-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 400px);
  gap: 16px;
  align-items: start;
}

.panel-pad {
  padding: 20px 22px;
}

.panel-title {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 700;
}

.field-hint {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.color-value {
  margin-left: 10px;
  color: var(--muted);
}

.background-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.background-thumb {
  width: 148px;
  height: 84px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background-size: cover;
  background-position: center;
}

.background-thumb--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 12px;
  background: #f8fafd;
}

.background-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-panel {
  position: sticky;
  top: 20px;
}

.fan-preview {
  border-radius: 12px;
  padding: 22px 18px;
  background-size: cover;
  background-position: center;
  margin-bottom: 12px;
}

.fan-preview__card {
  background: #ffffff;
  border-radius: 12px;
  padding: 18px 16px;
  box-shadow: 0 18px 40px -24px rgba(0, 0, 0, 0.55);
}

.fan-preview__eyebrow {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  color: #8a93a6;
}

.fan-preview__title {
  margin: 4px 0 4px;
  font-size: 16px;
  color: #16233b;
}

.fan-preview__desc {
  margin: 0 0 12px;
  font-size: 11.5px;
  line-height: 1.6;
  color: #5c6a83;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.fan-preview__input {
  border: 1.5px solid #e2e7f0;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: #97a1b3;
  margin-bottom: 8px;
  background: #fbfcfe;
}

.fan-preview__input--area {
  padding-bottom: 22px;
}

.fan-preview__button {
  margin-top: 12px;
  border-radius: 8px;
  padding: 10px;
  text-align: center;
  font-size: 13px;
  font-weight: 700;
  color: #ffffff;
  background: v-bind('design.themeColor');
}

.link-row {
  display: flex;
  gap: 8px;
}

.guide-list {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 12.5px;
  line-height: 1.9;
  color: var(--ink-soft);
}

.collect-alert {
  margin-bottom: 16px;
}

.alert-button {
  margin-top: 10px;
}

.collect-status--top {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.collect-alert--safety {
  margin-top: 18px;
}

.collect-alert--safety p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.8;
}

.collect-form {
  max-width: 560px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 0 14px;
}

.collect-actions {
  display: flex;
  gap: 8px;
}

.collect-status {
  margin: 20px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--line);
  max-width: 560px;
}

.status-row {
  display: flex;
  justify-content: space-between;
  padding: 7px 0;
  font-size: 13px;
}

.status-row dt {
  color: var(--muted);
}

.status-row dd {
  margin: 0;
}

.search-input {
  max-width: 260px;
  min-width: 180px;
}

.cell-sub {
  font-size: 12.5px;
  margin-top: 2px;
}

.device-text {
  border-bottom: 1px dashed var(--line-strong);
  cursor: help;
}

.repeat-tag {
  margin-left: 6px;
}

@media (max-width: 980px) {
  .design-grid {
    grid-template-columns: 1fr;
  }

  .preview-panel {
    position: static;
  }
}
</style>
