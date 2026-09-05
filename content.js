/**
 * content.js - 注入亚马逊商品详情页的内容脚本
 * 职责：
 * 1. 监听来自 Service Worker 或 Popup 的采集信号
 * 2. 深度解析亚马逊 DOM 提取商品关键信息（ASIN、标题、高清图、价格、站点等）
 * 3. 将数据去重/更新持久化至 chrome.storage.local
 * 4. 渲染现代轻量级网页 Toast 提示反馈
 */

// 防止多次重复注入执行
if (!window.__AMAZON_COLLECTOR_INITIALIZED__) {
  window.__AMAZON_COLLECTOR_INITIALIZED__ = true;

  // 监听来自后台或 Popup 的采集指令
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "TRIGGER_COLLECT") {
      executeProductCollection().then((result) => {
        sendResponse(result);
      });
      return true; // 异步响应
    }
  });

  console.log("[Amazon Collector] 内容脚本初始化完毕，就绪等待采集");
}

/**
 * 执行数据提取与入库的主函数
 */
async function executeProductCollection() {
  try {
    const product = extractAmazonProductDetails();

    if (!product || !product.asin) {
      showWebToast({
        success: false,
        title: "采集失败",
        message: "未能识别到有效的亚马逊商品 ASIN。请确保当前处于商品详情页！"
      });
      return { success: false, error: "NOT_AN_AMAZON_PRODUCT_PAGE" };
    }

    // 保存至 chrome.storage.local
    const saveResult = await saveProductToStorage(product);

    // 弹出成功或更新的页面 Toast
    showWebToast({
      success: true,
      isUpdate: saveResult.isUpdate,
      title: saveResult.isUpdate ? "已更新商品数据" : "采集成功已入库",
      message: `${product.title.slice(0, 45)}...`,
      price: product.price,
      asin: product.asin,
      imageUrl: product.imageUrl
    });

    return { success: true, product, isUpdate: saveResult.isUpdate };
  } catch (error) {
    console.error("[Amazon Collector] 采集发生异常:", error);
    showWebToast({
      success: false,
      title: "采集出错",
      message: error.message || "解析商品数据时发生未知错误"
    });
    return { success: false, error: error.message };
  }
}

/**
 * 核心：多级容错解析亚马逊页面各字段
 */
function extractAmazonProductDetails() {
  const currentUrl = window.location.href;
  const hostname = window.location.hostname;

  // 1. 提取 ASIN (优先从 URL 中提取，次选隐藏域和页面属性)
  let asin = "";
  const urlAsinMatch = currentUrl.match(/(?:\/dp\/|\/gp\/product\/|\/exec\/obidos\/asin\/|\/product\/)([A-Z0-9]{10})/i);
  if (urlAsinMatch && urlAsinMatch[1]) {
    asin = urlAsinMatch[1].toUpperCase();
  } else {
    // 从 DOM 隐藏表单域获取
    const asinInput = document.querySelector('input#ASIN, input[name="ASIN"], input[name="asin"]');
    if (asinInput && asinInput.value && asinInput.value.trim().length === 10) {
      asin = asinInput.value.trim().toUpperCase();
    } else {
      // 检查页面上所有带 data-asin 的关键容器
      const asinEl = document.querySelector('[data-asin]:not([data-asin=""])');
      if (asinEl && asinEl.getAttribute('data-asin').trim().length === 10) {
        asin = asinEl.getAttribute('data-asin').trim().toUpperCase();
      }
    }
  }

  // 若没有 ASIN，说明非单品详情页
  if (!asin) {
    return null;
  }

  // 2. 提取商品标题 (多级选择器降级)
  let title = "";
  const titleSelectors = [
    '#productTitle',
    '#title',
    '#ebooksProductTitle',
    '#item_name',
    'h1.a-size-large',
    'h1.product-title-word-break'
  ];
  for (const selector of titleSelectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent) {
      title = el.textContent.trim().replace(/\s+/g, ' ');
      if (title.length > 0) break;
    }
  }
  if (!title) {
    const ogTitle = document.querySelector('meta[property="og:title"]');
    title = ogTitle ? ogTitle.getAttribute('content') || "" : document.title;
  }

  // 3. 提取高清主图 (优先大图属性与动态图片 JSON，防模糊缩略图)
  let imageUrl = "";
  const landingImg = document.querySelector('#landingImage, #imgTagWrapperId img, #main-image, #ebooks-landing-image, #imgBlkFront');
  if (landingImg) {
    // (1) 优先尝试 data-old-hires 属性
    const oldHires = landingImg.getAttribute('data-old-hires');
    if (oldHires && oldHires.trim().startsWith('http')) {
      imageUrl = oldHires.trim();
    }

    // (2) 尝试解析 data-a-dynamic-image 中的最大分辨率图片
    if (!imageUrl) {
      const dynamicImgJson = landingImg.getAttribute('data-a-dynamic-image');
      if (dynamicImgJson) {
        try {
          const imgMap = JSON.parse(dynamicImgJson);
          let maxResolution = 0;
          let bestUrl = "";
          for (const [url, dimensions] of Object.entries(imgMap)) {
            if (Array.isArray(dimensions) && dimensions.length === 2) {
              const res = dimensions[0] * dimensions[1];
              if (res > maxResolution) {
                maxResolution = res;
                bestUrl = url;
              }
            }
          }
          if (bestUrl) imageUrl = bestUrl;
        } catch (e) {
          console.warn("[Amazon Collector] 解析 data-a-dynamic-image 失败:", e);
        }
      }
    }

    // (3) 降级使用 src
    if (!imageUrl) {
      imageUrl = landingImg.src || landingImg.getAttribute('src') || "";
    }
  }

  // (4) 兜底 open graph 图
  if (!imageUrl) {
    const ogImg = document.querySelector('meta[property="og:image"]');
    if (ogImg) imageUrl = ogImg.getAttribute('content') || "";
  }

  // 4. 提取当前价格 (多选择器防爬与动态渲染适配)
  let price = "";
  const priceSelectors = [
    '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
    '#corePrice_feature_div .a-price .a-offscreen',
    '.apexPriceToPay .a-offscreen',
    '.a-price .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '#price_inside_buybox',
    '#price',
    '#newBuyBoxPrice',
    '#kindle-price',
    '.kindle-price span'
  ];

  for (const selector of priceSelectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent) {
      const text = el.textContent.trim();
      // 简单判断是否包含数字
      if (/\d/.test(text)) {
        price = text;
        break;
      }
    }
  }

  // 若仍未获取到，尝试拼凑 .a-price-whole 与 .a-price-fraction
  if (!price) {
    const whole = document.querySelector('.a-price-whole');
    const symbol = document.querySelector('.a-price-symbol');
    const fraction = document.querySelector('.a-price-fraction');
    if (whole) {
      price = `${symbol ? symbol.textContent.trim() : ''}${whole.textContent.trim()}${fraction ? '.' + fraction.textContent.trim() : ''}`;
    }
  }

  if (!price) {
    price = "暂无标价 / 需登录或缺货";
  }

  // 5. 提取币种与站点
  const site = hostname.replace(/^www\./i, '');
  const currency = extractCurrency(price, site);

  // 规范化无污染的商品直达短链接
  const cleanUrl = `https://${hostname}/dp/${asin}`;

  const now = new Date();
  const formatTime = now.toLocaleString('zh-CN', { hour12: false });

  return {
    asin,
    title,
    imageUrl,
    price,
    currency,
    site,
    url: cleanUrl,
    collectedAt: formatTime,
    collectedTimestamp: now.getTime()
  };
}

/**
 * 辅助：根据价格文本或站点推测货币符号
 */
function extractCurrency(priceStr, site) {
  if (priceStr.includes('$')) return '$ (USD/CAD/AUD)';
  if (priceStr.includes('£')) return '£ (GBP)';
  if (priceStr.includes('€')) return '€ (EUR)';
  if (priceStr.includes('￥') || priceStr.includes('¥')) return '¥ (JPY/CNY)';
  if (priceStr.includes('₹')) return '₹ (INR)';
  if (priceStr.includes('AED')) return 'AED';
  if (priceStr.includes('SAR')) return 'SAR';

  if (site.endsWith('.co.uk')) return 'GBP';
  if (site.endsWith('.de') || site.endsWith('.fr') || site.endsWith('.it') || site.endsWith('.es')) return 'EUR';
  if (site.endsWith('.co.jp')) return 'JPY';
  if (site.endsWith('.ca')) return 'CAD';
  if (site.endsWith('.com.au')) return 'AUD';
  if (site.endsWith('.in')) return 'INR';
  return 'USD';
}

/**
 * 数据写入 chrome.storage.local（支持去重与价格更新）
 */
function saveProductToStorage(product) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['amazon_products'], (res) => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }

      let list = res.amazon_products || [];
      const existingIndex = list.findIndex(item => item.asin === product.asin);
      let isUpdate = false;

      if (existingIndex > -1) {
        // 已存在：更新价格、站点、最新图片与更新时间，保留历史首次采集时间
        isUpdate = true;
        const oldItem = list[existingIndex];
        list[existingIndex] = {
          ...oldItem,
          price: product.price,
          imageUrl: product.imageUrl || oldItem.imageUrl,
          title: product.title || oldItem.title,
          site: product.site,
          updatedAt: product.collectedAt,
          updatedTimestamp: product.collectedTimestamp
        };
        // 将更新后的商品移到最前面，方便查看
        const [updatedItem] = list.splice(existingIndex, 1);
        list.unshift(updatedItem);
      } else {
        // 不存在：追加到最前面
        list.unshift(product);
      }

      chrome.storage.local.set({ amazon_products: list }, () => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve({ isUpdate, totalCount: list.length });
      });
    });
  });
}

/**
 * 网页原生浮动 Toast 弹窗反馈组件
 */
function showWebToast({ success, isUpdate, title, message, price, asin, imageUrl }) {
  // 清理已有浮窗
  const oldToast = document.getElementById('__az_collector_toast_container__');
  if (oldToast) oldToast.remove();

  const container = document.createElement('div');
  container.id = '__az_collector_toast_container__';

  const themeColor = success ? (isUpdate ? '#f59e0b' : '#10b981') : '#ef4444';
  const badgeText = isUpdate ? '数据已更新' : (success ? '新商品入库' : '提示');

  container.innerHTML = `
    <style>
      #__az_collector_toast_container__ {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
        background: #1e293b;
        color: #ffffff;
        border-radius: 12px;
        padding: 14px 16px;
        min-width: 320px;
        max-width: 400px;
        border-left: 5px solid ${themeColor};
        display: flex;
        align-items: center;
        gap: 12px;
        box-sizing: border-box;
        animation: azToastSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        pointer-events: auto;
      }
      #__az_collector_toast_container__.az-closing {
        animation: azToastSlideOut 0.28s ease-in forwards;
      }
      @keyframes azToastSlideIn {
        from { transform: translateX(110%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes azToastSlideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(110%); opacity: 0; }
      }
      .az-toast-img {
        width: 48px;
        height: 48px;
        border-radius: 6px;
        object-fit: contain;
        background: #ffffff;
        flex-shrink: 0;
        border: 1px solid #334155;
      }
      .az-toast-content {
        flex: 1;
        min-width: 0;
      }
      .az-toast-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 3px;
      }
      .az-toast-title {
        font-size: 14px;
        font-weight: 600;
        color: #f8fafc;
      }
      .az-toast-badge {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 4px;
        background: ${themeColor}25;
        color: ${themeColor};
        font-weight: 600;
        border: 1px solid ${themeColor}60;
      }
      .az-toast-desc {
        font-size: 12px;
        color: #94a3b8;
        line-height: 1.35;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .az-toast-meta {
        font-size: 12px;
        color: #e2e8f0;
        margin-top: 4px;
        display: flex;
        justify-content: space-between;
      }
      .az-toast-price {
        color: #38bdf8;
        font-weight: 600;
      }
      .az-toast-close {
        cursor: pointer;
        color: #64748b;
        font-size: 16px;
        line-height: 1;
        padding: 4px;
        margin-left: 4px;
        transition: color 0.15s;
      }
      .az-toast-close:hover {
        color: #f1f5f9;
      }
    </style>
    ${imageUrl ? `<img src="${imageUrl}" class="az-toast-img" alt="Product" />` : ''}
    <div class="az-toast-content">
      <div class="az-toast-header">
        <span class="az-toast-title">${title}</span>
        <span class="az-toast-badge">${badgeText}</span>
      </div>
      <div class="az-toast-desc" title="${message}">${message}</div>
      ${price ? `
        <div class="az-toast-meta">
          <span>ASIN: ${asin}</span>
          <span class="az-toast-price">${price}</span>
        </div>
      ` : ''}
    </div>
    <div class="az-toast-close" title="关闭">✕</div>
  `;

  document.body.appendChild(container);

  const closeBtn = container.querySelector('.az-toast-close');
  const dismissToast = () => {
    container.classList.add('az-closing');
    setTimeout(() => container.remove(), 280);
  };

  if (closeBtn) closeBtn.onclick = dismissToast;

  // 3.8秒后自动淡出关闭
  setTimeout(() => {
    if (document.body.contains(container)) {
      dismissToast();
    }
  }, 3800);
}
