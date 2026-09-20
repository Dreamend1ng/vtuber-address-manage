<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Delete, Download, Grid, Link, Operation, Plus, Refresh, Upload, View } from '@element-plus/icons-vue'
import type { Address, CustomField } from '../types/models'
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
import { findDuplicateGroups, mergeDuplicateGroups, type DuplicateGroup } from '../services/duplicates'
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

/** el-table 插槽里的 row 类型是 DefaultRow，运行期就是业务对象，这里还原类型 */
const asAddress = (row: unknown): Address => row as Address
const asDedupeRow = (row: unknown): DedupeRow => row as DedupeRow

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

/** 制作二维码：复制链接并打开二维码工具（不依赖对方是否支持预填） */
async function openQrMaker(target: string | number | object): Promise<void> {
  const link = shareLink.value
  if (!link) {
    ElMessage.warning('请先在「设置 → 收集仓库」里配置并发布表单')
    activeTab.value = 'collect'
    return
  }
  try {
    await copyText(link)
  } catch {
    // 复制失败也继续打开页面，手动复制即可
  }
  const url = target === 'qrbtf' ? 'https://qrbtf.com/' : 'https://cli.im/'
  window.open(url, '_blank', 'noopener')
  ElMessage.success('已复制收集链接，在打开的页面里粘贴即可生成二维码')
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
    if (result.added === 0 && result.failed === 0 && result.invalid === 0 && !result.hasMore) {
      ElMessage.success('没有新的提交')
    } else {
      const parts = [`新增 ${result.added} 条`]
      if (result.failed > 0) parts.push(`解密失败 ${result.failed} 条`)
      if (result.invalid > 0) parts.push(`无效提交 ${result.invalid} 条`)
      if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 条`)
      if (result.hasMore) parts.push('还有更多，请再点一次同步')
      ElMessage.success(`同步完成：${parts.join('，')}`)
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

/* ---------- 合并重复提交 ---------- */

interface DedupeRow extends DuplicateGroup {
  selected: boolean
}

const dedupeDialog = ref(false)
const dedupeRows = ref<DedupeRow[]>([])
const deduping = ref(false)

const duplicateCount = computed(() => findDuplicateGroups(eventId.value).length)
const dedupeLabel = computed(() =>
  duplicateCount.value > 0 ? `合并重复（${duplicateCount.value}）` : '合并重复',
)
const selectedDedupe = computed(() => dedupeRows.value.filter((row) => row.selected))

function openDedupe(): void {
  const groups = findDuplicateGroups(eventId.value)
  if (groups.length === 0) {
    ElMessage.info('没有发现重复提交')
    return
  }
  dedupeRows.value = groups.map((group) => ({ ...group, selected: true }))
  dedupeDialog.value = true
}

function keepLabel(row: DedupeRow): string {
  const keep = row.records.find((record) => record.id === row.keepId)
  if (!keep) return '—'
  return `${keep.name} · ${keep.shippedAt ? '已发货' : '最新提交'}`
}

function mergeLabel(row: DedupeRow): string {
  const withTracking = row.records.find((record) => record.trackingNo)
  if (!withTracking) return '无单号'
  const carrier = withTracking.carrier ? `${withTracking.carrier} · ` : ''
  const shipped = withTracking.shippedAt ? '（已发货）' : ''
  return `${carrier}${withTracking.trackingNo}${shipped}`
}

async function confirmDedupe(): Promise<void> {
  const selected = selectedDedupe.value
  if (selected.length === 0) return
  deduping.value = true
  try {
    const groups: DuplicateGroup[] = selected.map((row) => ({
      phone: row.phone,
      records: row.records,
      keepId: row.keepId,
    }))
    const summary = await mergeDuplicateGroups(groups)
    dedupeDialog.value = false
    ElMessage.success(`已合并 ${summary.groups} 组，删除 ${summary.removed} 条重复记录`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '合并失败')
  } finally {
    deduping.value = false
  }
}

/* ---------- 自定义字段 ---------- */

const fieldDialog = ref(false)
const fieldSaving = ref(false)
const fieldForm = reactive<{
  id: string | null
  label: string
  type: 'text' | 'select'
  options: string[]
  required: boolean
}>({ id: null, label: '', type: 'text', options: [], required: false })

function openFieldDialog(field?: CustomField): void {
  Object.assign(
    fieldForm,
    field
      ? { id: field.id, label: field.label, type: field.type, options: [...field.options], required: field.required }
      : { id: null, label: '', type: 'text', options: [], required: false },
  )
  fieldDialog.value = true
}

async function saveField(): Promise<void> {
  const value = event.value
  if (!value) return
  const label = fieldForm.label.trim()
  if (label === '') {
    ElMessage.warning('请填写字段名称')
    return
  }
  if (fieldForm.type === 'select' && fieldForm.options.length === 0) {
    ElMessage.warning('单选字段至少要有一个选项')
    return
  }
  fieldSaving.value = true
  try {
    const nextField: CustomField = {
      id: fieldForm.id ?? crypto.randomUUID(),
      label,
      type: fieldForm.type,
      options: fieldForm.type === 'select' ? fieldForm.options.map((option) => option.trim()).filter(Boolean) : [],
      required: fieldForm.required,
    }
    const fields = value.customFields ?? []
    value.customFields = fieldForm.id
      ? fields.map((item) => (item.id === fieldForm.id ? nextField : item))
      : [...fields, nextField]
    await saveEvent(value)
    fieldDialog.value = false
    ElMessage.success('字段已保存，修改后请重新「发布 / 更新表单」')
  } finally {
    fieldSaving.value = false
  }
}

async function removeField(field: CustomField): Promise<void> {
  const value = event.value
  if (!value) return
  try {
    await ElMessageBox.confirm(`将删除字段「${field.label}」，已收集的地址数据不会被改动。`, '删除字段', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  value.customFields = (value.customFields ?? []).filter((item) => item.id !== field.id)
  await saveEvent(value)
  ElMessage.success('字段已删除，请重新发布表单')
}

function fieldTypeLabel(field: CustomField): string {
  return field.type === 'select' ? `单选：${field.options.join(' / ')}` : '文本'
}

/* ---------- 批量删除提交 ---------- */

const selectedSubmissions = ref<Address[]>([])

function onSelectionChange(rows: unknown[]): void {
  selectedSubmissions.value = rows.map(asAddress)
}

async function confirmRemoveSelected(): Promise<void> {
  const list = selectedSubmissions.value
  if (list.length === 0) return
  try {
    await ElMessageBox.confirm(`将删除选中的 ${list.length} 条地址，删除后无法恢复。`, '批量删除', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  for (const item of list) {
    await removeAddress(item.id)
  }
  selectedSubmissions.value = []
  ElMessage.success(`已删除 ${list.length} 条地址`)
}

/** 自定义字段在表格里的展示文本 */
function extraText(item: Address): string {
  const entries = Object.entries(item.extra ?? {})
  if (entries.length === 0) return '—'
  const fields = event.value?.customFields ?? []
  return entries
    .map(([key, value]) => `${fields.find((field) => field.id === key)?.label ?? key}：${value}`)
    .join('，')
}

/* ---------- 手动补录 ---------- */

const manualDialog = ref(false)
const manualSaving = ref(false)
const manual = reactive({ douyinId: '', recipientName: '', phone: '', address: '' })
const manualExtra = reactive<Record<string, string>>({})

function openManual(): void {
  manual.douyinId = ''
  manual.recipientName = ''
  manual.phone = ''
  manual.address = ''
  for (const key of Object.keys(manualExtra)) delete manualExtra[key]
  manualDialog.value = true
}

async function submitManual(): Promise<void> {
  const value = event.value
  if (!value) return
  if (manual.recipientName.trim() === '' || manual.phone.trim() === '' || manual.address.trim() === '') {
    ElMessage.warning('请填写收件人、手机号和地址')
    return
  }
  manualSaving.value = true
  try {
    const extra: Record<string, string> = {}
    for (const field of value.customFields ?? []) {
      const input = (manualExtra[field.id] ?? '').trim()
      if (input !== '') extra[field.id] = input
    }
    await addManualSubmission(value, {
      douyinId: manual.douyinId.trim(),
      recipientName: manual.recipientName.trim(),
      phone: manual.phone.trim(),
      address: manual.address.trim(),
      extra,
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

            <div class="field-section">
              <div class="field-section__head">
                <h3 class="field-section__title">自定义字段</h3>
                <el-button size="small" :icon="Plus" @click="openFieldDialog()">添加字段</el-button>
              </div>
              <p class="field-hint">
                固定字段是抖音号、收件名、手机号、收件地址。需要粉丝选择款式、尺码或填写备注时在这里添加，修改后要重新「发布 / 更新表单」。
              </p>
              <ul v-if="(event.customFields ?? []).length > 0" class="field-list">
                <li v-for="field in event.customFields ?? []" :key="field.id" class="field-item">
                  <div class="field-item__main">
                    <span class="field-item__label">{{ field.label }}</span>
                    <span class="field-item__meta">{{ fieldTypeLabel(field) }}{{ field.required ? ' · 必填' : '' }}</span>
                  </div>
                  <div class="field-item__actions">
                    <el-button link type="primary" @click="openFieldDialog(field)">编辑</el-button>
                    <el-button link type="danger" @click="removeField(field)">删除</el-button>
                  </div>
                </li>
              </ul>
              <p v-else class="field-hint">还没有自定义字段。</p>
            </div>
          </section>

          <section class="preview-panel">
            <h2 class="panel-title">粉丝端预览</h2>
            <div class="fan-preview" :style="previewStyle" aria-hidden="true">
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
              <el-input :model-value="shareLink" readonly placeholder="配置收集仓库后生成链接" aria-label="收集链接" />
              <el-button :icon="Link" :disabled="!shareLink" @click="copyShare">复制</el-button>
              <el-dropdown trigger="click" :disabled="!shareLink" @command="openQrMaker">
                <el-button :icon="Grid" :disabled="!shareLink">制作二维码</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="cli">普通二维码 · 草料</el-dropdown-item>
                    <el-dropdown-item command="qrbtf">美观二维码 · QRBTF</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
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
          <el-button :icon="Plus" @click="openManual">手动补录</el-button>
          <el-button :icon="Operation" :disabled="duplicateCount === 0" @click="openDedupe">
            {{ dedupeLabel }}
          </el-button>
          <el-button
            type="danger"
            plain
            :icon="Delete"
            :disabled="selectedSubmissions.length === 0"
            @click="confirmRemoveSelected"
          >
            删除选中{{ selectedSubmissions.length > 0 ? `（${selectedSubmissions.length}）` : '' }}
          </el-button>
          <el-input
            v-model="keyword"
            class="search-input"
            placeholder="搜索抖音号 / 姓名 / 手机号"
            aria-label="搜索提交"
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
          <el-table :data="filteredSubmissions" style="width: 100%" row-key="id" @selection-change="onSelectionChange">
            <el-table-column type="selection" width="46" />
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
            <el-table-column label="自定义信息" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">
                <span :class="row.extra ? '' : 'muted'">{{ extraText(asAddress(row)) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="发货" width="140">
              <template #default="{ row }">
                <span class="stamp" :class="`stamp--${addressStatus(asAddress(row)).tone}`">{{ addressStatus(asAddress(row)).label }}</span>
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
                      v-if="repeatCount(asAddress(row)) > 1"
                      size="small"
                      type="warning"
                      effect="plain"
                      class="repeat-tag"
                    >
                      同设备 ×{{ repeatCount(asAddress(row)) }}
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
                <el-tag size="small" effect="plain" type="info">{{ sourceLabel(asAddress(row)) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="130" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="copySubmission(asAddress(row))">复制</el-button>
                <el-button link type="danger" :icon="Delete" @click="confirmRemoveSubmission(asAddress(row))">删除</el-button>
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

    <!-- 自定义字段 -->
    <el-dialog v-model="fieldDialog" :title="fieldForm.id ? '编辑字段' : '添加字段'" width="520px">
      <el-form label-position="top">
        <el-form-item label="字段名称">
          <el-input v-model="fieldForm.label" placeholder="例如：款式 / 尺码 / 备注" maxlength="20" />
        </el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="fieldForm.type">
            <el-radio-button value="text">文本</el-radio-button>
            <el-radio-button value="select">单选</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="fieldForm.type === 'select'" label="选项">
          <el-select
            v-model="fieldForm.options"
            multiple
            filterable
            allow-create
            default-first-option
            :reserve-keyword="false"
            placeholder="输入后回车添加选项"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="是否必填">
          <el-switch v-model="fieldForm.required" aria-label="是否必填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="fieldDialog = false">取消</el-button>
        <el-button type="primary" :loading="fieldSaving" @click="saveField">保存</el-button>
      </template>
    </el-dialog>

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
        <el-form-item
          v-for="field in event.customFields ?? []"
          :key="field.id"
          :label="field.required ? `${field.label}（必填）` : field.label"
        >
          <el-select v-if="field.type === 'select'" v-model="manualExtra[field.id]" clearable style="width: 100%">
            <el-option v-for="option in field.options" :key="option" :label="option" :value="option" />
          </el-select>
          <el-input v-else v-model="manualExtra[field.id]" maxlength="60" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="manualDialog = false">取消</el-button>
        <el-button type="primary" :loading="manualSaving" @click="submitManual">保存</el-button>
      </template>
    </el-dialog>
    <!-- 合并重复提交 -->
    <el-dialog v-model="dedupeDialog" title="合并重复提交" width="780px">
      <p class="dialog-desc">
        发现 {{ dedupeRows.length }} 组手机号相同的提交。每组保留 1 条：地址信息取最新一次提交，快递单号与发货状态优先保留已发货的那条，其余重复记录会被删除。
      </p>
      <div class="dedupe-scroll">
        <el-table :data="dedupeRows" size="small" style="width: 100%">
          <el-table-column width="50">
            <template #default="{ row }">
              <el-checkbox v-model="row.selected" />
            </template>
          </el-table-column>
          <el-table-column label="手机号" width="140">
            <template #default="{ row }">
              <span class="mono">{{ row.phone }}</span>
            </template>
          </el-table-column>
          <el-table-column label="重复条数" width="90">
            <template #default="{ row }">
              <span class="mono">{{ row.records.length }}</span>
            </template>
          </el-table-column>
          <el-table-column label="保留" min-width="140">
            <template #default="{ row }">{{ keepLabel(asDedupeRow(row)) }}</template>
          </el-table-column>
          <el-table-column label="合并的单号" min-width="180">
            <template #default="{ row }">{{ mergeLabel(asDedupeRow(row)) }}</template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="dedupeDialog = false">取消</el-button>
        <el-button
          type="primary"
          :loading="deduping"
          :disabled="selectedDedupe.length === 0"
          @click="confirmDedupe"
        >
          合并选中的 {{ selectedDedupe.length }} 组
        </el-button>
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

.field-section {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.field-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.field-section__title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}

.field-list {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.field-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}

.field-item:last-child {
  border-bottom: none;
}

.field-item__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.field-item__label {
  font-weight: 600;
  font-size: 13.5px;
}

.field-item__meta {
  color: var(--muted);
  font-size: 12px;
}

.field-item__actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
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
  color: #5f6b7d;
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
  color: #667085;
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
  flex-wrap: wrap;
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

.dedupe-scroll {
  max-height: 46vh;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
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
