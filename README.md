# 亚马逊商品采集助手 (Amazon Product Collector) & GitHub 云端产品库

一款专为跨境电商运营、选品研究、数据采集打造的 Chrome 浏览器扩展程序（遵循最新 **Google Manifest V3** 标准）。不仅支持在浏览亚马逊商品详情页时，一键将核心数据（ASIN、标题、高清原图、抓取价格、币种、短链接等）保存至本地，更支持**直接托管至 GitHub Pages 云端**，随时随地在任何设备（手机、平板、其他电脑）通过专属网址在线查看与双向同步！

---

## 🌟 核心特性

- **纯原生前端架构**：采用标准 HTML5、CSS3、现代 JavaScript (ES6+)，开箱即用，**无须复杂的 Node.js 打包与环境编译**。
- **Manifest V3 全面合规**：基于 Service Worker 后台常驻架构与声明式权限规范，运行轻量、高效、省内存。
- **右键菜单一键采集**：在亚马逊商品页任意位置点击右键，选择“**📥 添加到本地产品库**”即可秒级入库。
- **智能去重与自动比价更新**：若当前 ASIN 已在库中，系统自动更新最新售价与采集时间，并打上更新标记。
- **高清原图深度提取**：解析 `data-old-hires` 原图地址及 `data-a-dynamic-image` 高清图集矩阵，锁定最高分辨率主图。
- **多站点自适应 & 多级选择器防爬兜底**：全面适配全球各主要亚马逊站点（`.com`, `.co.uk`, `.de`, `.co.jp`, `.fr`, `.ca`, `.in` 等）。
- **☁️ GitHub 云端在线展示与实时同步**：
  - **GitHub Pages 在线访问**：自动部署专属云端网址（`https://<你的用户名>.github.io/<仓库名>/`），手机电脑随时访问。
  - **一键双向同步**：在扩展或管理后台点击“**☁️ 同步到云端**”，通过 GitHub API 自动将商品提交到仓库 `data/products.json`，云端页面秒级刷新。
- **双工作台界面形态**：
  - **Popup 快捷弹窗**：快速浏览最近采集的商品、一键采集当前标签页、一键同步云端。
  - **全屏独立 Dashboard 面板**：支持**网格卡片视图**与**数据表格视图**无缝切换、多维排序、按站点筛选。
- **离线导出与备份保障**：
  - **导出 CSV**：预置 UTF-8 BOM 编码，Windows Excel 直接双击打开**绝无中文乱码**。
  - **JSON 全量备份与导入**：支持跨设备导入导出备份。

---

## 🚀 步骤一：Chrome 浏览器本地安装扩展

1. 打开 Chrome 浏览器，访问地址：`chrome://extensions/`
2. 打开右上角的 **“开发者模式”**（Developer mode）开关；
3. 点击左上角 **“加载已解压的扩展程序”**；
4. 选择当前文件夹：
   ```text
   c:\Users\cc271\Desktop\亚马逊插件项目
   ```
5. 点击“选择文件夹”即可成功加载。推荐点击浏览器拼图图标，将 **“亚马逊商品采集助手”** 图钉 📌 固定在工具栏。

---

## 🌐 步骤二：部署到 GitHub 云端（随时随地在线访问）

因为你已经登录了 GitHub，只需按照以下简单 4 步即可将产品库发布到云端：

### 1. 在 GitHub 上新建一个仓库
1. 登录打开 [GitHub New Repository](https://github.com/new)
2. **Repository name**（仓库名）：填写如 `amazon-product-vault`
3. 仓库类型选择 **Public**（公开，可免费使用 GitHub Pages 网站）；
4. **不要勾选** "Add a README file"（因为本地已有完整项目代码）；
5. 点击绿色的 **Create repository** 按钮。

### 2. 将本地代码推送到该仓库
打开 PowerShell 或命令行，在本项目根目录执行以下两行命令（请将 `<你的GitHub用户名>` 和 `<仓库名>` 替换为您刚创建的仓库）：

```bash
git remote add origin https://github.com/<你的GitHub用户名>/<仓库名>.git
git push -u origin main
```
*(在弹出的 GitHub 登录授权弹窗中点击确认即可推送完成)*

### 3. 开启 GitHub Pages（生成专属在线网址）
1. 打开你刚刚推送的 GitHub 仓库页面，点击右上角的 **Settings**（设置）；
2. 在左侧菜单栏中找到并点击 **Pages**；
3. 在 **Build and deployment** 下的 **Branch** 下拉框中：
   - 将 `None` 改选为 **`main`**；
   - 目录保持为 **`/ (root)`**；
   - 点击 **Save**（保存）。
4. 稍等 1~2 分钟，刷新页面，顶部会出现一个提示框：
   > **"Your site is live at https://<你的用户名>.github.io/<仓库名>/"**
5. 点击该链接，或者在任何手机、平板、电脑的浏览器打开，你就能随时随地访问你的专属亚马逊云端产品库！

---

## ⚡ 步骤三：配置插件一键同步至云端

为了让插件在采集商品后能“一键推送到 GitHub 云端”：

### 1. 创建 GitHub 访问令牌 (Personal Access Token)
1. 打开 GitHub 生成 Token 页面：[直达链接创建 Token](https://github.com/settings/tokens/new?scopes=repo&description=AmazonProductVault)；
2. **Note** 随意填写（如 `AmazonVaultSync`）；
3. **Expiration** 选择过期时间（可选择 90 days 或 No expiration）；
4. 勾选 **`repo`** 权限（拥有读写仓库文件的权限）；
5. 滚到最底部，点击绿色 **Generate token** 按钮；
6. **复制生成的 Token 字符串**（格式形如 `ghp_xxxxxxxxxxxxxxxxxxxx`，注意只显示一次，务必复制）。

### 2. 在插件面板中保存配置
1. 打开插件的 **全屏面板**（或直接打开 `dashboard.html`）；
2. 点击顶部导航栏的 **“⚙️ GitHub 配置”** 按钮；
3. 填入：
   - **GitHub 用户名**：你的 GitHub 账户名
   - **仓库名称**：如 `amazon-product-vault`
   - **分支名称**：`main`
   - **Personal Access Token**：粘贴刚生成的 `ghp_...` 令牌；
4. 点击 **“🔍 测试连接”**，提示成功后点击 **“💾 保存配置”**。

---

## 📲 日常使用场景与操作流

```text
                  【亚马逊商品详情页】
                           │
                 [鼠标右键: 添加到本地产品库]
                           │
                           ▼
                  【本地 Chrome 存储】
                  (chrome.storage.local)
                           │
                [点击: ☁️ 同步到云端]
                           │
                    (GitHub REST API)
                           │
                           ▼
                 【GitHub 仓库存储】
                (data/products.json)
                           │
                           ▼
                 【GitHub Pages 网页】
          https://<username>.github.io/<repo>/
      (手机 / 平板 / 异地电脑 随时随地公网访问)
```

1. **一键采集**：在任意亚马逊商品页右键选择“**📥 添加到本地产品库**”。
2. **一键上云**：在插件右上角或管理面板点击 **“☁️ 同步到云端”**，数据自动推送到 GitHub 仓库的 `data/products.json`。
3. **随时随地查看**：直接打开你的 GitHub Pages 网址，在手机端也能流畅查看所有采集商品、对比价格、直达亚马逊！

---

## 📂 项目结构规范

```text
c:\Users\cc271\Desktop\亚马逊插件项目\
├── index.html              # GitHub Pages 默认入口网站（云端在线展示柜）
├── data/
│   └── products.json       # 云端产品数据主库（供 GitHub Pages 动态拉取）
├── manifest.json           # 插件配置文件 (Manifest V3 标准，已配置 GitHub API 权限)
├── background.js          # Service Worker 后台脚本（右键菜单与通信）
├── content.js             # 页面注入脚本（DOM 提取、Toast 反馈）
├── popup.html             # 插件弹窗界面（含云端一键同步按钮）
├── popup.css              # 弹窗样式
├── popup.js               # 弹窗逻辑（采集、搜索、快速同步）
├── dashboard.html         # 独立全屏产品库管理面板
├── dashboard.css          # 全屏响应式后台样式
├── dashboard.js           # 管理面板核心逻辑（GitHub API 同步、双视图、CSV导出）
├── icons/                 # 扩展图标 (16x16, 48x48, 128x128)
├── generate_icons.js      # 图标生成脚本
├── .gitignore             # Git 忽略配置
└── README.md              # 完整指南与操作手册
```
