/**
 * dashboard.js - 全屏产品库管理面板业务逻辑
 * 职责：
 * 1. 读写 chrome.storage.local 实现产品数据离线持久化
 * 2. 统计指标计算（总数、站点分布、最新时间）
 * 3. 动态搜索过滤、站点筛选、多维度排序
 * 4. 卡片视图 / 详细表格视图无缝切换
 * 5. 一键导出 Excel 兼容 CSV、JSON 备份与数据恢复
 * 6. ASIN 与链接快捷复制
 */

const VAULT_ACCESS_PASSWORD = "888";
let allProducts = [];
let currentViewMode = localStorage.getItem("az_vault_view_mode") || "grid"; // 'grid' or 'table'

document.addEventListener("DOMContentLoaded", () => {
  initUI();
  initVaultLock();
});

/**
 * 访问安全门禁与密码验证（方案2：密码 888 保护）
 */
function initVaultLock() {
  const overlay = document.getElementById("vaultLockOverlay");
  const inputEl = document.getElementById("vaultPasswordInput");
  const btnUnlock = document.getElementById("btnUnlockVault");
  const errorEl = document.getElementById("lockErrorMsg");
  const btnRelock = document.getElementById("btnRelock");

  // 判断是否为网页端环境 (GitHub Pages、http/https 或 index.html)
  const isWebEnvironment = window.location.protocol.startsWith("http");
  const isIndexHtml = window.location.pathname.endsWith("index.html");
  const shouldEnforceLock = isWebEnvironment || isIndexHtml;

  // 如果是在本地插件扩展环境 (chrome-extension://) 且不是在线网页，直接放行
  if (!shouldEnforceLock) {
    if (overlay) overlay.style.display = "none";
    loadProducts();
    return;
  }

  // 网页端环境：检查当前会话 (sessionStorage) 是否已经解锁
  const isUnlocked = sessionStorage.getItem("az_vault_unlocked") === "true";

  if (isUnlocked) {
    if (overlay) overlay.style.display = "none";
    loadProducts();
  } else {
    // 强制显示锁屏全屏遮罩，且不加载任何产品数据
    if (overlay) {
      overlay.style.display = "flex";
      overlay.style.opacity = "1";
    }
    if (inputEl) {
      setTimeout(() => inputEl.focus(), 150);
    }
  }

  // 执行解锁验证
  function doUnlock() {
    if (!inputEl) return;
    const pwd = inputEl.value.trim();
    if (pwd === VAULT_ACCESS_PASSWORD) {
      sessionStorage.setItem("az_vault_unlocked", "true");
      if (errorEl) errorEl.style.display = "none";

      if (overlay) {
        overlay.style.transition = "opacity 0.25s ease";
        overlay.style.opacity = "0";
        setTimeout(() => {
          overlay.style.display = "none";
        }, 250);
      }

      showToast("✓ 验证成功，欢迎访问！");
      // 验证通过后再从云端加载并渲染数据
      loadProducts();
    } else {
      if (errorEl) {
        errorEl.style.display = "block";
        errorEl.textContent = "⚠️ 密码错误，请重新输入！";
        errorEl.classList.remove("shake-active");
        void errorEl.offsetWidth; // 触发 reflow 重新播放抖动动画
        errorEl.classList.add("shake-active");
      }
      inputEl.value = "";
      inputEl.focus();
    }
  }

  if (btnUnlock) {
    btnUnlock.addEventListener("click", doUnlock);
  }

  if (inputEl) {
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doUnlock();
      }
    });
  }

  // 重新锁定网页按钮
  if (btnRelock) {
    btnRelock.addEventListener("click", () => {
      sessionStorage.removeItem("az_vault_unlocked");
      // 清空当前页面商品和数据展示，防止窥屏
      allProducts = [];
      renderProducts();
      updateMetrics();

      if (overlay) {
        overlay.style.display = "flex";
        overlay.style.opacity = "1";
      }
      if (inputEl) {
        inputEl.value = "";
        setTimeout(() => inputEl.focus(), 150);
      }
      if (errorEl) errorEl.style.display = "none";
      showToast("🔒 页面已重新锁定");
    });
  }
}

/**
 * 初始化界面事件监听
 */
function initUI() {
  // 视图切换
  const btnGrid = document.getElementById("btnViewGrid");
  const btnTable = document.getElementById("btnViewTable");

  btnGrid.addEventListener("click", () => switchViewMode("grid"));
  btnTable.addEventListener("click", () => switchViewMode("table"));

  // 搜索与过滤
  const filterKeyword = document.getElementById("filterKeyword");
  const btnClearFilter = document.getElementById("btnClearFilter");
  const filterSite = document.getElementById("filterSite");
  const sortOrder = document.getElementById("sortOrder");

  filterKeyword.addEventListener("input", () => {
    btnClearFilter.style.display = filterKeyword.value ? "block" : "none";
    renderProducts();
  });

  btnClearFilter.addEventListener("click", () => {
    filterKeyword.value = "";
    btnClearFilter.style.display = "none";
    renderProducts();
  });

  filterSite.addEventListener("change", renderProducts);
  sortOrder.addEventListener("change", renderProducts);

  // 导出与清空
  document.getElementById("btnExportCsv").addEventListener("click", exportToCsv);
  document.getElementById("btnExportJson").addEventListener("click", exportToJson);
  document.getElementById("fileInputJson").addEventListener("change", handleImportJson);
  document.getElementById("btnClearAll").addEventListener("click", handleClearAll);

  // 小菜单栏保存按钮事件
  const btnToolbarSave = document.getElementById("btnToolbarSave");
  if (btnToolbarSave) {
    btnToolbarSave.addEventListener("click", () => {
      if (!btnToolbarSave.disabled) {
        saveAndSyncToGithub();
      }
    });
  }

  // GitHub 云端同步相关事件
  document.getElementById("btnSyncToGithub").addEventListener("click", handleSyncToGithub);
  document.getElementById("btnPullFromGithub").addEventListener("click", handlePullFromGithub);
  document.getElementById("btnOpenGithubModal").addEventListener("click", openGithubModal);
  document.getElementById("btnCloseGithubModal").addEventListener("click", closeGithubModal);
  document.getElementById("btnSaveGithubConfig").addEventListener("click", saveGithubConfig);
  document.getElementById("btnTestGithub").addEventListener("click", testGithubConnection);
  document.getElementById("btnToggleToken").addEventListener("click", toggleTokenVisibility);

  // 点击遮罩外部关闭弹窗
  document.getElementById("githubModal").addEventListener("click", (e) => {
    if (e.target.id === "githubModal") closeGithubModal();
  });

  // 图片高清大图预览灯箱关闭事件
  const btnCloseLightbox = document.getElementById("btnCloseLightbox");
  if (btnCloseLightbox) btnCloseLightbox.addEventListener("click", closeImageLightbox);

  const lightboxModal = document.getElementById("imageLightboxModal");
  if (lightboxModal) {
    lightboxModal.addEventListener("click", (e) => {
      if (e.target.classList.contains("lightbox-backdrop") || e.target.id === "imageLightboxModal") {
        closeImageLightbox();
      }
    });
  }

  // 全局 ESC 快捷键关闭灯箱与模态弹窗
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const lb = document.getElementById("imageLightboxModal");
      if (lb && lb.style.display !== "none") {
        closeImageLightbox();
      }
      const gh = document.getElementById("githubModal");
      if (gh && gh.style.display !== "none") {
        closeGithubModal();
      }
    }
  });

  // 加载已有 GitHub 配置
  loadGithubConfig();

  // 监听后台数据变化（实时同步）
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.amazon_products) {
        allProducts = changes.amazon_products.newValue || [];
        updateSiteFilterOptions();
        updateMetrics();
        renderProducts();
      }
    });
  }

  // 恢复上次保存的视图模式
  switchViewMode(currentViewMode);
}

/**
 * 切换网格 / 表格视图
 */
function switchViewMode(mode) {
  currentViewMode = mode;
  localStorage.setItem("az_vault_view_mode", mode);

  const gridBtn = document.getElementById("btnViewGrid");
  const tableBtn = document.getElementById("btnViewTable");
  const gridContainer = document.getElementById("viewGridContainer");
  const tableContainer = document.getElementById("viewTableContainer");

  if (mode === "grid") {
    gridBtn.classList.add("active");
    tableBtn.classList.remove("active");
    gridContainer.style.display = "grid";
    tableContainer.style.display = "none";
  } else {
    tableBtn.classList.add("active");
    gridBtn.classList.remove("active");
    gridContainer.style.display = "none";
    tableContainer.style.display = "block";
  }
}

/**
 * 从本地或云端读取产品（同时兼容 Chrome 扩展与 GitHub Pages 静态环境）
 */
function loadProducts() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["amazon_products"], (res) => {
      allProducts = res.amazon_products || [];
      if (allProducts.length === 0 && window.location.protocol.startsWith("http")) {
        // 如果插件本地为空且处于在线网页，尝试兜底读取当前目录的 products.json
        fetchCloudProductsFallback();
      } else {
        updateSiteFilterOptions();
        updateMetrics();
        renderProducts();
      }
    });
  } else {
    // 纯 Web 环境 (GitHub Pages)
    fetchCloudProductsFallback();
  }
}

function fetchCloudProductsFallback() {
  fetch("./data/products.json?_t=" + Date.now())
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then((data) => {
      if (Array.isArray(data)) {
        allProducts = data;
        updateSiteFilterOptions();
        updateMetrics();
        renderProducts();
      }
    })
    .catch((err) => {
      console.warn("[Amazon Vault] 无法从 ./data/products.json 加载数据:", err);
      updateSiteFilterOptions();
      updateMetrics();
      renderProducts();
    });
}

/**
 * 统一本地保存方法
 */
function persistProducts(list, callback) {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ amazon_products: list }, callback);
  } else {
    localStorage.setItem("amazon_products", JSON.stringify(list));
    if (callback) callback();
  }
}

/**
 * 动态更新站点筛选下拉项
 */
function updateSiteFilterOptions() {
  const filterSite = document.getElementById("filterSite");
  const currentVal = filterSite.value;

  const sites = new Set();
  allProducts.forEach((p) => {
    if (p.site) sites.add(p.site);
  });

  let optionsHtml = '<option value="ALL">全部站点</option>';
  Array.from(sites).sort().forEach((site) => {
    optionsHtml += `<option value="${escapeHtml(site)}">${escapeHtml(site)}</option>`;
  });

  filterSite.innerHTML = optionsHtml;
  if (Array.from(sites).includes(currentVal)) {
    filterSite.value = currentVal;
  } else {
    filterSite.value = "ALL";
  }
}

/**
 * 更新指标卡片数据
 */
function updateMetrics() {
  const totalEl = document.getElementById("statTotalCount");
  if (totalEl) totalEl.textContent = allProducts.length;

  const siteCountEl = document.getElementById("statSiteCount");
  const siteListEl = document.getElementById("statSiteList");
  if (siteCountEl || siteListEl) {
    const sites = new Set(allProducts.map((p) => p.site).filter(Boolean));
    if (siteCountEl) siteCountEl.textContent = sites.size;
    if (siteListEl) {
      siteListEl.textContent = sites.size > 0
        ? Array.from(sites).slice(0, 3).join(", ") + (sites.size > 3 ? "..." : "")
        : "暂无站点";
    }
  }

  const latestEl = document.getElementById("statLatestTime");
  if (latestEl) {
    if (allProducts.length > 0) {
      const latest = allProducts[0];
      latestEl.textContent = latest.updatedAt || latest.collectedAt || "-";
    } else {
      latestEl.textContent = "-";
    }
  }
}

/**
 * 获取过滤并排序后的商品列表
 */
function getFilteredAndSortedProducts() {
  const keyword = document.getElementById("filterKeyword").value.trim().toLowerCase();
  const selectedSite = document.getElementById("filterSite").value;
  const sortType = document.getElementById("sortOrder").value;

  // 1. 过滤
  let result = allProducts.filter((item) => {
    if (selectedSite !== "ALL" && item.site !== selectedSite) {
      return false;
    }
    if (keyword) {
      const matchTitle = item.title && item.title.toLowerCase().includes(keyword);
      const matchAsin = item.asin && item.asin.toLowerCase().includes(keyword);
      if (!matchTitle && !matchAsin) return false;
    }
    return true;
  });

  // 2. 排序
  result.sort((a, b) => {
    if (sortType === "TIME_DESC") {
      const timeA = a.updatedTimestamp || a.collectedTimestamp || 0;
      const timeB = b.updatedTimestamp || b.collectedTimestamp || 0;
      return timeB - timeA;
    } else if (sortType === "TIME_ASC") {
      const timeA = a.updatedTimestamp || a.collectedTimestamp || 0;
      const timeB = b.updatedTimestamp || b.collectedTimestamp || 0;
      return timeA - timeB;
    } else if (sortType === "TITLE_ASC") {
      return (a.title || "").localeCompare(b.title || "");
    }
    return 0;
  });

  return result;
}

/**
 * 渲染主内容（网格与表格）
 */
function renderProducts() {
  const filtered = getFilteredAndSortedProducts();
  const gridContainer = document.getElementById("viewGridContainer");
  const tableBody = document.getElementById("tableBody");
  const emptyView = document.getElementById("emptyView");

  if (filtered.length === 0) {
    gridContainer.innerHTML = "";
    tableBody.innerHTML = "";
    emptyView.style.display = "flex";
    return;
  }

  emptyView.style.display = "none";

  // 1. 渲染网格卡片
  let gridHtml = "";
  // 2. 渲染表格数据
  let tableHtml = "";

  const defaultImg = "icons/icon48.png";

  filtered.forEach((item) => {
    const displayImg = item.imageUrl || defaultImg;
    const displayTime = item.updatedAt ? `${item.updatedAt} (更新)` : (item.collectedAt || "-");
    const displayDim = convertDimensionsToCm(item.dimensions);
    const displayWeight = convertWeightToKg(item.weight);
    const shipping = calculateShippingCosts(item.dimensions, item.weight);
    const purchaseVal = item.purchasePrice || "";
    const { l: lVal, w: wVal, h: hVal } = parseDimParts(item.dimensions);

    // Grid Card HTML
    gridHtml += `
      <div class="grid-card" data-asin="${item.asin}">
        <div class="card-image-wrap" data-asin="${item.asin}" title="点击放大查看高清大图">
          <span class="card-badge-site">${escapeHtml(item.site || "Amazon")}</span>
          <img src="${displayImg}" class="card-image previewable-image" data-asin="${item.asin}" alt="Product" onerror="this.src='${defaultImg}'" loading="lazy" title="点击放大查看高清大图" />
        </div>
        <div class="grid-card-content">
          <a href="${item.url}" target="_blank" class="grid-card-title" title="${escapeHtml(item.title)}">
            ${escapeHtml(item.title || "未命名商品")}
          </a>
          <div class="grid-card-meta">
            <span class="grid-card-price">${escapeHtml(item.price || "未标价")}</span>
            <span class="grid-card-asin" title="点击复制 ASIN" data-copy="${escapeHtml(item.asin)}">
              ${escapeHtml(item.asin)}
            </span>
          </div>
          <div class="grid-card-specs">
            <span class="spec-pill" title="尺寸: ${escapeHtml(displayDim)}${item.rawDimensions ? ` (原始: ${escapeHtml(item.rawDimensions)})` : ''}">📏 ${escapeHtml(displayDim)}</span>
            <span class="spec-pill" title="重量: ${escapeHtml(displayWeight)}${item.rawWeight ? ` (原始: ${escapeHtml(item.rawWeight)})` : ''}">⚖️ ${escapeHtml(displayWeight)}</span>
          </div>
          <!-- 长宽高三框输入行 (支持输入后实时动态计算) -->
          <div class="grid-card-dim-edit" title="长宽高分别输入 (cm)，修改后即时自动重算运费">
            <span class="dim-edit-label">📏 尺寸:</span>
            <div class="dim-inputs-wrap card-dim-wrap">
              <input type="number" step="any" min="0" class="dim-box-input editable-input" data-asin="${item.asin}" data-dim="l" value="${escapeHtml(lVal)}" placeholder="长" title="长 (cm)" />
              <span class="dim-multiply">×</span>
              <input type="number" step="any" min="0" class="dim-box-input editable-input" data-asin="${item.asin}" data-dim="w" value="${escapeHtml(wVal)}" placeholder="宽" title="宽 (cm)" />
              <span class="dim-multiply">×</span>
              <input type="number" step="any" min="0" class="dim-box-input editable-input" data-asin="${item.asin}" data-dim="h" value="${escapeHtml(hVal)}" placeholder="高" title="高 (cm)" />
            </div>
            <span style="font-size:10px;color:#94a3b8;">cm</span>
          </div>
          <!-- 采购价手动输入行 -->
          <div class="grid-card-purchase" title="手动输入该商品采购价格 (¥)">
            <span class="purchase-label">💰 采购价:</span>
            <div class="purchase-input-wrap">
              <span class="purchase-currency">¥</span>
              <input type="text" class="card-input-purchase editable-input" data-asin="${item.asin}" data-field="purchasePrice" placeholder="输入采购价" value="${escapeHtml(purchaseVal)}" />
            </div>
            <button class="btn-card-save" data-save-asin="${item.asin}" title="保存修改并同步到 GitHub 云端" style="display:none;">💾 保存</button>
          </div>
          ${shipping ? `
            <div class="grid-card-shipping">
              <div class="shipping-pill">
                <span class="shipping-label">✈️ 空运头程</span>
                <span class="shipping-price air">¥${shipping.airCost}</span>
              </div>
              <div class="shipping-pill">
                <span class="shipping-label">🚢 海运头程</span>
                <span class="shipping-price sea">¥${shipping.seaCost}</span>
              </div>
              <div class="shipping-chg-wt" title="体积重: ${shipping.volWeight}kg, 实重: ${shipping.actualWeight}kg (${shipping.isVolumetric ? '计体积重' : '计实重'})">
                计重: ${shipping.chargeableWeight}kg
              </div>
            </div>
          ` : ''}
          <div class="grid-card-footer">
            <span>${displayTime}</span>
            <div class="card-actions">
              <button class="btn-icon-action" title="复制商品直达链接" data-copy-url="${item.url}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
              </button>
              <button class="btn-icon-action danger" title="删除商品" data-delete-asin="${item.asin}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Table Row HTML（长宽高分别一个小框，实重纯数字输入，输入后对应相关数据自动联动计算）
    const wtValForInput = extractWeightKgNumber(item.weight);

    tableHtml += `
      <tr data-asin="${item.asin}">
        <td>
          <img src="${displayImg}" class="table-thumb previewable-image" data-asin="${item.asin}" alt="Product" onerror="this.src='${defaultImg}'" title="点击放大查看高清大图" />
        </td>
        <td>
          <span class="table-asin" title="点击复制 ASIN" data-copy="${escapeHtml(item.asin)}">
            ${escapeHtml(item.asin)}
          </span>
        </td>
        <td>
          <a href="${item.url}" target="_blank" class="table-title-link" title="${escapeHtml(item.title)}">
            ${escapeHtml(item.title || "未命名商品")}
          </a>
        </td>
        <!-- 抓取价格 (可直接编辑) -->
        <td>
          <input type="text" class="table-edit-input price-cell-input editable-input" data-asin="${item.asin}" data-field="price" value="${escapeHtml(item.price || '')}" placeholder="未标价" title="点击编辑抓取价格 (按回车或点击保存)" />
        </td>
        <!-- 采购价 (可直接编辑) -->
        <td>
          <input type="text" class="table-edit-input purchase-cell-input editable-input" data-asin="${item.asin}" data-field="purchasePrice" value="${escapeHtml(purchaseVal)}" placeholder="输入采购价" title="点击编辑采购价 (¥) (按回车或点击保存)" />
        </td>
        <!-- 尺寸 (长宽高分别一个小框，输入后自动联动计算) -->
        <td>
          <div class="dim-inputs-wrap" title="长×宽×高 (cm)，修改后即时自动重算运费">
            <input type="number" step="any" min="0" class="dim-box-input editable-input" data-asin="${item.asin}" data-dim="l" value="${escapeHtml(lVal)}" placeholder="长" title="长 (cm)" />
            <span class="dim-multiply">×</span>
            <input type="number" step="any" min="0" class="dim-box-input editable-input" data-asin="${item.asin}" data-dim="w" value="${escapeHtml(wVal)}" placeholder="宽" title="宽 (cm)" />
            <span class="dim-multiply">×</span>
            <input type="number" step="any" min="0" class="dim-box-input editable-input" data-asin="${item.asin}" data-dim="h" value="${escapeHtml(hVal)}" placeholder="高" title="高 (cm)" />
          </div>
        </td>
        <!-- 实重 (纯数字展示与输入，绝无字母，修改后自动联动重算) -->
        <td>
          <input type="number" step="any" min="0" class="table-edit-input weight-cell-input editable-input" data-asin="${item.asin}" data-field="weight" value="${escapeHtml(wtValForInput)}" placeholder="0.00" title="实重 (kg) - 仅输入纯数字，修改后即时自动重算运费" />
        </td>
        <!-- 计费重 (动态联动更新，纯数字展示) -->
        <td>
          <span class="table-chg-wt" id="chgWt_${item.asin}" title="体积重: ${shipping ? shipping.volWeight : '-'}kg, 实重: ${shipping ? shipping.actualWeight : '-'}kg (${shipping && shipping.isVolumetric ? '体积重较大' : '实重较大'})">${shipping ? shipping.chargeableWeight : '-'}</span>
        </td>
        <!-- ✈️ 空运头程 (动态联动更新) -->
        <td>
          <span class="table-air-cost" id="airCost_${item.asin}" title="计费重 ${shipping ? shipping.chargeableWeight : 0}kg × 66元">${shipping ? `¥${shipping.airCost}` : '-'}</span>
        </td>
        <!-- 🚢 海运头程 (动态联动更新) -->
        <td>
          <span class="table-sea-cost" id="seaCost_${item.asin}" title="计费重 ${shipping ? shipping.chargeableWeight : 0}kg × 15元">${shipping ? `¥${shipping.seaCost}` : '-'}</span>
        </td>
        <td>
          <span class="table-time">${displayTime}</span>
        </td>
        <!-- 操作列 -->
        <td>
          <div class="table-actions">
            <!-- 行级别独立保存按钮（激活编辑时即刻出现） -->
            <button class="btn-row-save" data-save-asin="${item.asin}" title="保存此行修改并同步到 GitHub 云端" style="display:none;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
              <span>保存</span>
            </button>
            <button class="btn-icon-action" title="复制商品链接" data-copy-url="${item.url}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            </button>
            <button class="btn-icon-action danger" title="删除" data-delete-asin="${item.asin}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  gridContainer.innerHTML = gridHtml;
  tableBody.innerHTML = tableHtml;

  bindCardAndTableEvents();
}

/**
 * 激活保存按钮（选择输入框或修改内容时触发）
 */
function activateSaveButton(asin) {
  const toolbarSaveBtn = document.getElementById("btnToolbarSave");
  if (toolbarSaveBtn) {
    toolbarSaveBtn.disabled = false;
    toolbarSaveBtn.classList.remove("disabled");
    toolbarSaveBtn.classList.add("active");
    const textEl = document.getElementById("btnToolbarSaveText");
    if (textEl && !toolbarSaveBtn.classList.contains("syncing")) {
      textEl.textContent = "💾 保存修改并同步云端";
    }
  }

  if (asin) {
    // 激活对应表格行的保存按钮和高亮
    const row = document.querySelector(`tr[data-asin="${asin}"]`);
    if (row) {
      row.classList.add("row-editing");
      const rowSaveBtn = row.querySelector(".btn-row-save");
      if (rowSaveBtn) rowSaveBtn.style.display = "inline-flex";
    }

    // 激活对应网格卡片的保存按钮
    const card = document.querySelector(`.grid-card[data-asin="${asin}"]`);
    if (card) {
      const cardSaveBtn = card.querySelector(".btn-card-save");
      if (cardSaveBtn) cardSaveBtn.style.display = "inline-block";
    }
  }
}

/**
 * 重置并停用保存按钮（数据成功同步后触发）
 */
function deactivateSaveButton() {
  const toolbarSaveBtn = document.getElementById("btnToolbarSave");
  if (toolbarSaveBtn) {
    toolbarSaveBtn.disabled = true;
    toolbarSaveBtn.classList.remove("active", "syncing");
    toolbarSaveBtn.classList.add("disabled");
    const textEl = document.getElementById("btnToolbarSaveText");
    if (textEl) textEl.textContent = "✓ 已同步到云端";
    setTimeout(() => {
      if (textEl && toolbarSaveBtn.disabled) {
        textEl.textContent = "💾 保存修改并同步云端";
      }
    }, 2500);
  }

  document.querySelectorAll(".products-table tbody tr.row-editing").forEach((r) => r.classList.remove("row-editing"));
  document.querySelectorAll(".btn-row-save").forEach((b) => (b.style.display = "none"));
  document.querySelectorAll(".btn-card-save").forEach((b) => (b.style.display = "none"));
}

/**
 * 从页面 DOM 中收集所有编辑过的数据并回填至 allProducts
 */
function collectEditsFromDOM(targetAsin = null) {
  // 1. 处理长宽高三小框 (data-dim="l", data-dim="w", data-dim="h")
  const handledAsins = new Set();
  document.querySelectorAll("[data-dim='l']").forEach((lInp) => {
    const asin = lInp.dataset.asin;
    if (targetAsin && asin !== targetAsin) return;
    if (handledAsins.has(asin)) return;
    handledAsins.add(asin);

    const container = lInp.closest("tr") || lInp.closest(".grid-card");
    if (!container) return;

    const lVal = container.querySelector('[data-dim="l"]')?.value.trim();
    const wVal = container.querySelector('[data-dim="w"]')?.value.trim();
    const hVal = container.querySelector('[data-dim="h"]')?.value.trim();

    const item = allProducts.find((p) => p.asin === asin);
    if (!item) return;

    if (lVal && wVal && hVal && !isNaN(parseFloat(lVal)) && !isNaN(parseFloat(wVal)) && !isNaN(parseFloat(hVal))) {
      item.dimensions = `${parseFloat(lVal)} x ${parseFloat(wVal)} x ${parseFloat(hVal)} cm`;
    }
  });

  // 2. 处理常规输入框 (price, purchasePrice, weight)
  const selector = targetAsin ? `.editable-input[data-asin="${targetAsin}"]` : ".editable-input";
  const inputs = document.querySelectorAll(selector);

  inputs.forEach((inp) => {
    const asin = inp.dataset.asin;
    const field = inp.dataset.field;
    if (!asin || !field) return;

    const item = allProducts.find((p) => p.asin === asin);
    if (!item) return;

    const rawVal = inp.value.trim();
    if (field === "weight") {
      item.weight = rawVal ? convertWeightToKg(rawVal) : "暂无";
    } else if (field === "purchasePrice") {
      if (rawVal) {
        const numPart = rawVal.replace(/[¥￥\s]/g, "");
        if (!isNaN(parseFloat(numPart))) {
          item.purchasePrice = `¥${numPart}`;
        } else {
          item.purchasePrice = rawVal;
        }
      } else {
        item.purchasePrice = "";
      }
    } else if (field === "price") {
      item.price = rawVal;
    }
  });

  // 3. 统一更新受影响商品的头程运费
  allProducts.forEach((item) => {
    if (!targetAsin || item.asin === targetAsin) {
      item.shipping = calculateShippingCosts(item.dimensions, item.weight);
    }
  });
}

/**
 * 保存修改并同步到 GitHub 云端数据库
 */
async function saveAndSyncToGithub(targetAsin = null) {
  const token = ensureCloudToken();
  if (!token) {
    alert("未提供有效 Token，已取消云端同步操作。");
    return;
  }

  const toolbarSaveBtn = document.getElementById("btnToolbarSave");
  const saveText = document.getElementById("btnToolbarSaveText");
  if (toolbarSaveBtn) {
    toolbarSaveBtn.classList.add("syncing");
    toolbarSaveBtn.disabled = true;
    if (saveText) saveText.textContent = "☁️ 正在同步到云端...";
  }

  // 1. 从当前 DOM 输入框收集最新修改到 allProducts
  collectEditsFromDOM(targetAsin);

  // 2. 刷新更新时间
  const nowStr = new Date().toLocaleString("zh-CN", { hour12: false });
  if (targetAsin) {
    const targetItem = allProducts.find((p) => p.asin === targetAsin);
    if (targetItem) targetItem.updatedAt = nowStr;
  } else {
    allProducts.forEach((p) => {
      p.updatedAt = nowStr;
    });
  }

  const { owner, repo, branch = "main" } = currentGithubConfig;
  showToast("正在将修改保存并同步至 GitHub 云端...");

  try {
    const filePath = "data/products.json";
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

    // 获取最新 sha
    let sha = null;
    const checkRes = await fetch(`${apiUrl}?ref=${branch}&_t=${Date.now()}`, {
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `Bearer ${token}`,
        "User-Agent": "Amazon-Product-Collector-MV3"
      }
    });

    if (checkRes.ok) {
      const fileInfo = await checkRes.json();
      sha = fileInfo.sha;
    }

    // 提交全量更新数据
    const base64Content = utf8ToBase64(JSON.stringify(allProducts, null, 2));
    const payload = {
      message: targetAsin
        ? `Update product ${targetAsin} - ${formatDateStr()}`
        : `Update products (${allProducts.length} items) - ${formatDateStr()}`,
      content: base64Content,
      branch: branch
    };
    if (sha) payload.sha = sha;

    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `Bearer ${token}`,
        "User-Agent": "Amazon-Product-Collector-MV3",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (putRes.ok) {
      persistProducts(allProducts, () => {
        deactivateSaveButton();
        showToast("✓ 数据已成功保存并实时同步到 GitHub 云端！");
        renderProducts();
      });
    } else {
      const errJson = await putRes.json();
      throw new Error(errJson.message || "GitHub API 提交失败");
    }
  } catch (err) {
    console.error("保存并同步云端异常:", err);
    alert(`保存并同步到云端失败: ${err.message}`);
    if (toolbarSaveBtn) {
      toolbarSaveBtn.classList.remove("syncing");
      toolbarSaveBtn.disabled = false;
      if (saveText) saveText.textContent = "💾 保存修改并同步云端";
    }
  }
}

/**
 * 绑定卡片与表格的动态事件
 */
function bindCardAndTableEvents() {
  // 点击复制 ASIN
  document.querySelectorAll("[data-copy]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const text = el.getAttribute("data-copy");
      copyToClipboard(text, `ASIN: ${text} 已复制到剪贴板`);
    });
  });

  // 点击复制商品 URL
  document.querySelectorAll("[data-copy-url]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const url = el.getAttribute("data-copy-url");
      copyToClipboard(url, "商品链接已复制到剪贴板");
    });
  });

  // 点击删除按钮
  document.querySelectorAll("[data-delete-asin]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const asin = el.getAttribute("data-delete-asin");
      deleteProduct(asin);
    });
  });

  // 行级别保存按钮点击
  document.querySelectorAll(".btn-row-save").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const asin = btn.getAttribute("data-save-asin");
      saveAndSyncToGithub(asin);
    });
  });

  // 卡片内部保存按钮点击
  document.querySelectorAll(".btn-card-save").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const asin = btn.getAttribute("data-save-asin");
      saveAndSyncToGithub(asin);
    });
  });

  // 监听所有可编辑输入框（采购价、抓取价格、尺寸、实重）
  document.querySelectorAll(".editable-input").forEach((input) => {
    // 聚焦时激活小菜单栏保存按钮与行保存按钮
    input.addEventListener("focus", (e) => {
      const asin = e.target.dataset.asin;
      activateSaveButton(asin);
    });

    // 输入时激活保存按钮并支持尺寸/重量实时动态联动重算
    input.addEventListener("input", (e) => {
      const asin = e.target.dataset.asin;
      activateSaveButton(asin);

      const field = e.target.dataset.field;
      const dimType = e.target.dataset.dim;

      // 如果修改了长、宽、高任意小框或实重，即时动态重新计算
      if (dimType || field === "weight") {
        // 1. 表格视图行内联动计算
        const row = e.target.closest("tr");
        if (row) {
          const lInp = row.querySelector('[data-dim="l"]');
          const wInp = row.querySelector('[data-dim="w"]');
          const hInp = row.querySelector('[data-dim="h"]');
          const wtInp = row.querySelector('[data-field="weight"]');

          const l = lInp ? parseFloat(lInp.value) : 0;
          const w = wInp ? parseFloat(wInp.value) : 0;
          const h = hInp ? parseFloat(hInp.value) : 0;
          const wtVal = wtInp ? wtInp.value.trim() : "";

          let dimStr = (l > 0 && w > 0 && h > 0) ? `${l} x ${w} x ${h} cm` : "";
          const ship = calculateShippingCosts(dimStr, wtVal);

          const chgWtEl = document.getElementById(`chgWt_${asin}`);
          const airCostEl = document.getElementById(`airCost_${asin}`);
          const seaCostEl = document.getElementById(`seaCost_${asin}`);

          if (chgWtEl) {
            chgWtEl.textContent = ship ? ship.chargeableWeight : "-";
            chgWtEl.title = ship
              ? `体积重: ${ship.volWeight}kg, 实重: ${ship.actualWeight}kg (${ship.isVolumetric ? '体积重较大' : '实重较大'})`
              : "-";
          }
          if (airCostEl) airCostEl.textContent = ship ? `¥${ship.airCost}` : "-";
          if (seaCostEl) seaCostEl.textContent = ship ? `¥${ship.seaCost}` : "-";
        }

        // 2. 网格卡片视图联动计算
        const card = e.target.closest(".grid-card");
        if (card) {
          const lInp = card.querySelector('[data-dim="l"]');
          const wInp = card.querySelector('[data-dim="w"]');
          const hInp = card.querySelector('[data-dim="h"]');
          const l = lInp ? parseFloat(lInp.value) : 0;
          const w = wInp ? parseFloat(wInp.value) : 0;
          const h = hInp ? parseFloat(hInp.value) : 0;
          const prod = allProducts.find((p) => p.asin === asin);
          const wtVal = prod ? prod.weight : "";

          let dimStr = (l > 0 && w > 0 && h > 0) ? `${l} x ${w} x ${h} cm` : "";
          const ship = calculateShippingCosts(dimStr, wtVal);
          if (ship) {
            const airEl = card.querySelector(".shipping-price.air");
            const seaEl = card.querySelector(".shipping-price.sea");
            const chgEl = card.querySelector(".shipping-chg-wt");
            if (airEl) airEl.textContent = `¥${ship.airCost}`;
            if (seaEl) seaEl.textContent = `¥${ship.seaCost}`;
            if (chgEl) chgEl.textContent = `计重: ${ship.chargeableWeight}kg`;
          }
        }
      }
    });

    // 回车键快捷保存并同步云端
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const asin = e.target.dataset.asin;
        saveAndSyncToGithub(asin);
      }
    });
  });

  // 点击图片或图片外框放大查看高清大图灯箱 (Lightbox)
  document.querySelectorAll(".previewable-image, .card-image-wrap").forEach((el) => {
    el.addEventListener("click", (e) => {
      // 避免点击右上角站点徽标时误触发
      if (e.target.classList.contains("card-badge-site")) return;
      e.stopPropagation();
      const img = el.tagName === "IMG" ? el : el.querySelector("img");
      const asin = el.dataset.asin || (img ? img.dataset.asin : "");
      const prod = allProducts.find((p) => p.asin === asin);
      const imgSrc = img ? img.src : "";
      if (prod) {
        openImageLightbox(prod.imageUrl || imgSrc, prod.title, prod.asin);
      } else if (imgSrc) {
        openImageLightbox(imgSrc, "商品大图", asin || "");
      }
    });
  });
}

/**
 * 确保已获取用于云端写操作的 GitHub Token
 */
function ensureCloudToken() {
  if (currentGithubConfig.token) {
    return currentGithubConfig.token;
  }

  const input = prompt(
    "🔐【GitHub 云端数据库权限验证】\n\n从 GitHub 云端数据库中永久删除商品需要您的管理权限。\n请粘贴您的 GitHub Personal Access Token (只需输入一次，本浏览器将安全记住)：",
    ""
  );

  if (input && input.trim()) {
    currentGithubConfig.token = input.trim();
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ az_github_config: currentGithubConfig });
    } else {
      localStorage.setItem("az_github_config", JSON.stringify(currentGithubConfig));
    }
    updatePagesUrlDisplay();
    return currentGithubConfig.token;
  }
  return null;
}

/**
 * 删除单个商品（直接从 GitHub 云端数据库 data/products.json 永久删除）
 */
async function deleteProduct(asin) {
  if (!confirm(`确定要从 GitHub 云端数据库彻底删除该商品 (ASIN: ${asin}) 吗？\n\n此操作将直接更新 GitHub 仓库，不可恢复！`)) {
    return;
  }

  // 1. 验证或获取 Token
  const token = ensureCloudToken();
  if (!token) {
    alert("未提供有效 Token，已取消云端删除操作。");
    return;
  }

  const { owner, repo, branch = "main" } = currentGithubConfig;
  showToast("正在从 GitHub 云端数据库中删除...");

  try {
    const filePath = "data/products.json";
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

    // 2. 从 GitHub 读取最新文件及其 SHA
    const checkRes = await fetch(`${apiUrl}?ref=${branch}&_t=${Date.now()}`, {
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `Bearer ${token}`,
        "User-Agent": "Amazon-Product-Collector-MV3"
      }
    });

    if (!checkRes.ok) {
      const err = await checkRes.json();
      throw new Error(err.message || "无法连接 GitHub 仓库，请检查 Token 权限");
    }

    const fileInfo = await checkRes.json();
    let cloudList = [];
    if (fileInfo.content) {
      cloudList = JSON.parse(base64ToUtf8(fileInfo.content.replace(/\s/g, "")));
    }

    // 3. 过滤掉要删除的商品
    const originalLength = cloudList.length;
    cloudList = cloudList.filter((item) => item.asin !== asin);

    if (cloudList.length === originalLength) {
      showToast("云端未找到该商品，可能已被删除");
    }

    // 4. 提交回 GitHub
    const base64Content = utf8ToBase64(JSON.stringify(cloudList, null, 2));
    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `Bearer ${token}`,
        "User-Agent": "Amazon-Product-Collector-MV3",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `Delete product: ${asin} (Remaining: ${cloudList.length})`,
        content: base64Content,
        branch: branch,
        sha: fileInfo.sha
      })
    });

    if (putRes.ok) {
      // 5. 更新本地当前列表并重绘
      allProducts = cloudList;
      persistProducts(allProducts, () => {
        updateSiteFilterOptions();
        updateMetrics();
        renderProducts();
      });
      showToast(`✓ 已成功从 GitHub 数据库彻底删除 (ASIN: ${asin})！`);
    } else {
      const err = await putRes.json();
      alert(`云端删除提交失败: ${err.message}`);
    }
  } catch (err) {
    console.error("云端删除异常:", err);
    alert(`云端删除失败: ${err.message}`);
  }
}

/**
 * 清空全部产品（直接从 GitHub 云端数据库清空）
 */
async function handleClearAll() {
  if (allProducts.length === 0) {
    showToast("当前产品库已为空");
    return;
  }

  if (!confirm(`【高危操作】确定要清空 GitHub 云端数据库中的全部 ${allProducts.length} 件商品吗？\n\n此操作将直接清空 GitHub 仓库，不可恢复！`)) {
    return;
  }

  const token = ensureCloudToken();
  if (!token) {
    alert("未提供有效 Token，已取消清空操作。");
    return;
  }

  const { owner, repo, branch = "main" } = currentGithubConfig;
  showToast("正在清空 GitHub 云端数据库...");

  try {
    const filePath = "data/products.json";
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

    const checkRes = await fetch(`${apiUrl}?ref=${branch}&_t=${Date.now()}`, {
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `Bearer ${token}`,
        "User-Agent": "Amazon-Product-Collector-MV3"
      }
    });

    if (!checkRes.ok) {
      throw new Error("无法连接 GitHub 仓库，请检查 Token");
    }

    const fileInfo = await checkRes.json();
    const base64Content = utf8ToBase64("[]");

    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `Bearer ${token}`,
        "User-Agent": "Amazon-Product-Collector-MV3",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: "Clear all products from vault",
        content: base64Content,
        branch: branch,
        sha: fileInfo.sha
      })
    });

    if (putRes.ok) {
      allProducts = [];
      persistProducts([], () => {
        updateSiteFilterOptions();
        updateMetrics();
        renderProducts();
      });
      showToast("✓ 已成功清空 GitHub 云端数据库！");
    } else {
      const err = await putRes.json();
      alert(`清空失败: ${err.message}`);
    }
  } catch (err) {
    alert(`清空异常: ${err.message}`);
  }
}

/**
 * 导出 CSV (带 UTF-8 BOM 兼容 Excel)
 */
function exportToCsv() {
  if (allProducts.length === 0) {
    alert("产品库为空，暂无数据可导出！");
    return;
  }

  const headers = ["ASIN", "商品标题", "抓取价格", "采购价 (¥)", "币种", "尺寸 (cm)", "实重 (kg)", "体积重 (kg)", "计费重 (kg)", "空运头程 (元)", "海运头程 (元)", "站点", "商品直达链接", "高清大图链接", "采集时间", "最新更新时间"];
  const rows = allProducts.map((p) => {
    const dim = convertDimensionsToCm(p.dimensions);
    const wtNum = extractWeightKgNumber(p.weight);
    const ship = calculateShippingCosts(dim, p.weight);
    return [
      p.asin || "",
      `"${(p.title || "").replace(/"/g, '""')}"`,
      `"${(p.price || "").replace(/"/g, '""')}"`,
      `"${(p.purchasePrice || "").replace(/"/g, '""')}"`,
      `"${(p.currency || "").replace(/"/g, '""')}"`,
      `"${(dim || "").replace(/"/g, '""')}"`,
      wtNum,
      ship ? ship.volWeight : "",
      ship ? ship.chargeableWeight : "",
      ship ? ship.airCost : "",
      ship ? ship.seaCost : "",
      p.site || "",
      p.url || "",
      p.imageUrl || "",
      p.collectedAt || "",
      p.updatedAt || ""
    ];
  });

  const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");

  downloadFile(csvContent, "text/csv;charset=utf-8;", `Amazon_Vault_${formatDateStr()}.csv`);
  showToast(`已成功导出 ${allProducts.length} 条商品至 CSV 文件`);
}

/**
 * 备份全量数据为 JSON 文件
 */
function exportToJson() {
  if (allProducts.length === 0) {
    alert("产品库为空，暂无可备份数据！");
    return;
  }

  const jsonStr = JSON.stringify(allProducts, null, 2);
  downloadFile(jsonStr, "application/json;charset=utf-8;", `Amazon_Vault_Backup_${formatDateStr()}.json`);
  showToast("已成功备份产品库 JSON 文件");
}

/**
 * 导入 JSON 备份恢复
 */
function handleImportJson(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) {
        throw new Error("文件格式错误，必须为商品数组结构");
      }

      // 简单校验字段
      let validCount = 0;
      data.forEach((item) => {
        if (item && item.asin) {
          const idx = allProducts.findIndex((p) => p.asin === item.asin);
          if (idx > -1) {
            allProducts[idx] = { ...allProducts[idx], ...item };
          } else {
            allProducts.push(item);
          }
          validCount++;
        }
      });

      chrome.storage.local.set({ amazon_products: allProducts }, () => {
        showToast(`成功恢复/导入 ${validCount} 件商品数据！`);
        updateSiteFilterOptions();
        updateMetrics();
        renderProducts();
      });
    } catch (err) {
      alert("JSON 导入失败: " + err.message);
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

/**
 * 触发通用文件下载
 */
function downloadFile(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 复制文本至剪贴板
 */
function copyToClipboard(text, tip) {
  if (!navigator.clipboard) {
    showToast("浏览器不支持自动复制，请手动复制");
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    showToast(tip || "已复制到剪贴板");
  }).catch(() => {
    showToast("复制失败，请手动选择复制");
  });
}

/**
 * 格式化当前日期为 YYYYMMDD
 */
function formatDateStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/**
 * 弹出轻量 Toast
 */
let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById("dashToast");
  toast.textContent = message;
  toast.classList.add("show");

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
}

/**
 * HTML 转义防 XSS
 */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ==========================================================
 * GitHub 云端同步与 Pages 部署核心交互逻辑
 * ========================================================== */

let currentGithubConfig = {
  owner: "lixun58555855-prog",
  repo: "amazon-product-vault",
  branch: "main",
  token: ""
};

/**
 * 打开 GitHub 配置弹窗
 */
function openGithubModal() {
  document.getElementById("githubModal").style.display = "flex";
  loadGithubConfig();
}

/**
 * 关闭 GitHub 配置弹窗
 */
function closeGithubModal() {
  document.getElementById("githubModal").style.display = "none";
}

/**
 * 打开高清商品大图预览灯箱 (Lightbox)
 */
function openImageLightbox(imgUrl, title, asin) {
  const modal = document.getElementById("imageLightboxModal");
  const imgEl = document.getElementById("lightboxImage");
  const titleEl = document.getElementById("lightboxTitle");
  const asinEl = document.getElementById("lightboxAsin");
  const origLink = document.getElementById("lightboxOrigLink");

  if (!modal || !imgEl) return;

  const validUrl = imgUrl && imgUrl !== "icons/icon48.png" ? imgUrl : "icons/icon48.png";
  imgEl.src = validUrl;
  imgEl.alt = title || "商品高清大图";

  if (titleEl) {
    titleEl.textContent = title || "未命名商品";
    titleEl.title = title || "";
  }
  if (asinEl) {
    asinEl.textContent = asin || "";
    asinEl.style.display = asin ? "inline-block" : "none";
  }
  if (origLink) {
    origLink.href = validUrl;
  }

  modal.style.display = "flex";
  modal.classList.add("active");
  document.body.style.overflow = "hidden";
}

/**
 * 关闭高清商品大图预览灯箱
 */
function closeImageLightbox() {
  const modal = document.getElementById("imageLightboxModal");
  if (!modal) return;
  modal.classList.remove("active");
  modal.style.display = "none";
  const imgEl = document.getElementById("lightboxImage");
  if (imgEl) imgEl.src = "";
  document.body.style.overflow = "";
}

/**
 * 切换 Token 明文/密文显示
 */
function toggleTokenVisibility() {
  const tokenInput = document.getElementById("ghToken");
  const btn = document.getElementById("btnToggleToken");
  if (tokenInput.type === "password") {
    tokenInput.type = "text";
    btn.textContent = "🙈";
  } else {
    tokenInput.type = "password";
    btn.textContent = "👁️";
  }
}

/**
 * 加载已保存的 GitHub 配置
 */
function loadGithubConfig() {
  // 自动从当前 GitHub Pages 网址推导 owner 和 repo
  if (window.location.hostname.endsWith(".github.io")) {
    const parts = window.location.hostname.split(".");
    currentGithubConfig.owner = parts[0];
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    if (pathParts.length > 0) {
      currentGithubConfig.repo = pathParts[0];
    }
  }

  // 检查 URL 中是否有授权 token 参数 (例如访问网址带有 #token=ghp_xxx)
  if (window.location.hash.startsWith("#token=")) {
    const paramToken = window.location.hash.replace("#token=", "").trim();
    if (paramToken) {
      currentGithubConfig.token = paramToken;
      localStorage.setItem("az_github_config", JSON.stringify(currentGithubConfig));
      try {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      } catch (e) {}
      setTimeout(() => showToast("✓ 已自动激活 GitHub 云端管理删除权限！"), 600);
    }
  }

  const readConfig = (cfg) => {
    if (cfg) {
      currentGithubConfig = { ...currentGithubConfig, ...cfg };
      document.getElementById("ghOwner").value = currentGithubConfig.owner || "";
      document.getElementById("ghRepo").value = currentGithubConfig.repo || "";
      document.getElementById("ghBranch").value = currentGithubConfig.branch || "main";
      document.getElementById("ghToken").value = currentGithubConfig.token || "";
      const autoSyncEl = document.getElementById("ghAutoSync");
      if (autoSyncEl) {
        autoSyncEl.checked = currentGithubConfig.autoSync !== false;
      }

      updatePagesUrlDisplay();
    }
  };

  const tryLocalFallback = () => {
    fetch("config.local.json")
      .then((r) => r.json())
      .then((localCfg) => {
        readConfig(localCfg);
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ az_github_config: localCfg }, () => {
            console.log("[Dashboard] 自动持久化本地专属配置成功");
          });
        }
      })
      .catch(() => {});
  };

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["az_github_config"], (res) => {
      if (res.az_github_config && res.az_github_config.token) {
        readConfig(res.az_github_config);
      } else {
        tryLocalFallback();
      }
    });
  } else {
    try {
      const saved = JSON.parse(localStorage.getItem("az_github_config") || "{}");
      if (saved && saved.token) {
        readConfig(saved);
      } else {
        tryLocalFallback();
      }
    } catch (e) {
      tryLocalFallback();
    }
  }
}

/**
 * 更新界面上的 GitHub Pages 在线访问地址
 */
function updatePagesUrlDisplay() {
  const box = document.getElementById("ghPagesUrlBox");
  const link = document.getElementById("ghPagesUrl");
  const owner = currentGithubConfig.owner;
  const repo = currentGithubConfig.repo;

  if (owner && repo) {
    const url = `https://${owner}.github.io/${repo}/`;
    link.href = url;
    link.textContent = url;
    box.style.display = "flex";
  } else {
    box.style.display = "none";
  }
}

/**
 * 保存 GitHub 配置
 */
function saveGithubConfig() {
  const owner = document.getElementById("ghOwner").value.trim();
  const repo = document.getElementById("ghRepo").value.trim();
  const branch = document.getElementById("ghBranch").value.trim() || "main";
  const token = document.getElementById("ghToken").value.trim();
  const autoSyncEl = document.getElementById("ghAutoSync");
  const autoSync = autoSyncEl ? autoSyncEl.checked : true;

  if (!owner || !repo) {
    alert("请填写完整的 GitHub 用户名与仓库名称！");
    return;
  }

  currentGithubConfig = { owner, repo, branch, token, autoSync };

  const onSaved = () => {
    updatePagesUrlDisplay();
    showToast("GitHub 配置已成功保存！");
    closeGithubModal();
  };

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ az_github_config: currentGithubConfig }, onSaved);
  } else {
    localStorage.setItem("az_github_config", JSON.stringify(currentGithubConfig));
    onSaved();
  }
}

/**
 * 测试 GitHub 连接
 */
async function testGithubConnection() {
  const owner = document.getElementById("ghOwner").value.trim();
  const repo = document.getElementById("ghRepo").value.trim();
  const token = document.getElementById("ghToken").value.trim();

  if (!owner || !repo) {
    alert("请先输入 GitHub 用户名和仓库名称！");
    return;
  }

  const testBtn = document.getElementById("btnTestGithub");
  testBtn.disabled = true;
  testBtn.textContent = "连接中...";

  try {
    const headers = {
      "Accept": "application/vnd.github.v3+json"
    };
    if (token) {
      headers["Authorization"] = `token ${token}`;
    }

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (res.ok) {
      const data = await res.json();
      alert(`✅ 仓库连接成功！\n仓库名称: ${data.full_name}\n私有属性: ${data.private ? '私有' : '公开'}\n默认分支: ${data.default_branch}`);
    } else {
      const err = await res.json();
      alert(`❌ 连接失败 (状态码 ${res.status}): ${err.message || '请检查 Token 或仓库名是否正确'}`);
    }
  } catch (err) {
    alert(`❌ 请求异常: ${err.message}`);
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = "🔍 测试连接";
  }
}

/**
 * 将本地商品数据一键同步提交至 GitHub 仓库的 data/products.json
 */
async function handleSyncToGithub() {
  const { owner, repo, branch, token } = currentGithubConfig;

  if (!owner || !repo || !token) {
    showToast("请先点击【⚙️ GitHub 配置】填写 Token 与仓库信息");
    openGithubModal();
    return;
  }

  if (allProducts.length === 0) {
    if (!confirm("当前产品库为空，确定要同步一个空库到云端吗？")) return;
  }

  const syncBtn = document.getElementById("btnSyncToGithub");
  const originText = syncBtn.innerHTML;
  syncBtn.disabled = true;
  syncBtn.innerHTML = "☁️ 同步提交中...";

  try {
    const filePath = "data/products.json";
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

    // 1. 获取现有文件的 sha (如果存在则用于更新，不存在则直接新建)
    let existingSha = null;
    try {
      const checkRes = await fetch(`${apiUrl}?ref=${branch}`, {
        headers: {
          "Accept": "application/vnd.github.v3+json",
          "Authorization": `token ${token}`
        }
      });
      if (checkRes.ok) {
        const fileInfo = await checkRes.json();
        existingSha = fileInfo.sha;
      }
    } catch (checkErr) {
      console.log("未检测到已有文件或无权限:", checkErr);
    }

    // 2. 准备提交内容
    const jsonString = JSON.stringify(allProducts, null, 2);
    const base64Content = utf8ToBase64(jsonString);

    const payload = {
      message: `Update Amazon Products Vault (${allProducts.length} items) - ${formatDateStr()}`,
      content: base64Content,
      branch: branch
    };
    if (existingSha) {
      payload.sha = existingSha;
    }

    // 3. 发起 PUT 提交
    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `token ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (putRes.ok) {
      showToast(`☁️ 成功同步 ${allProducts.length} 件商品至 GitHub 云端！`);
    } else {
      const errorJson = await putRes.json();
      alert(`同步失败 (${putRes.status}): ${errorJson.message}`);
    }
  } catch (err) {
    console.error("同步异常:", err);
    alert(`同步过程发生异常: ${err.message}`);
  } finally {
    syncBtn.disabled = false;
    syncBtn.innerHTML = originText;
  }
}

/**
 * 从 GitHub 云端拉取最新数据并与本地合并
 */
async function handlePullFromGithub() {
  const { owner, repo, branch, token } = currentGithubConfig;

  if (!owner || !repo) {
    showToast("请先在【⚙️ GitHub 配置】中设置仓库信息");
    openGithubModal();
    return;
  }

  const pullBtn = document.getElementById("btnPullFromGithub");
  const originText = pullBtn.innerHTML;
  pullBtn.disabled = true;
  pullBtn.innerHTML = "⬇️ 拉取中...";

  try {
    const filePath = "data/products.json";
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;

    const headers = { "Accept": "application/vnd.github.v3+json" };
    if (token) headers["Authorization"] = `token ${token}`;

    const res = await fetch(apiUrl, { headers });
    if (!res.ok) {
      throw new Error(`无法获取云端数据 (HTTP ${res.status})，请确保仓库中存在 ${filePath}`);
    }

    const data = await res.json();
    const rawContent = base64ToUtf8(data.content.replace(/\s/g, ''));
    const cloudProducts = JSON.parse(rawContent);

    if (!Array.isArray(cloudProducts)) {
      throw new Error("云端数据不是有效的数组格式");
    }

    // 与本地数据合并去重
    let newCount = 0;
    cloudProducts.forEach((item) => {
      if (item && item.asin) {
        const idx = allProducts.findIndex((p) => p.asin === item.asin);
        if (idx > -1) {
          allProducts[idx] = { ...allProducts[idx], ...item };
        } else {
          allProducts.unshift(item);
          newCount++;
        }
      }
    });

    persistProducts(allProducts, () => {
      showToast(`已从云端拉取并同步！新增/更新了 ${newCount} 件商品`);
      updateSiteFilterOptions();
      updateMetrics();
      renderProducts();
    });
  } catch (err) {
    alert(`拉取失败: ${err.message}`);
  } finally {
    pullBtn.disabled = false;
    pullBtn.innerHTML = originText;
  }
}

/**
 * UTF-8 字符串转 Base64 (标准 TextEncoder 实现，绝不报错)
 */
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Base64 转 UTF-8 字符串 (标准 TextDecoder 实现)
 */
function base64ToUtf8(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * 尺寸智能换算：将任意长度单位（英寸/毫米/米）标准化换算为厘米 (cm)
 */
function convertDimensionsToCm(dimStr) {
  if (!dimStr || dimStr === "暂无" || dimStr === "-") return "暂无";

  const numbers = dimStr.match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length === 0) return dimStr;

  const lower = dimStr.toLowerCase();
  let factor = 1;
  let isConverted = false;

  if (/inch|inches|\bin\b|["”]/.test(lower)) {
    factor = 2.54;
    isConverted = true;
  } else if (/mm|毫米/.test(lower)) {
    factor = 0.1;
    isConverted = true;
  } else if (/\bm\b|米/.test(lower) && !/cm|mm/.test(lower)) {
    factor = 100;
    isConverted = true;
  } else if (/cm|厘米/.test(lower)) {
    factor = 1;
    isConverted = true;
  } else if (numbers.length >= 2) {
    const maxNum = Math.max(...numbers.map(Number));
    if (maxNum < 60) {
      factor = 2.54;
      isConverted = true;
    }
  }

  if (isConverted) {
    const convertedNums = numbers.slice(0, 3).map((num) => {
      const val = parseFloat(num) * factor;
      return val < 1 ? Math.round(val * 100) / 100 : Math.round(val * 10) / 10;
    });
    return `${convertedNums.join(" x ")} cm`;
  }

  return dimStr;
}

/**
 * 从尺寸字符串中拆分出长、宽、高三个独立数值 (cm)
 */
function parseDimParts(dimStr) {
  if (!dimStr || dimStr === "暂无" || dimStr === "-") return { l: "", w: "", h: "" };
  const std = convertDimensionsToCm(dimStr);
  const nums = std.replace(/(\d+),(\d+)/g, "$1.$2").match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 3) return { l: "", w: "", h: "" };
  return {
    l: nums[0] || "",
    w: nums[1] || "",
    h: nums[2] || ""
  };
}

/**
 * 提取纯数字重量数值（将任意重量统一换算为 kg 对应纯数字，不含任何字母与单位）
 */
function extractWeightKgNumber(weightStr) {
  if (!weightStr || weightStr === "暂无" || weightStr === "-") return "";
  const std = convertWeightToKg(weightStr);
  if (!std || std === "暂无" || std === "-") return "";
  const match = std.replace(/(\d+),(\d+)/g, "$1.$2").match(/\d+(?:\.\d+)?/);
  return match ? match[0] : "";
}

/**
 * 重量智能换算：将任意重量单位（英镑/盎司/克）标准化换算为千克 (kg)
 */
function convertWeightToKg(weightStr) {
  if (!weightStr || weightStr === "暂无" || weightStr === "-") return "暂无";

  const match = weightStr.match(/(\d+(?:\.\d+)?)/);
  if (!match) return weightStr;

  const num = parseFloat(match[1]);
  if (isNaN(num)) return weightStr;

  const lower = weightStr.toLowerCase();
  let kgVal = num;

  if (/pound|pounds|\blbs?\b|磅/.test(lower)) {
    kgVal = num * 0.45359237;
  } else if (/ounce|ounces|\boz\b|盎司/.test(lower)) {
    kgVal = num * 0.02834952;
  } else if (/kg|kilogram|千克|公斤/.test(lower)) {
    kgVal = num;
  } else if (/grams?|克|(?:\d|\s)g(?:$|[^\w])/.test(lower)) {
    kgVal = num / 1000;
  } else {
    // 默认单位为 kg（后台编辑输入纯数字时，默认即是 kg）
    kgVal = num;
  }

  let formattedKg;
  if (kgVal < 0.1) {
    formattedKg = Math.round(kgVal * 1000) / 1000;
  } else {
    formattedKg = Math.round(kgVal * 100) / 100;
  }

  return `${formattedKg} kg`;
}

/**
 * 头程物流成本计算引擎
 * 规则：
 * 1. 体积重 = 长(cm) * 宽(cm) * 高(cm) / 6000
 * 2. 计费重 = max(体积重, 实重)
 * 3. 空运成本 = 计费重 * 66 元
 * 4. 海运成本 = 计费重 * 15 元
 */
function calculateShippingCosts(dimStr, weightStr, airRate = 66, seaRate = 15) {
  if (!dimStr || !weightStr || dimStr === "暂无" || weightStr === "暂无" || dimStr === "-" || weightStr === "-") {
    return null;
  }

  const stdDim = convertDimensionsToCm(dimStr);
  if (!stdDim || stdDim === "暂无" || stdDim === "-") return null;
  const dimMatches = stdDim.replace(/(\d+),(\d+)/g, "$1.$2").match(/\d+(?:\.\d+)?/g);
  if (!dimMatches || dimMatches.length < 3) {
    return null;
  }

  const [l, w, h] = dimMatches.slice(0, 3).map(Number);
  if (isNaN(l) || isNaN(w) || isNaN(h) || l <= 0 || w <= 0 || h <= 0) {
    return null;
  }

  const volWeight = (l * w * h) / 6000;

  const stdWeight = convertWeightToKg(weightStr);
  if (!stdWeight || stdWeight === "暂无" || stdWeight === "-") return null;
  const wtMatch = stdWeight.replace(/(\d+),(\d+)/g, "$1.$2").match(/\d+(?:\.\d+)?/);
  if (!wtMatch) return null;

  const actualWeight = parseFloat(wtMatch[0]);
  if (isNaN(actualWeight) || actualWeight <= 0) {
    return null;
  }

  const chargeableWeight = Math.max(volWeight, actualWeight);
  const airCost = chargeableWeight * airRate;
  const seaCost = chargeableWeight * seaRate;

  return {
    volWeight: Math.round(volWeight * 100) / 100,
    actualWeight: Math.round(actualWeight * 100) / 100,
    chargeableWeight: Math.round(chargeableWeight * 100) / 100,
    airCost: Math.round(airCost * 100) / 100,
    seaCost: Math.round(seaCost * 100) / 100,
    isVolumetric: volWeight > actualWeight
  };
}

