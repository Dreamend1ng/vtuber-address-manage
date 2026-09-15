# 寄件台 · Dispatch Desk

> 面向 Vtuber 的活动地址收集与周边发货管理工具：**纯前端、零后端、全程加密**。
> 部署在免费的静态托管上（GitHub Pages 等），粉丝地址只加密保存在「你自己的浏览器」和你名下的「GitHub 私有仓库」里。

粉丝用一条链接提交收件信息 → 地址在粉丝浏览器里加密 → 你本机解密、发货 → 粉丝凭手机号自助查询快递单号。

![概览](docs/screenshots/dashboard.png)

## 为什么做这个

- 粉丝的收件地址是**最敏感的数据**（真实姓名 + 住址 + 电话），不应该上传到别人的服务器；
- 独立 Vtuber 通常不想为了发周边去养服务器、买数据库、做备案；
- 所以把它做成了纯静态应用：安全不靠隐藏代码，而是靠一切敏感数据在下发前就已经是密文。

## 功能

### 活动与表单收集
- 每个活动对应一个收集表单，可自定义**活动名称、说明文案、主题色、背景图**；
- 一条链接发给粉丝（微信 / 抖音私信均可），粉丝无需注册、无需账号；
- 粉丝提交的地址会先在浏览器内**加密**，再写入你指定的 GitHub 私有仓库。

### 发货台
- 按活动进入发货台，**手动填写**或**上传 Excel / CSV 批量解析**快递单号；
- 上传后只做**预填**，主播核对无误再点**一键发货**，状态变为「已发货」并带上单号；
- 支持单条发货、撤销发货、改单号；一键导出 Excel。

### 快递单号查询
- 粉丝用**填表时的手机号**自助查询自己的快递单号与快递公司；
- 查询页不显示完整地址，仓库中的查询文件也不含明文手机号（只存加盐哈希）。

### 数据安全与备份
- 主密码经 PBKDF2（60 万次）派生密钥，本机数据以 AES-256-GCM 加密存储；
- 一次性**恢复码**兜底（忘记主密码时可重设）；自动锁定、剪贴板定时清空；
- **加密备份 / 恢复**：备份文件连表单背景图一起打包，放进网盘也安全。

## 界面

| | |
|---|---|
| ![活动](docs/screenshots/events.png) | ![活动详情](docs/screenshots/event-detail.png) |
| 活动列表：一场周边发放一个活动 | 活动详情：提交列表、防捣乱溯源信息 |
| ![发货台](docs/screenshots/shipping-detail.png) | ![解析单号](docs/screenshots/shipping-parse.png) |
| 发货台：待填写 / 待确认 / 已发货一目了然 | 上传 Excel：自动按手机号匹配、核对后预填 |
| ![粉丝填表](docs/screenshots/fan-form.png) | ![锁屏](docs/screenshots/unlock.png) |
| 粉丝填表页：移动端优先，可自定义主题与背景 | 锁屏：主密码只在本机参与密钥计算 |

## 工作原理

```
粉丝浏览器                      GitHub 私有仓库（你的账号下）                主播浏览器
┌──────────────┐  加密提交    ┌──────────────────────────┐   同步解密   ┌────────────────┐
│ 收集表单页    │ ──────────▶ │ events/<活动>/           │ ──────────▶ │ 本机加密保险库  │
│ （公开链接）  │              │   config.json（表单配置）│              │ （IndexedDB）   │
│ 用活动公钥加密 │              │   submissions/*.json（密文）│            │ AES-256-GCM    │
└──────────────┘              │   tracking.json（查单数据）│             └───────┬────────┘
                              └──────────────────────────┘                      │
粉丝查询页 ◀────────────────────────── 发布单号哈希 + 快递单号 ──────────────────┘
```

- **收集链接**里携带一个只授权该专用私有仓库的 Token（粉丝浏览器需要它写入），因此请务必使用「专用仓库 + 专用 Token」，并可在活动结束后随时吊销；
- 提交内容使用**活动专属公钥（RSA-OAEP + AES-GCM 信封加密）**，即使 Token 或仓库泄漏，地址也无法被他人读取；
- 查询文件只包含「手机号加盐哈希 + 姓名掩码 + 快递单号」，不含地址与明文手机号。

## 部署教程：从复制模板到站点上线（全程浏览器操作，约 3 分钟）

不需要安装任何工具、也不需要命令行，下面每一步都有截图对照。

### 第 1 步 · 复制模板仓库

打开[本仓库页面](https://github.com/Dreamend1ng/vtuber-address-manage)，点右上角绿色的 **Use this template → Create a new repository**：

![Use this template 下拉菜单](docs/tutorial/github-use-template.png)

给新仓库起个名字（例如 `my-mailroom`），可见性保持 **Public**，点 **Create repository**：

![从模板创建仓库](docs/tutorial/github-create-from-template.png)

> 免费账号的 GitHub Pages 只对 **Public** 仓库开放，所以这里不要选 Private。
> 也可以用 Fork 的方式复制，但 Fork 仓库需要额外手动启用 Actions；直接「Use this template」最省事。

### 第 2 步 · 开启 GitHub Pages

进入新仓库的 **Settings → Pages**，把 **Build and deployment → Source** 选为 **GitHub Actions**（模板里已经写好了部署工作流，这一步只是告诉 GitHub 用它来发布）：

![Pages 设置：Source 选 GitHub Actions](docs/tutorial/github-pages-settings.png)

### 第 3 步 · 运行部署工作流

进入 **Actions** 标签，左侧选择 **Deploy to GitHub Pages**，点右侧的 **Run workflow → Run workflow**。等约 1 分钟，运行记录变成绿色 ✓ 就部署完成了（此后每次推送代码都会自动重新部署）：

![Actions：Run workflow 与部署成功的绿色 ✓](docs/tutorial/github-actions-workflow.png)

### 第 4 步 · 访问你的站点

打开 `https://<你的用户名>.github.io/<仓库名>/`，看到「寄件台」的界面就说明部署成功了。之后的所有修改（例如改 `src/config.ts` 里的应用名与主题色）都会自动重新部署。

> 同样可以部署到 Cloudflare Pages、Netlify、Vercel：构建命令 `npm run build`，产物目录 `dist`。

## 使用教程：从第一次打开到把周边寄出去

下面用一场完整的演示活动（「梦末百天纪念回」）走一遍全流程，截图均来自线上站点实际操作。

### 第 1 步 · 准备专用收集仓库和 Token（只需做一次）

粉丝的提交需要一个**专用私有仓库**来存放（不要用放代码的主仓库）。在 GitHub 上新建仓库，名字随意（例如 `vam-collect`），可见性务必选 **Private**：

![新建专用私有仓库](docs/tutorial/github-new-private-repo.png)

再在 GitHub 的 [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new) 页面新建一个 Token：填个名字，**Repository access 选 Only select repositories**，只勾选刚才这个专用仓库：

![Token 只授权专用仓库](docs/tutorial/github-token-repo-access.png)

最后在 **Permissions → Repository permissions** 里给 **Contents** 设置 **Read and write**（这是唯一需要的权限），点 Generate token 后**立刻复制保存**（Token 只显示一次）：

![Contents 权限设为 Read and write](docs/tutorial/github-token-permissions.png)

### 第 2 步 · 设置主密码并配置收集仓库

首次打开站点会引导你设置**主密码**，并生成一次性**恢复码**——请离线保存（忘密码 + 丢恢复码 = 数据无法恢复）。之后每次打开都需要在锁屏页输入主密码解锁：

![锁屏：主密码只在本机参与密钥计算](docs/screenshots/unlock.png)

进入「**设置 → 收集仓库**」，把刚才的仓库名（`用户名/仓库名`）和 Token 填进去，点「**测试连接**」，提示通过后保存：

![设置收集仓库并测试连接](docs/tutorial/settings-repo.png)

> 这一配置是**全局**的：之后所有活动共用它，创建新活动时无需重复填写。

### 第 3 步 · 创建活动

到「**活动**」页点「**新建活动**」，填写活动名称（如「梦末百天纪念回」）和表单说明。每个活动会生成一对独立密钥，粉丝提交的地址用这把公钥加密后才上传：

![新建活动对话框](docs/tutorial/event-create.png)

### 第 4 步 · 设计并发布表单

进入活动详情的「**表单设计**」标签，可以修改名称、说明、**主题色**、**背景图**，右侧是粉丝端的实时预览：

![表单设计与粉丝端实时预览](docs/tutorial/event-form-design.png)

点右上角「**发布 / 更新表单**」，表单配置（含活动公钥）就会写入你的专用仓库，状态里会显示「上次发布」的时间：

![发布成功](docs/tutorial/event-published.png)

### 第 5 步 · 把收集链接发给粉丝

发布后，收集链接就生成好了（表单设计页右侧可见），点「复制」发给粉丝——微信、抖音私信都可以。粉丝在手机上打开是这样的（无需注册、无需账号）：

![粉丝填表页（移动端）](docs/tutorial/fan-form-mobile.png)

粉丝填写抖音号、收件人、手机号和地址，勾选同意后点「提交收件信息」——数据会**先在粉丝浏览器里加密，再写入你的仓库**，只有你的保险库能解开：

![粉丝填写完成](docs/tutorial/fan-form-filled.png)

提交后会看到「提交成功」：

![提交成功](docs/tutorial/fan-form-success.png)

### 第 6 步 · 同步提交到本机

回到活动详情的「**提交列表**」标签，点「**同步提交**」从仓库拉取密文并解密。收到的地址一目了然，还带有 IP / 设备等防捣乱溯源信息（可在设置中关闭采集）：

![同步提交后收到地址](docs/tutorial/submissions-synced.png)

### 第 7 步 · 填单号、一键发货

到「**发货**」页进入活动（或从提交列表点「填写单号」）。可以手动填，也可以**上传 Excel / CSV 批量解析**（按手机号自动匹配、核对后预填）：

![发货列表](docs/tutorial/shipping-list.png)

![发货台](docs/tutorial/shipping-desk.png)

填快递公司和单号后保存，状态会变成「待确认」，确认无误后点右上角「**一键发货**」：

![填写快递单号](docs/tutorial/shipping-fill-dialog.png)

![核对预填的单号](docs/tutorial/shipping-prefill.png)

发货后状态变为「已发货」，单号同时发布到查询页。支持改单号、撤销发货，也能一键导出 Excel：

![已发货](docs/tutorial/shipping-shipped.png)

### 第 8 步 · 粉丝用手机号自助查单

把活动的「**查询链接**」发到粉丝群（发货页和活动详情里都能复制）。粉丝输入填表时的手机号即可查到单号——页面只显示**掩码姓名、掩码手机号和快递单号**，不会暴露完整地址：

![粉丝查询快递单号](docs/tutorial/track-result.png)

> 每次集中发货结束后，建议到「**备份 / 恢复**」导出一份加密备份（连表单背景图一起打包），放进网盘也安全：
>
> ![导出加密备份](docs/screenshots/backup.png)

## 日常流程

```
创建活动 ──▶ 发布表单 ──▶ 粉丝提交（自动加密）──▶ 同步到本机 ──▶ 填单号 / 上传 Excel ──▶ 一键发货 ──▶ 粉丝手机号查单
```

## 安全与隐私

| 数据 | 存放在哪 | 谁能看到 |
|---|---|---|
| 地址、订单、活动配置 | 你的浏览器（AES-256-GCM 密文） | 只有解锁后的你 |
| 备份文件 | 你选择的位置（网盘/离线） | 只有主密码持有者 |
| 粉丝提交 | 你的 GitHub 私有仓库（密文） | 理论上 GitHub 只能看到密文 |
| 查询数据 | 你的 GitHub 私有仓库 | 链接持有者；仅有掩码姓名 + 单号 |

**如实说明的边界**

- 主密码不保存、不上传；忘记密码可以在登录页用**恢复码**重设；
- IP / 设备信息用于防捣乱与事后核对，可在「设置」中关闭采集（关闭后表单不会在同意前访问第三方服务）；使用 VPN、改 UA 可以伪造这些信息；
- 解锁状态下若浏览器被注入恶意脚本或安装了恶意扩展，仍有理论泄漏面，建议保持自动锁定并控制浏览器环境；
- 收集链接会携带仓库 Token（这是纯前端方案写入仓库所必需的），请务必**专用仓库 + 专用 Token**，不要授权到放代码的仓库；
- **查单链接**里的每条记录都用「手机号 + 活动盐值」经 PBKDF2（60 万次）派生的密钥加密：拿到链接的人仍可对手机号做离线爆破，但每个候选号码都要付出一次高成本派生，且猜不中时看不到掩码与单号。请只在粉丝群内部分发查单链接；
- 链接中的 Token 对**数据仓库**有读写权限：请定期导出加密备份，并留意仓库的提交记录；活动结束后建议立即吊销 Token；应用在同步前会校验远端表单公钥，发现被替换会中止同步并告警。

## 本地开发

```bash
npm install     # 安装依赖
npm run dev     # 本地开发（http://localhost:5173）
npm run build   # 类型检查 + 构建到 dist/
npm run preview # 预览构建产物
npm test        # 运行单元测试（加密、备份、单号解析等）
```

## 技术栈

Vue 3 + TypeScript + Vite + Element Plus · WebCrypto（PBKDF2 / AES-GCM / RSA-OAEP）· IndexedDB（idb）· fflate（xlsx 读写）

## 目录结构

```
src/
├─ crypto/      # 密钥派生、信封加密、恢复码（全部基于 WebCrypto）
├─ services/    # 保险库、记录、活动、发货、GitHub、备份
├─ views/       # 概览 / 活动 / 发货 / 备份恢复 / 设置 + 粉丝表单/查询页
├─ storage/     # IndexedDB 封装
└─ utils/       # 设备指纹、IP 查询、xlsx 读写、格式化等
```

## 自定义

部署前只需要改 `src/config.ts`：应用名、英文标识、主题色、常用快递公司、默认自动锁定时间等。

## 常见问题

- **提示「无法连接 GitHub」**：当前网络拦截了 `api.github.com`，更换网络或使用代理后重试；
- **提示「仓库不存在，或 Token 无权访问」**：fine-grained Token 的 Repository access 里没有勾选该仓库（Token 创建后新建的仓库不会自动获得权限）；
- **粉丝打不开收集链接**：确认表单已「发布」，且收集仓库配置的 Token 未过期、未被吊销；
- **换电脑 / 多设备**：在旧设备导出加密备份，新设备用「合并导入」即可（按更新时间保留较新版本）。

## 许可证

本项目基于 [MIT License](LICENSE) 开源，欢迎自行部署、修改与分发。
