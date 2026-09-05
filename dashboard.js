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

let allProducts = [];
let currentViewMode = localStorage.getItem("az_vault_view_mode") || "grid"; // 'grid' or 'table'

document.addEventListener("DOMContentLoaded", () => {
  initUI();
  loadProducts();
});

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
  document.getElementById("statTotalCount").textContent = allProducts.length;

  const sites = new Set(allProducts.map((p) => p.site).filter(Boolean));
  document.getElementById("statSiteCount").textContent = sites.size;

  if (sites.size > 0) {
    document.getElementById("statSiteList").textContent = Array.from(sites).slice(0, 3).join(", ") + (sites.size > 3 ? "..." : "");
  } else {
    document.getElementById("statSiteList").textContent = "暂无站点";
  }

  if (allProducts.length > 0) {
    const latest = allProducts[0];
    document.getElementById("statLatestTime").textContent = latest.updatedAt || latest.collectedAt || "-";
  } else {
    document.getElementById("statLatestTime").textContent = "-";
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

    // Grid Card HTML
    gridHtml += `
      <div class="grid-card" data-asin="${item.asin}">
        <div class="card-image-wrap">
          <span class="card-badge-site">${escapeHtml(item.site || "Amazon")}</span>
          <img src="${displayImg}" class="card-image" alt="Product" onerror="this.src='${defaultImg}'" loading="lazy" />
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

    // Table Row HTML
    tableHtml += `
      <tr data-asin="${item.asin}">
        <td>
          <img src="${displayImg}" class="table-thumb" alt="Product" onerror="this.src='${defaultImg}'" />
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
        <td>
          <span class="table-price">${escapeHtml(item.price || "未标价")}</span>
        </td>
        <td>
          <span class="tag-site-pill">${escapeHtml(item.site || "Amazon")}</span>
        </td>
        <td>
          <span class="table-time">${displayTime}</span>
        </td>
        <td>
          <div class="table-actions">
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

  const headers = ["ASIN", "商品标题", "售价", "币种", "站点", "商品直达链接", "高清大图链接", "采集时间", "最新更新时间"];
  const rows = allProducts.map((p) => [
    p.asin || "",
    `"${(p.title || "").replace(/"/g, '""')}"`,
    `"${(p.price || "").replace(/"/g, '""')}"`,
    `"${(p.currency || "").replace(/"/g, '""')}"`,
    p.site || "",
    p.url || "",
    p.imageUrl || "",
    p.collectedAt || "",
    p.updatedAt || ""
  ]);

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

