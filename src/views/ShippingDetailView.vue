<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Download, Link, Refresh, Upload, Van } from '@element-plus/icons-vue'
import type { Address } from '../types/models'
import { collectionSettings, eventSubmissions, findEvent } from '../services/records'
import {
  collectionReady,
  exportEventSubmissionsXlsx,
  publishTracking,
  trackUrlFor,
} from '../services/events'
import {
  addressStatus,
  applyTrackingPrefill,
  buildPrefill,
  setTracking,
  shipOne,
  shipReady,
  shippingStats,
  unshipOne,
  type TrackingPrefill,
} from '../services/shipping'
import { siteConfig } from '../config'
import { copyText } from '../utils/clipboard'
import { parseCsv } from '../utils/csv'
import { parseXlsx } from '../utils/xlsxReader'
import { readFileInput } from '../utils/image'
import { formatDateTime } from '../utils/format'

/** el-table 插槽里的 row 类型是 DefaultRow，运行期就是业务对象，这里还原类型 */
const asAddress = (row: unknown): Address => row as Address

const route = useRoute()
const router = useRouter()

const eventId = computed(() => String(route.params.id))
const event = computed(() => findEvent(eventId.value))

const submissions = computed(() =>
  eventSubmissions(eventId.value).sort((a, b) => (a.submittedAt ?? a.createdAt) - (b.submittedAt ?? b.createdAt)),
)

const stats = computed(() => shippingStats(submissions.value))

const keyword = ref('')
const statusFilter = ref<'all' | 'pending' | 'ready' | 'shipped'>('all')

function statusOf(address: Address): 'pending' | 'ready' | 'shipped' {
  if (address.shippedAt) return 'shipped'
  if (address.trackingNo) return 'ready'
  return 'pending'
}

const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return submissions.value.filter((address) => {
    if (statusFilter.value !== 'all' && statusOf(address) !== statusFilter.value) return false
    if (query === '') return true
    return [address.name, address.douyinId ?? '', address.phone, address.trackingNo ?? '']
      .join(' ')
      .toLowerCase()
      .includes(query)
  })
})

/** 有已发货数据尚未发布到查询页 */
const trackingOutdated = computed(() => {
  const latestShipped = submissions.value.reduce((max, item) => Math.max(max, item.shippedAt ?? 0), 0)
  return latestShipped > (event.value?.lastTrackingPublishedAt ?? 0)
})

/* ---------- 手动填写单号 ---------- */

const trackingDialog = ref(false)
const trackingTarget = ref<Address | null>(null)
const trackingForm = reactive({ carrier: '', trackingNo: '' })
const savingTracking = ref(false)

function openTracking(address: Address): void {
  trackingTarget.value = address
  trackingForm.carrier = address.carrier ?? ''
  trackingForm.trackingNo = address.trackingNo ?? ''
  trackingDialog.value = true
}

async function saveTracking(): Promise<void> {
  const address = trackingTarget.value
  if (!address) return
  if (trackingForm.trackingNo.trim() === '') {
    ElMessage.warning('请填写快递单号')
    return
  }
  savingTracking.value = true
  try {
    await setTracking(address, trackingForm.trackingNo, trackingForm.carrier)
    trackingDialog.value = false
    ElMessage.success('单号已保存，核对无误后点击「一键发货」')
  } finally {
    savingTracking.value = false
  }
}

/* ---------- Excel 上传预填 ---------- */

const uploadInput = ref<HTMLInputElement>()
const previewDialog = ref(false)
const previewRows = ref<TrackingPrefill[]>([])
const skippedEmpty = ref(0)
const parsing = ref(false)
const applying = ref(false)

const matchedCount = computed(() => previewRows.value.filter((row) => row.addressId).length)

function previewRowClass({ row }: { row: TrackingPrefill }): string {
  return row.addressId ? '' : 'row-unmatched'
}

async function onUpload(event: Event): Promise<void> {
  const file = readFileInput(event)
  if (!file) return
  parsing.value = true
  try {
    const name = file.name.toLowerCase()
    let rows: string[][]
    if (name.endsWith('.csv')) {
      rows = parseCsv(await file.text())
    } else if (name.endsWith('.xlsx')) {
      rows = parseXlsx(new Uint8Array(await file.arrayBuffer()))
    } else {
      throw new Error('只支持 .xlsx 和 .csv 文件；如果是旧版 .xls，请先另存为 .xlsx')
    }
    const result = buildPrefill(rows, eventId.value)
    previewRows.value = result.prefill
    skippedEmpty.value = result.skippedEmpty
    previewDialog.value = true
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '无法解析这个文件')
  } finally {
    parsing.value = false
  }
}

async function confirmPrefill(): Promise<void> {
  applying.value = true
  try {
    const applied = await applyTrackingPrefill(previewRows.value)
    previewDialog.value = false
    ElMessage.success(`已预填 ${applied} 条单号，核对后点击「一键发货」`)
  } finally {
    applying.value = false
  }
}

/* ---------- 发货 ---------- */

const shipping = ref(false)

async function publishQuietly(): Promise<void> {
  if (!event.value || !collectionReady(collectionSettings.value)) return
  try {
    await publishTracking(event.value)
  } catch {
    ElMessage.warning('发货已完成，但查询数据发布失败，请点击「更新查询数据」重试')
  }
}

async function oneClickShip(): Promise<void> {
  const current = event.value
  if (!current) return
  const readyCount = submissions.value.filter((item) => item.trackingNo && !item.shippedAt).length
  if (readyCount === 0) {
    ElMessage.warning('还没有已填写单号、等待发货的地址')
    return
  }
  try {
    await ElMessageBox.confirm(`将把 ${readyCount} 条地址标记为「已发货」，并把单号发布到查询页。`, '一键发货', {
      type: 'warning',
      confirmButtonText: '确认发货',
      cancelButtonText: '再核对一下',
    })
  } catch {
    return
  }
  shipping.value = true
  try {
    const shipped = await shipReady(eventId.value)
    await publishQuietly()
    ElMessage.success(`已发货 ${shipped.length} 条，粉丝现在可以用手机号查询单号了`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '发货失败')
  } finally {
    shipping.value = false
  }
}

async function shipSingle(address: Address): Promise<void> {
  if (!address.trackingNo) {
    openTracking(address)
    return
  }
  await shipOne(address)
  await publishQuietly()
  ElMessage.success('已标记为发货，查询数据已同步更新')
}

async function unshipSingle(address: Address): Promise<void> {
  try {
    await ElMessageBox.confirm(`将 ${address.name} 撤销回未发货状态。`, '撤销发货', {
      type: 'warning',
      confirmButtonText: '撤销',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  await unshipOne(address)
  await publishQuietly()
  ElMessage.success('已撤销发货，查询数据已同步更新')
}

/* ---------- 发布与链接 ---------- */

const publishing = ref(false)

async function publishNow(): Promise<void> {
  const current = event.value
  if (!current) return
  if (!collectionReady(collectionSettings.value)) {
    ElMessage.warning('请先在「设置 → 收集仓库」里配置全局收集仓库')
    return
  }
  publishing.value = true
  try {
    const count = await publishTracking(current)
    ElMessage.success(`查询数据已更新（已发货 ${count} 条）`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '发布失败')
  } finally {
    publishing.value = false
  }
}

async function copyTrackLink(): Promise<void> {
  const current = event.value
  if (!current) return
  if (!collectionReady(collectionSettings.value)) {
    ElMessage.warning('请先在「设置 → 收集仓库」里配置全局收集仓库')
    return
  }
  await copyText(trackUrlFor(current))
  ElMessage.success('查询链接已复制，可以发给粉丝了')
}

function exportXlsx(): void {
  const current = event.value
  if (!current) return
  exportEventSubmissionsXlsx(current, submissions.value)
  ElMessage.success('已导出 Excel（明文文件，请妥善保管）')
}
</script>

<template>
  <div v-if="event">
    <header class="page-header">
      <div class="detail-head">
        <el-button :icon="ArrowLeft" text class="back-button" @click="router.push({ name: 'shipping' })">
          发货列表
        </el-button>
        <h1 class="page-title">{{ event.name }}</h1>
        <p class="page-desc">
          共 <span class="mono">{{ stats.total }}</span> 条地址 ·
          待填写 <span class="mono">{{ stats.pending }}</span> ·
          待确认 <span class="mono">{{ stats.ready }}</span> ·
          已发货 <span class="mono">{{ stats.shipped }}</span>
          <template v-if="event.lastTrackingPublishedAt">
            · 查询数据更新于 {{ formatDateTime(event.lastTrackingPublishedAt) }}
          </template>
        </p>
      </div>
      <div class="header-actions">
        <el-button :icon="Upload" :loading="parsing" @click="uploadInput?.click()">上传 Excel 单号</el-button>
        <el-button :icon="Download" @click="exportXlsx">导出 Excel</el-button>
        <el-button :icon="Refresh" :loading="publishing" @click="publishNow">更新查询数据</el-button>
        <el-button :icon="Link" @click="copyTrackLink">复制查询链接</el-button>
        <el-button
          type="primary"
          :icon="Van"
          :loading="shipping"
          :disabled="stats.ready === 0"
          @click="oneClickShip"
        >
          一键发货（{{ stats.ready }}）
        </el-button>
      </div>
    </header>

    <el-alert v-if="trackingOutdated" type="warning" :closable="false" class="ship-alert">
      有已发货的数据还没有发布到查询页，粉丝暂时查不到最新单号。点击右上角「更新查询数据」即可。
    </el-alert>

    <div class="toolbar">
      <el-radio-group v-model="statusFilter">
        <el-radio-button value="all">全部 {{ stats.total }}</el-radio-button>
        <el-radio-button value="pending">待填写 {{ stats.pending }}</el-radio-button>
        <el-radio-button value="ready">待确认 {{ stats.ready }}</el-radio-button>
        <el-radio-button value="shipped">已发货 {{ stats.shipped }}</el-radio-button>
      </el-radio-group>
      <el-input
        v-model="keyword"
        class="search-input"
        placeholder="搜索姓名 / 抖音号 / 手机号 / 单号"
        aria-label="搜索地址"
        clearable
      />
    </div>

    <section class="panel">
      <el-table :data="filtered" style="width: 100%" row-key="id">
        <el-table-column label="收件名" min-width="120">
          <template #default="{ row }">
            <div class="cell-name">{{ row.name }}</div>
            <div v-if="row.douyinId" class="cell-sub mono">{{ row.douyinId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="手机号" min-width="130">
          <template #default="{ row }">
            <span class="mono">{{ row.phone }}</span>
          </template>
        </el-table-column>
        <el-table-column label="收件地址" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            {{ [row.province, row.city, row.district].filter(Boolean).join('') }}{{ row.detail }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <span class="stamp" :class="`stamp--${addressStatus(asAddress(row)).tone}`">{{ addressStatus(asAddress(row)).label }}</span>
          </template>
        </el-table-column>
        <el-table-column label="快递公司" width="110">
          <template #default="{ row }">
            <span v-if="row.carrier">{{ row.carrier }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="快递单号" min-width="160">
          <template #default="{ row }">
            <span v-if="row.trackingNo" class="mono">{{ row.trackingNo }}</span>
            <span v-else class="muted">未填写</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openTracking(asAddress(row))">
              {{ row.trackingNo ? '改单号' : '填写单号' }}
            </el-button>
            <el-button v-if="row.trackingNo && !row.shippedAt" link type="success" @click="shipSingle(asAddress(row))">
              发货
            </el-button>
            <el-button v-if="row.shippedAt" link type="warning" @click="unshipSingle(asAddress(row))">撤销</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-hint">
            {{ submissions.length === 0 ? '这个活动还没有收集到地址。' : '没有符合筛选条件的地址。' }}
          </div>
        </template>
      </el-table>
    </section>

    <input ref="uploadInput" type="file" accept=".xlsx,.csv" hidden @change="onUpload" />

    <!-- 手动填写单号 -->
    <el-dialog v-model="trackingDialog" title="填写快递单号" width="480px">
      <p class="dialog-desc">
        {{ trackingTarget?.name }} · <span class="mono">{{ trackingTarget?.phone }}</span>
      </p>
      <el-form label-position="top">
        <div class="form-grid">
          <el-form-item label="快递公司">
            <el-select v-model="trackingForm.carrier" filterable allow-create default-first-option clearable style="width: 100%">
              <el-option v-for="carrier in siteConfig.carriers" :key="carrier" :label="carrier" :value="carrier" />
            </el-select>
          </el-form-item>
          <el-form-item label="快递单号">
            <el-input
              v-model="trackingForm.trackingNo"
              class="mono"
              placeholder="粘贴或输入单号"
              maxlength="40"
              @keyup.enter="saveTracking"
            />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="trackingDialog = false">取消</el-button>
        <el-button type="primary" :loading="savingTracking" @click="saveTracking">保存单号</el-button>
      </template>
    </el-dialog>

    <!-- 上传预览 -->
    <el-dialog v-model="previewDialog" title="核对解析结果" width="760px">
      <p class="dialog-desc">
        共解析出 <span class="mono">{{ previewRows.length }}</span> 条单号，
        匹配成功 <span class="mono">{{ matchedCount }}</span> 条，未匹配
        <span class="mono">{{ previewRows.length - matchedCount }}</span> 条<template v-if="skippedEmpty > 0">，已跳过 {{ skippedEmpty }} 条空行</template>。
        确认后会把这些单号预填到对应地址（不会直接发货）。
      </p>
      <div class="preview-scroll">
        <el-table :data="previewRows" size="small" style="width: 100%" :row-class-name="previewRowClass">
          <el-table-column label="行号" width="60">
            <template #default="{ row }">
              <span class="mono">{{ row.rowNumber }}</span>
            </template>
          </el-table-column>
          <el-table-column label="收件人" min-width="100">
            <template #default="{ row }">{{ row.name || '—' }}</template>
          </el-table-column>
          <el-table-column label="手机号" min-width="130">
            <template #default="{ row }">
              <span class="mono">{{ row.phone || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="快递公司" width="100">
            <template #default="{ row }">{{ row.carrier || '—' }}</template>
          </el-table-column>
          <el-table-column label="单号" min-width="150">
            <template #default="{ row }">
              <span class="mono">{{ row.trackingNo }}</span>
            </template>
          </el-table-column>
          <el-table-column label="匹配结果" min-width="170">
            <template #default="{ row }">
              <el-tag v-if="row.addressId" size="small" type="success" effect="plain">{{ row.message }}</el-tag>
              <el-tag v-else size="small" type="danger" effect="plain">{{ row.message }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="previewDialog = false">取消</el-button>
        <el-button type="primary" :loading="applying" :disabled="matchedCount === 0" @click="confirmPrefill">
          应用预填（{{ matchedCount }} 条）
        </el-button>
      </template>
    </el-dialog>
  </div>

  <div v-else class="panel empty-hint">
    <p>没有找到这个活动。</p>
    <el-button @click="router.push({ name: 'shipping' })">返回发货列表</el-button>
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

.header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.ship-alert {
  margin-bottom: 14px;
}

.search-input {
  max-width: 280px;
  min-width: 200px;
}

.cell-name {
  font-weight: 600;
}

.cell-sub {
  font-size: 12px;
  margin-top: 2px;
}

.dialog-desc {
  margin: 0 0 12px;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1.4fr;
  gap: 0 14px;
}

.preview-scroll {
  max-height: 46vh;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.preview-scroll :deep(.row-unmatched) {
  background: #fdf3f2;
}

@media (max-width: 640px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
