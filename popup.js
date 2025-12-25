let allProductLinks = [];
let currentPage = 0;
let totalPages = 1;
let maxProductsPerPage = 10;
let logs = [];

// Load saved logs and results on startup
chrome.storage.local.get(['logs', 'lastParseResult'], (result) => {
  if (result.logs) {
    logs = result.logs;
    updateLogsDisplay();
  }
  if (result.lastParseResult && Array.isArray(result.lastParseResult) && result.lastParseResult.length > 0) {
    // Handle pending parse results
    sendToTelegram({ products: result.lastParseResult });
    // Clear the stored result
    chrome.storage.local.remove(['lastParseResult']);
  }
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.logs) {
      logs = changes.logs.newValue || [];
      updateLogsDisplay();
    }
    if (changes.lastParseResult && changes.lastParseResult.newValue) {
      // New parse results available
      const results = changes.lastParseResult.newValue;
      if (results && Array.isArray(results) && results.length > 0) {
        sendToTelegram({ products: results });
        // Clear the stored result
        chrome.storage.local.remove(['lastParseResult']);
      } else {
        log('Invalid parse results received', 'error');
      }
    }
  }
});

// Save logs whenever they change
function saveLogs() {
  chrome.storage.local.set({ logs: logs });
}

// Tab switching
document.querySelectorAll('.tab-button').forEach(button => {
  button.addEventListener('click', () => {
    const tabName = button.dataset.tab;
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    button.classList.add('active');
    document.getElementById(tabName + '-tab').classList.add('active');
  });
});

// Toggle auto-monitor settings
document.getElementById('autoMonitor').addEventListener('change', (e) => {
  const monitorSettings = document.getElementById('monitorSettings');
  const startButton = document.getElementById('startMonitorButton');
  const stopButton = document.getElementById('stopMonitorButton');

  if (e.target.checked) {
    monitorSettings.style.display = 'block';
    startButton.style.display = 'block';
    stopButton.style.display = 'none';
  } else {
    monitorSettings.style.display = 'none';
    startButton.style.display = 'none';
    stopButton.style.display = 'none';
  }
});

// Start monitoring
document.getElementById('startMonitorButton').addEventListener('click', async () => {
  const interval = parseInt(document.getElementById('monitorInterval').value) || 15;
  const maxPrice = parseInt(document.getElementById('maxPrice').value) || 50000;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes('wildberries.ru') || !tab.url.includes('/catalog/')) {
    alert('Please open a Wildberries catalog page first');
    return;
  }

  // Save monitoring settings
  chrome.storage.local.set({
    monitoringEnabled: true,
    monitorUrl: tab.url,
    monitorInterval: interval,
    maxPrice: maxPrice,
    sentLinks: [] // Reset sent links for new monitoring session
  });

  // Start monitoring
  chrome.runtime.sendMessage({
    action: 'start_monitoring',
    url: tab.url,
    interval: interval,
    maxPrice: maxPrice
  });

  document.getElementById('startMonitorButton').style.display = 'none';
  document.getElementById('stopMonitorButton').style.display = 'block';
  document.getElementById('testMonitorButton').style.display = 'block';
  log(`Auto-monitoring started (max price: ${maxPrice}₽)`);
});

// Stop monitoring
document.getElementById('stopMonitorButton').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'stop_monitoring' });
  chrome.storage.local.set({ monitoringEnabled: false });

  document.getElementById('startMonitorButton').style.display = 'block';
  document.getElementById('stopMonitorButton').style.display = 'none';
  document.getElementById('testMonitorButton').style.display = 'none';
  log('Auto-monitoring stopped');
});

// Test monitoring
document.getElementById('testMonitorButton').addEventListener('click', () => {
  log('Testing monitoring - clearing sent links and checking for new products');

  // Clear sent links to simulate all products being new
  chrome.storage.local.set({ sentLinks: [] }, () => {
    // Run monitoring check
    chrome.runtime.sendMessage({ action: 'test_monitoring' });
  });
});

// Load monitoring status on startup
chrome.storage.local.get(['monitoringEnabled'], (result) => {
  if (result.monitoringEnabled) {
    document.getElementById('autoMonitor').checked = true;
    document.getElementById('monitorSettings').style.display = 'block';
    document.getElementById('startMonitorButton').style.display = 'none';
    document.getElementById('stopMonitorButton').style.display = 'block';
    document.getElementById('testMonitorButton').style.display = 'block';
  }
});

// Clear logs
document.getElementById('clearLogsButton').addEventListener('click', () => {
  logs = [];
  updateLogsDisplay();
});

function log(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const entry = `[${timestamp}] ${message}`;
  logs.push({ message: entry, type });
  console.log(`[${type.toUpperCase()}] ${message}`);
  updateLogsDisplay();
  saveLogs();
}

function updateLogsDisplay() {
  const logsDiv = document.getElementById('logs');
  logsDiv.innerHTML = logs.map(entry => `<div class="log-entry log-${entry.type}">${entry.message}</div>`).join('');
  logsDiv.scrollTop = logsDiv.scrollHeight;
}

document.getElementById('parseButton').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  const progressBar = document.querySelector('.progress-bar');
  const progressFill = document.getElementById('progressFill');
  const button = document.getElementById('parseButton');

  // Get settings
  totalPages = parseInt(document.getElementById('pagesCount').value) || 1;
  maxProductsPerPage = parseInt(document.getElementById('maxProducts').value) || 10;

  log(`Settings: pages=${totalPages}, max_products_per_page=${maxProductsPerPage}`);

  // Reset
  allProductLinks = [];
  currentPage = 0;
  button.disabled = true;
  progressBar.style.display = 'block';
  statusEl.textContent = 'Checking current page...';
  statusEl.className = '';

  log('Starting parsing process');
  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    log(`Active tab: ${tab.url}`);

    // Check if it's a Wildberries catalog/search page
    if (!tab.url.includes('wildberries.ru')) {
      throw new Error('Please open a Wildberries page first');
    }
    if (!tab.url.includes('/catalog/')) {
      throw new Error('Please open a Wildberries catalog or search results page. The URL should contain "/catalog/" (e.g., category pages or search results)');
    }

    // Start parsing pages
    await parseNextPage(tab.url);

    // Close popup so parsing can continue in background
    log('Starting background parsing, closing popup...');
    window.close();

  } catch (error) {
    log(`Error: ${error.message}`, 'error');
    statusEl.textContent = 'Error: ' + error.message;
    statusEl.className = 'error';
    button.disabled = false;
    progressBar.style.display = 'none';
  }
});

async function parseNextPage(baseUrl) {
  currentPage++;
  const statusEl = document.getElementById('status');
  const progressFill = document.getElementById('progressFill');

  log(`Parsing page ${currentPage} of ${totalPages}`);
  statusEl.textContent = `Parsing page ${currentPage} of ${totalPages}...`;

  // Construct page URL
  let pageUrl = baseUrl;
  if (currentPage > 1) {
    // Add page parameter to URL
    const url = new URL(baseUrl);
    url.searchParams.set('page', currentPage);
    pageUrl = url.toString();
  }

  log(`Opening page: ${pageUrl}`);
  // Open or navigate to the page
  const tab = await chrome.tabs.create({ url: pageUrl, active: false });

  // Wait for page load
  await new Promise(resolve => {
    const listener = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });

  log('Page loaded, injecting content script');
  // Inject content script
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  });

  // Wait a bit more for dynamic content to load
  log('Waiting for dynamic content to load');
  await new Promise(resolve => setTimeout(resolve, 3000));

  log('Getting product links');
  // Get product links
  const response = await chrome.tabs.sendMessage(tab.id, { action: 'get_product_links', max: maxProductsPerPage });

  if (response && response.links && response.links.length > 0) {
    allProductLinks.push(...response.links);
    log(`Found ${response.links.length} links on page ${currentPage}, total: ${allProductLinks.length}`);
    statusEl.textContent = `Found ${response.links.length} products on page ${currentPage}. Total: ${allProductLinks.length}`;
  } else {
    log('No links found on this page', 'error');
  }

  // Close the tab
  chrome.tabs.remove(tab.id);

  // Update progress
  const progress = (currentPage / totalPages) * 100;
  progressFill.style.width = progress + '%';

  // Parse next page or start product parsing
  if (currentPage < totalPages) {
    log('Moving to next page');
    setTimeout(() => parseNextPage(baseUrl), 2000); // Delay between pages
  } else {
    log(`Collected ${allProductLinks.length} total links, starting product parsing`);
    statusEl.textContent = `Collected ${allProductLinks.length} product links. Starting detail parsing...`;
    // Start parsing product details
    chrome.runtime.sendMessage({ action: 'start_parse', links: allProductLinks });
  }
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const statusEl = document.getElementById('status');
  const button = document.getElementById('parseButton');
  const progressBar = document.querySelector('.progress-bar');

  if (request.action === 'parse_progress') {
    log(`Progress: ${request.text}`);
    statusEl.textContent = request.text;
  } else if (request.action === 'all_parsed') {
    log(`All parsing completed, ${request.data ? request.data.length : 0} products parsed`);
    statusEl.textContent = 'Parsing completed and sent to Telegram!';
    // Reset UI
    button.disabled = false;
    progressBar.style.display = 'none';
  }
});

// Send data to Telegram with safe encoding
function sendToTelegram(data) {
  log('Preparing Telegram message');

  if (!data) {
    log('No data to send to Telegram', 'error');
    return;
  }

  let message = '';
  const products = data.products || data;

  if (!products || !Array.isArray(products)) {
    log('Invalid products data', 'error');
    return;
  }

  if (products && products.length > 0) {
    message = `Found ${products.length} products:\n\n`;
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const link = p && p.link || '#';

      const productText = `${link}\n`;

      // Check if adding this would exceed limit
      if (message.length + productText.length > 3500) {
        log(`Message too long at product ${i+1}, truncating`);
        message += `\n... (${products.length - i} more products truncated due to message length limit)`;
        break;
      }
      message += productText;
    }
  } else {
    message = "No products parsed.";
  }

  log(`Message length: ${message.length} characters`);
  log(`Message preview: ${message.substring(0, 200)}...`);

  const botToken = '8362095054:AAFdF2MZciT_AM2e4ks7Ajmrw4SU8YCDVnQ';
  const chatId = '5196899473';

  log(`Using bot token: ${botToken.substring(0, 10)}...`);
  log(`Using chat ID: ${chatId}`);

  const url = `https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(message)}&disable_web_page_preview=true`;
  log(`API URL: ${url.substring(0, 100)}...`);

  const statusEl = document.getElementById('status');
  statusEl.textContent = 'Sending to Telegram...';
  log('Sending to Telegram API');

  fetch(url)
    .then(r => {
      log(`Telegram API response status: ${r.status}`);
      return r.json();
    })
    .then(res => {
      log(`Telegram response: ${JSON.stringify(res)}`);
      if (res.ok) {
        log('Successfully sent to Telegram', 'success');
        statusEl.textContent = 'Successfully sent to Telegram!';
        statusEl.className = 'success';
      } else {
        log(`Telegram error: ${res.description || res.error_code}`, 'error');
        statusEl.textContent = 'Send error: ' + (res.description || res.error_code);
        statusEl.className = 'error';
      }
    })
    .catch(e => {
      log(`Network error: ${e.message}`, 'error');
      statusEl.textContent = 'Network error: ' + e.message;
      statusEl.className = 'error';
    });
}
