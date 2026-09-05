/**
 * popup.js - 弹窗用户交互脚本
 * 职责：
 * 1. 从 chrome.storage.local 加载并展示已保存的商品列表
 * 2. 支持当前页快捷一键采集与即时反馈
 * 3. 关键词过滤搜索与快速清除
 * 4. 单项删除、全部清空与导出 CSV
 * 5. 打开全屏管理面板 Dashboard
 */

let allProducts = [];
let currentFilterText = "";

document.addEventListener("DOMContentLoaded", () => {
  initUI();
  loadProducts();
  checkCurrentTab();
});

/**
 * 初始化界面事件绑定
 */
function initUI() {
  // 打开全屏管理面板
  document.getElementById("btnOpenDashboard").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "OPEN_DASHBOARD" });
  });

  // 快速同步 GitHub
  document.getElementById("btnQuickSyncGithub").addEventListener("click", handleQuickSyncGithub);

  // 一键采集当前页面
  document.getElementById("btnCollectCurrentPage").addEventListener("click", handleCollectCurrentPage);

  // 搜索过滤
  const searchInput = document.getElementById("searchInput");
  const clearSearchBtn = document.getElementById("btnClearSearch");

  searchInput.addEventListener("input", (e) => {
    currentFilterText = e.target.value.trim().toLowerCase();
    clearSearchBtn.style.display = currentFilterText ? "block" : "none";
    renderProducts();
  });

  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    currentFilterText = "";
    clearSearchBtn.style.display = "none";
    renderProducts();
  });

  // 导出 CSV
  document.getElementById("btnExportCsv").addEventListener("click", exportProductsToCsv);

  // 清空全部
  document.getElementById("btnClearAll").addEventListener("click", handleClearAll);

  // 监听 storage 变更（例如在其他标签页采集后，popup 打开状态下能实时同步）
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.amazon_products) {
      allProducts = changes.amazon_products.newValue || [];
      renderProducts();
    }
  });
}

/**
 * 检查当前标签页是否在亚马逊网站，给予视觉提示
 */
async function checkCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const btn = document.getElementById("btnCollectCurrentPage");
  const statusEl = document.getElementById("collectStatus");

  if (!tab || !tab.url || !tab.url.includes("amazon.")) {
    statusEl.textContent = "提示: 当前标签页非亚马逊页面";
    statusEl.className = "collect-status warn";
    btn.title = "请在亚马逊商品页面使用一键采集";
  } else {
    statusEl.textContent = "";
  }
}

/**
 * 从本地存储加载商品
 */
function loadProducts() {
  chrome.storage.local.get(["amazon_products"], (result) => {
    allProducts = result.amazon_products || [];
    renderProducts();
  });
}

/**
 * 渲染商品卡片列表
 */
function renderProducts() {
  const listContainer = document.getElementById("productList");
  const emptyState = document.getElementById("emptyState");
  const countText = document.getElementById("productCountText");

  // 核心：插件本地视窗仅展示最新的 3 条
  const displayList = filtered.slice(0, 3);

  countText.textContent = `最近采集 (展示最新 ${displayList.length} 条) • 本地共 ${allProducts.length} 件`;

  if (displayList.length === 0) {
    listContainer.innerHTML = "";
    emptyState.style.display = "flex";
    if (currentFilterText) {
      emptyState.querySelector(".empty-title").textContent = "未找到匹配商品";
      emptyState.querySelector(".empty-desc").textContent = `没有与 "${currentFilterText}" 相关的商品`;
    } else {
      emptyState.querySelector(".empty-title").textContent = "本地暂无最近采集";
      emptyState.querySelector(".empty-desc").innerHTML = "在任意亚马逊商品页点击右键<br>选择“<b>添加到本地产品库</b>”自动同步至云端";
    }
    return;
  }

  emptyState.style.display = "none";

  let html = "";
  displayList.forEach((item) => {
    const defaultImg = "icons/icon48.png";
    const displayImg = item.imageUrl || defaultImg;
    const displayTime = item.updatedAt ? `${item.updatedAt} (更新)` : (item.collectedAt || "未知时间");
    const shipping = calculateShippingCosts(item.dimensions, item.weight);

    html += `
      <div class="product-card" data-asin="${item.asin}">
        <div class="card-thumb-wrap">
          <img src="${displayImg}" class="card-thumb" alt="Product" onerror="this.src='${defaultImg}'" />
        </div>
        <div class="card-body">
          <a href="${item.url}" target="_blank" class="card-title" title="${escapeHtml(item.title)}">
            ${escapeHtml(item.title || "无标题商品")}
          </a>
          <div class="card-meta-row">
            <span class="card-price">${escapeHtml(item.price || "未标价")}</span>
            <div class="card-tags">
              <span class="tag-badge tag-site">${escapeHtml(item.site || "Amazon")}</span>
              <span class="tag-badge">ASIN: ${escapeHtml(item.asin)}</span>
            </div>
          </div>
          <div class="card-specs-row" style="font-size:11px;color:#94a3b8;margin:2px 0 4px 0;display:flex;gap:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            <span title="尺寸: ${escapeHtml(convertDimensionsToCm(item.dimensions))}${item.rawDimensions ? ` (原始: ${escapeHtml(item.rawDimensions)})` : ''}">📏 ${escapeHtml(convertDimensionsToCm(item.dimensions))}</span>
            <span title="重量: ${escapeHtml(convertWeightToKg(item.weight))}${item.rawWeight ? ` (原始: ${escapeHtml(item.rawWeight)})` : ''}">⚖️ ${escapeHtml(convertWeightToKg(item.weight))}</span>
          </div>
          ${shipping ? `
            <div class="card-shipping-row" style="font-size:11px;background:rgba(15,23,42,0.6);border:1px solid #334155;border-radius:6px;padding:3px 6px;margin:2px 0 4px 0;display:flex;justify-content:space-between;align-items:center;">
              <span>✈️ 空: <strong style="color:#38bdf8;">¥${shipping.airCost}</strong></span>
              <span>🚢 海: <strong style="color:#10b981;">¥${shipping.seaCost}</strong></span>
              <span style="color:#94a3b8;font-size:10px;">计重: ${shipping.chargeableWeight}kg</span>
            </div>
          ` : ''}
          <div class="card-footer-row">
            <span>${displayTime}</span>
            <button class="btn-card-delete" data-asin="${item.asin}" title="仅从本地插件视窗移除（云端不受任何影响）">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  });

  listContainer.innerHTML = html;

  // 绑定卡片内删除按钮事件
  listContainer.querySelectorAll(".btn-card-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const asin = btn.getAttribute("data-asin");
      deleteSingleProduct(asin);
    });
  });
}

/**
 * 触发当前页面采集
 */
async function handleCollectCurrentPage() {
  const statusEl = document.getElementById("collectStatus");
  const collectBtn = document.getElementById("btnCollectCurrentPage");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !tab.url) {
    showStatus("未能获取当前标签页", "error");
    return;
  }

  if (!tab.url.includes("amazon.")) {
    showStatus("请在亚马逊商品详情页点击此按钮", "warn");
    return;
  }

  collectBtn.disabled = true;
  showStatus("正在解析当前页面商品数据...", "warn");

  try {
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: "TRIGGER_COLLECT" });
    } catch (msgErr) {
      // 动态注入脚本兜底
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      response = await chrome.tabs.sendMessage(tab.id, { action: "TRIGGER_COLLECT" });
    }

    if (response && response.success) {
      showStatus(response.isUpdate ? "✓ 商品价格已同步更新！" : "✓ 采集成功！已加入产品库", "success");
      loadProducts();
    } else {
      showStatus(`采集失败: ${response?.error || "未在页面中找到商品信息"}`, "error");
    }
  } catch (err) {
    console.error("采集通信失败:", err);
    showStatus("采集失败，请刷新商品页面后重试", "error");
  } finally {
    collectBtn.disabled = false;
  }
}

/**
 * 展示采集状态提示
 */
function showStatus(text, type) {
  const statusEl = document.getElementById("collectStatus");
  statusEl.textContent = text;
  statusEl.className = `collect-status ${type}`;
}

/**
 * 单项删除（仅从插件本地视窗移除，绝不删除云端）
 */
function deleteSingleProduct(asin) {
  allProducts = allProducts.filter((item) => item.asin !== asin);
  chrome.storage.local.set({ amazon_products: allProducts }, () => {
    renderProducts();
    showStatus("已从插件移除（云端不受任何影响）", "warn");
  });
}

/**
 * 清空插件本地视窗
 */
function handleClearAll() {
  if (allProducts.length === 0) return;
  if (confirm(`确定要清空插件本地显示的商品吗？\n\n【注意】此操作仅清理插件本地视图，云端 GitHub 上的所有数据完好无损，不受任何影响！`)) {
    chrome.storage.local.set({ amazon_products: [] }, () => {
      allProducts = [];
      renderProducts();
      showStatus("已清空插件本地视窗（云端数据完好）", "warn");
    });
  }
}

/**
 * 导出 CSV (带 UTF-8 BOM 兼容 Excel)
 */
function exportProductsToCsv() {
  if (allProducts.length === 0) {
    alert("当前产品库为空，暂无数据可导出！");
    return;
  }

  const headers = ["ASIN", "商品标题", "售价", "币种", "尺寸 (cm)", "实重 (kg)", "体积重 (kg)", "计费重 (kg)", "空运头程 (元)", "海运头程 (元)", "站点", "商品链接", "主图链接", "采集时间", "更新时间"];
  const rows = allProducts.map((p) => {
    const dim = convertDimensionsToCm(p.dimensions);
    const wt = convertWeightToKg(p.weight);
    const ship = calculateShippingCosts(dim, wt);
    return [
      p.asin || "",
      `"${(p.title || "").replace(/"/g, '""')}"`,
      `"${(p.price || "").replace(/"/g, '""')}"`,
      `"${(p.currency || "").replace(/"/g, '""')}"`,
      `"${(dim || "").replace(/"/g, '""')}"`,
      `"${(wt || "").replace(/"/g, '""')}"`,
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

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `Amazon_Products_${dateStr}.csv`;

  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 转义 HTML 字符防 XSS
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

/**
 * 快捷一键同步至 GitHub 云端
 */
async function handleQuickSyncGithub() {
  const syncBtn = document.getElementById("btnQuickSyncGithub");
  const originHtml = syncBtn.innerHTML;

  chrome.storage.local.get(["az_github_config"], async (res) => {
    const config = res.az_github_config || {
      owner: "lixun58555855-prog",
      repo: "amazon-product-vault",
      branch: "main",
      token: ""
    };
    if (!config || !config.owner || !config.repo || !config.token) {
      alert("请先点击【全屏面板】右上角的【⚙️ GitHub 配置】填写仓库与访问令牌！");
      chrome.runtime.sendMessage({ action: "OPEN_DASHBOARD" });
      return;
    }

    syncBtn.disabled = true;
    showStatus("正在同步至 GitHub 云端...", "warn");

    try {
      const { owner, repo, branch = "main", token } = config;
      const filePath = "data/products.json";
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

      // 获取已有 sha
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
      } catch (e) {}

      // 准备提交 (标准 TextEncoder 编码)
      const jsonString = JSON.stringify(allProducts, null, 2);
      const bytes = new TextEncoder().encode(jsonString);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Content = btoa(binary);

      const payload = {
        message: `Sync Amazon Products (${allProducts.length} items) via Extension`,
        content: base64Content,
        branch: branch
      };
      if (existingSha) payload.sha = existingSha;

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
        showStatus(`✓ 已成功同步 ${allProducts.length} 件商品到云端！`, "success");
      } else {
        const errJson = await putRes.json();
        showStatus(`同步失败: ${errJson.message}`, "error");
      }
    } catch (err) {
      showStatus(`同步出错: ${err.message}`, "error");
    } finally {
      syncBtn.disabled = false;
      syncBtn.innerHTML = originHtml;
    }
  });
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
  } else if (/(\bg\b|grams?|克)/.test(lower) && !/kg|kilogram|千克|公斤/.test(lower)) {
    kgVal = num / 1000;
  } else if (/kg|kilogram|千克|公斤/.test(lower)) {
    kgVal = num;
  } else {
    kgVal = num * 0.45359237;
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
