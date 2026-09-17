# 部署与使用教程

<p align="center">
  <a href="README.md">← 返回项目主页</a>
</p>

> 全程只需浏览器操作，**不需要安装任何工具、也不需要命令行**。
> 分三部分：[一、部署（约 3 分钟）](#一部署从复制模板到站点上线约-3-分钟) · [二、使用（从第一次打开到把周边寄出去）](#二使用从第一次打开到把周边寄出去) · [三、用 Excel 批量发货](#三用-excel-批量发货活动量大时推荐)

---

## 一、部署：从复制模板到站点上线（约 3 分钟）

### 第 1 步 · 复制模板仓库

打开[本仓库页面](https://github.com/Dreamend1ng/vtuber-address-manage)，点右上角绿色的 **Use this template → Create a new repository**：

![本仓库页面：右上角 Use this template](docs/tutorial/github-repo.png)

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

---

## 二、使用：从第一次打开到把周边寄出去

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

解锁后进入概览页（刚开始还没有数据，是正常的）：

![概览页](docs/tutorial/dashboard.png)

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

发布后，收集链接就生成好了（表单设计页右侧可见），点「复制」发给粉丝——微信、抖音私信都可以。旁边的「**制作二维码**」还能一键跳转到[草料二维码](https://cli.im/)或 [QRBTF](https://qrbtf.com/) 生成扫码填表的二维码。粉丝在手机上打开是这样的（无需注册、无需账号）：

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

---

## 三、用 Excel 批量发货（活动量大时推荐）

一场活动要寄几十上百份周边时，逐条手填单号既慢又容易出错。这条流程可以把**单号批量导入、核对无误后再统一发货**，也方便把表格直接交给周边厂商填写。

### 第 1 步 · 从活动导出地址表

到「**活动**」页，在对应活动的卡片上点「**导出 Excel**」，会下载一份该活动的地址表（列包括：抖音ID、收件名、手机号、收件地址、**快递单号**、提交时间）：

![活动列表：导出 Excel](docs/tutorial/excel_1.png)

### 第 2 步 · 在 Excel 里填写快递单号

打开导出的表格，在「**快递单号**」这一列逐行填写单号即可，其他列不用动：

![在 Excel 的快递单号列填写单号](docs/tutorial/excel_2.png)

> 两种常见做法：
> - 把表格直接发给**周边厂商**，请厂商填好单号后回传；
> - 或从厂商的表格里**复制单号列**，粘贴到这份表的「快递单号」列（保持列名与行对应关系即可，整理数据可以让豆包等 AI 帮忙）。
>
> 表格不需要额外处理：应用会按**手机号**自动匹配地址（匹配不上时按收件名兜底）。

### 第 3 步 · 在发货台上传表格

到「**发货**」页进入对应活动，点「**上传 Excel 单号**」，选择刚填好的表格（支持 `.xlsx` 与 `.csv`）：

![发货台：上传 Excel 单号](docs/tutorial/excel_3.png)

### 第 4 步 · 核对解析结果并预填

上传后会弹出「**核对解析结果**」窗口：系统按手机号把单号匹配到对应地址，并逐行显示匹配结果。确认无误后点「**应用预填**」——这一步**只把单号预填进去，不会直接发货**：

![核对解析结果并应用预填](docs/tutorial/excel_4.png)

> 标记为「未匹配」的行通常是：对应地址还没同步到本机、或表格里的手机号与提交时不一致。可以先跳过，之后再手动补。

### 第 5 步 · 确认无误后一键发货

回到发货台，预填过的地址状态会变成「**待确认**」，右上角「**一键发货（N）**」会显示待发货数量。核对后点它即可批量发货；若要修改某条，点该行的「**改单号**」手动调整：

![待确认状态与一键发货](docs/tutorial/excel_5.png)

> 发货完成后请确认「**更新查询数据**」已执行（一键发货会自动尝试更新），粉丝才能用手机号查到最新单号。

---

<p align="center">
  <a href="README.md">← 返回项目主页</a>
</p>
