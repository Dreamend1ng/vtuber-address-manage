<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Download, FolderOpened } from '@element-plus/icons-vue'
import { siteConfig } from '../config'
import { buildBackup, mergeBackup, parseBackup, restoreBackup, type BackupFile } from '../services/backup'
import { addresses, events, loadRecords } from '../services/records'
import { initializeVault } from '../services/vault'
import { downloadJson, timestampForFilename } from '../utils/download'
import { formatDateTime } from '../utils/format'

const router = useRouter()

const LAST_BACKUP_KEY = 'dispatch-desk:last-backup'
const lastBackupAt = ref(Number(localStorage.getItem(LAST_BACKUP_KEY) ?? 0))
const busy = ref(false)

const dataSummary = computed(() => `${events.value.length} 个活动 · ${addresses.value.length} 条地址`)

/* ---------- 导出 ---------- */

async function exportBackup(): Promise<void> {
  busy.value = true
  try {
    const backup = await buildBackup()
    downloadJson(`${siteConfig.appName}-加密备份-${timestampForFilename()}.json`, backup)
    const now = Date.now()
    localStorage.setItem(LAST_BACKUP_KEY, String(now))
    lastBackupAt.value = now
    ElMessage.success('加密备份已导出，建议放到网盘或离线保存')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导出失败')
  } finally {
    busy.value = false
  }
}

/* ---------- 恢复 / 合并 ---------- */

const restoreInput = ref<HTMLInputElement>()
const mergeInput = ref<HTMLInputElement>()

function readFile(event: Event): File | null {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  input.value = ''
  return file
}

async function onRestoreFile(event: Event): Promise<void> {
  const file = readFile(event)
  if (!file) return
  let backup: BackupFile
  try {
    backup = parseBackup(await file.text())
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '无法读取备份文件')
    return
  }
  const exportedAt = new Date(backup.exportedAt).toLocaleString('zh-CN')
  try {
    await ElMessageBox.confirm(
      `备份导出时间：${exportedAt}，包含 ${backup.records.length} 条加密记录。恢复后本机现有数据将被完全替换，并需使用该备份的主密码（或恢复码）重新解锁。`,
      '从备份恢复',
      {
        type: 'warning',
        confirmButtonText: '替换并恢复',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      },
    )
  } catch {
    return
  }
  try {
    await restoreBackup(backup)
    await initializeVault()
    await router.replace({ name: 'unlock' })
    ElMessage.success('备份已恢复，请使用该备份的主密码解锁')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '恢复失败')
  }
}

const mergeDialog = ref(false)
const pendingMerge = ref<BackupFile | null>(null)
const mergePassword = ref('')
const merging = ref(false)

async function onMergeFile(event: Event): Promise<void> {
  const file = readFile(event)
  if (!file) return
  try {
    pendingMerge.value = parseBackup(await file.text())
    mergePassword.value = ''
    mergeDialog.value = true
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '无法读取备份文件')
  }
}

async function confirmMerge(): Promise<void> {
  if (!pendingMerge.value || mergePassword.value === '') return
  merging.value = true
  try {
    const result = await mergeBackup(pendingMerge.value, mergePassword.value)
    await loadRecords()
    mergeDialog.value = false
    ElMessage.success(
      `合并完成：新增 ${result.added} 条，更新 ${result.updated} 条，跳过 ${result.skipped} 条${
        result.assets > 0 ? `，背景图 ${result.assets} 张` : ''
      }`,
    )
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '合并失败')
  } finally {
    merging.value = false
  }
}
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1 class="page-title">备份 / 恢复</h1>
        <p class="page-desc">
          数据只保存在这台设备，浏览器数据可能被清理。定期导出加密备份是最重要的习惯。
        </p>
      </div>
    </header>

    <section class="panel panel-pad">
      <h2 class="panel-title">导出加密备份</h2>
      <p class="panel-desc">
        备份文件包含全部记录密文、保险库密钥信息与表单背景图，<strong>只有主密码（或恢复码）能解开</strong>。
        当前数据：{{ dataSummary }}。<template v-if="lastBackupAt > 0">
          上次导出：{{ formatDateTime(lastBackupAt) }}。
        </template>
      </p>
      <div class="action-row">
        <el-button type="primary" :icon="Download" :loading="busy" @click="exportBackup">
          导出加密备份
        </el-button>
      </div>
      <p class="panel-hint">
        备份是密文，放进网盘、邮箱也安全；但请同时记住主密码或妥善保存恢复码，否则备份无法解开。
      </p>
    </section>

    <section class="panel panel-pad">
      <h2 class="panel-title">恢复与合并</h2>
      <p class="panel-desc">
        <strong>合并导入</strong>：把备份里的记录并入当前保险库，按更新时间保留较新的版本，适合多台设备之间搬运数据，不会删除本机现有内容（需要输入该备份的主密码）。
        <br />
        <strong>从备份恢复</strong>：先清空本机数据，再完整恢复备份，适合换设备或数据损坏时使用；恢复后需要用该备份的主密码解锁。
      </p>
      <div class="action-row">
        <el-button :icon="FolderOpened" @click="mergeInput?.click()">合并导入备份</el-button>
        <el-button type="danger" plain @click="restoreInput?.click()">从备份恢复（替换全部数据）</el-button>
      </div>
      <input ref="mergeInput" type="file" accept=".json,application/json" hidden @change="onMergeFile" />
      <input ref="restoreInput" type="file" accept=".json,application/json" hidden @change="onRestoreFile" />
    </section>

    <!-- 合并导入密码 -->
    <el-dialog v-model="mergeDialog" title="合并导入备份" width="480px">
      <p class="dialog-desc">
        备份包含 {{ pendingMerge?.records.length ?? 0 }} 条记录。请输入该备份的主密码，用于在内存中解密后重新加密到当前保险库。
      </p>
      <el-input
        v-model="mergePassword"
        type="password"
        show-password
        placeholder="备份的主密码"
        autocomplete="off"
        @keyup.enter="confirmMerge"
      />
      <template #footer>
        <el-button @click="mergeDialog = false">取消</el-button>
        <el-button type="primary" :loading="merging" :disabled="mergePassword === ''" @click="confirmMerge">
          开始合并
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.panel-pad {
  padding: 20px 22px;
  margin-bottom: 16px;
}

.panel-title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 700;
}

.panel-desc {
  margin: 0 0 14px;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.8;
  /* 中文一行约 1em/字，用 em 控制行宽 */
  max-width: 68em;
}

.action-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.panel-hint {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.dialog-desc {
  margin: 0 0 12px;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
}
</style>
