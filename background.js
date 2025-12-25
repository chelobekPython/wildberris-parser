// Save logs to storage
function bgLog(message, type) {
  if (typeof type === 'undefined') type = 'info';
  const timestamp = new Date().toLocaleTimeString();
  const entry = '[' + timestamp + '] ' + message;
  console.log('[BG-' + type.toUpperCase() + '] ' + message);

  // Save to storage
  chrome.storage.local.get(['logs'], function(result) {
    const logs = result.logs || [];
    logs.push({ message: entry, type: type });
    chrome.storage.local.set({ logs: logs });
  });
}

console.log('Background service worker started');
bgLog('Background service worker initialized');

let collectedData = [];
let productLinks = [];
let currentIndex = 0;

function handleDetailParsed(data) {
  console.log('Detail parsed:', data);
  collectedData.push(data);
  currentIndex++;

  if (currentIndex < productLinks.length) {
    bgLog(`Parsing ${currentIndex + 1} of ${productLinks.length}...`);
    setTimeout(parseNextProduct, 4000 + Math.random() * 2000);
  } else {
    console.log('All products parsed, sending data:', collectedData);
    bgLog(`All parsing completed, ${collectedData.length} products parsed`);

    // Save final data to storage
    chrome.storage.local.set({ lastParseResult: collectedData }, function() {
      console.log('Parse results saved to storage');
    });

      // Send to Telegram automatically
      sendToTelegram({ products: collectedData });

      // Show completion notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        title: 'WB Parser Complete',
        message: `Parsed ${collectedData.length} products and sent to Telegram!`
      });
  }
}

// Send data to Telegram with safe encoding
function sendToTelegram(data) {
  bgLog('Preparing Telegram message');

  if (!data) {
    bgLog('No data to send to Telegram', 'error');
    return;
  }

  let message = '';
  const products = data.products || data;

  if (!products || !Array.isArray(products)) {
    bgLog('Invalid products data', 'error');
    return;
  }

  if (products && products.length > 0) {
    message = 'Found ' + products.length + ' products:\n\n';
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const link = p && p.link || '#';

      const productText = link + '\n';

      // Check if adding this would exceed limit
      if (message.length + productText.length > 3500) {
        bgLog('Message too long at product ' + (i+1) + ', truncating');
        message += '\n... (' + (products.length - i) + ' more products truncated due to message length limit)';
        break;
      }
      message += productText;
    }
  } else {
    message = "No products parsed.";
  }

  bgLog('Message length: ' + message.length + ' characters');

  const botToken = '8362095054:AAFdF2MZciT_AM2e4ks7Ajmrw4SU8YCDVnQ';
  const chatId = '-1003560575729';

  bgLog('Using bot token: ' + botToken.substring(0, 10) + '...');
  bgLog('Using chat ID: ' + chatId);

  const url = 'https://api.telegram.org/bot' + botToken + '/sendMessage?chat_id=' + chatId + '&text=' + encodeURIComponent(message) + '&disable_web_page_preview=true';
  bgLog('API URL: ' + url.substring(0, 100) + '...');

  bgLog('Sending to Telegram API');

  fetch(url)
    .then(function(r) {
      bgLog('Telegram API response status: ' + r.status);
      return r.json();
    })
    .then(function(res) {
      bgLog('Telegram response: ' + JSON.stringify(res));
      if (res.ok) {
        bgLog('Successfully sent to Telegram', 'success');
      } else {
        bgLog('Telegram error: ' + (res.description || res.error_code), 'error');
      }
    })
    .catch(function(e) {
      bgLog('Network error: ' + e.message, 'error');
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request);

  if (request.action === 'start_parse') {
    productLinks = request.links; // No limit, use all collected links
    collectedData = [];
    currentIndex = 0;

    console.log(`Starting detail parsing of ${productLinks.length} products`);
    console.log('Product links:', productLinks);

    bgLog(`Parsing 1 of ${productLinks.length}...`);
    parseNextProduct();
    sendResponse({ status: 'started' });
  } else if (request.action === 'start_monitoring') {
    startMonitoring(request.url, request.interval);
    sendResponse({ status: 'monitoring_started' });
  } else if (request.action === 'stop_monitoring') {
    stopMonitoring();
    sendResponse({ status: 'monitoring_stopped' });
  } else if (request.action === 'test_monitoring') {
    bgLog('Manual test of monitoring triggered');
    checkForNewProducts();
    sendResponse({ status: 'test_started' });
  }
  return true;
});

// Monitoring functionality
let monitorMaxPrice = 50000;

function startMonitoring(url, interval, maxPrice) {
  monitorMaxPrice = maxPrice || 50000;
  bgLog('Starting auto-monitoring for: ' + url + ' (every ' + interval + ' minutes, max price: ' + monitorMaxPrice + '₽)');

  // Clear existing alarm
  chrome.alarms.clear('product-monitor', function() {
    // Create new alarm with immediate first check
    chrome.alarms.create('product-monitor', {
      delayInMinutes: 0.1,  // First check in 6 seconds
      periodInMinutes: interval
    });

    bgLog('Monitor alarm created - first check in 6 seconds');
  });
}

function stopMonitoring() {
  chrome.alarms.clear('product-monitor');
  bgLog('Auto-monitoring stopped');
}

// Parse prices for multiple products
function parseProductsForPrice(links, callback) {
  const products = [];
  let completed = 0;

  if (links.length === 0) {
    callback([]);
    return;
  }

  links.forEach(function(link, index) {
    setTimeout(function() {
      chrome.tabs.create({ url: link, active: false }, function(tab) {
        // Wait for page load
        const loadPromise = new Promise(function(resolve) {
          const listener = function(tabId, changeInfo) {
            if (tabId === tab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });

        loadPromise.then(function() {
          // Inject detail_content.js
          return chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['detail_content.js']
          });
        }).then(function() {
          // Wait for script ready
          return new Promise(function(resolve, reject) {
            const readyListener = function(msg, sender) {
              if (sender.tab && sender.tab.id === tab.id && msg.action === 'detail_ready') {
                chrome.runtime.onMessage.removeListener(readyListener);
                resolve();
              }
            };
            chrome.runtime.onMessage.addListener(readyListener);
            setTimeout(function() {
              chrome.runtime.onMessage.removeListener(readyListener);
              reject(new Error('Timeout'));
            }, 8000);
          });
        }).then(function() {
          // Get price
          return chrome.tabs.sendMessage(tab.id, { action: 'parse_detail' });
        }).then(function(response) {
          products.push({
            link: link,
            price: response && response.price || 'N/A'
          });
          completed++;
          if (completed >= links.length) {
            callback(products);
          }
        }).catch(function(error) {
          bgLog('Error parsing price for ' + link + ': ' + error.message, 'error');
          products.push({
            link: link,
            price: 'N/A'
          });
          completed++;
          if (completed >= links.length) {
            callback(products);
          }
        }).finally(function() {
          chrome.tabs.remove(tab.id);
        });
      });
    }, index * 2000); // Stagger requests by 2 seconds
  });
}

// Handle alarm triggers
chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === 'product-monitor') {
    checkForNewProducts();
  }
});

function checkForNewProducts() {
  chrome.storage.local.get(['monitorUrl', 'sentLinks', 'maxPrice'], function(result) {
    if (!result.monitorUrl) {
      bgLog('No monitor URL configured', 'error');
      return;
    }

    const monitorUrl = result.monitorUrl;
    const sentLinks = result.sentLinks || [];
    const maxPrice = result.maxPrice || 50000;

    bgLog('Checking for new products on: ' + monitorUrl + ' (max price: ' + maxPrice + '₽)');

    // Open the monitor page
    chrome.tabs.create({ url: monitorUrl, active: false }, function(tab) {
      // Wait for page load
      const loadPromise = new Promise(function(resolve) {
        const listener = function(tabId, changeInfo) {
          if (tabId === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });

      loadPromise.then(function() {
        // Inject content script
        return chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
      }).then(function() {
        // Wait for dynamic content
        return new Promise(function(resolve) {
          setTimeout(resolve, 3000);
        });
      }).then(function() {
        // Get current products (use reasonable limit for monitoring)
        return chrome.tabs.sendMessage(tab.id, { action: 'get_product_links', max: 20 });
      }).then(function(response) {
        if (response && response.links && response.links.length > 0) {
          // Find new links
          const newLinks = response.links.filter(function(link) {
            return sentLinks.indexOf(link) === -1;
          });

          bgLog('Found ' + response.links.length + ' total products, ' + newLinks.length + ' new');

          if (newLinks.length > 0) {
            bgLog('Found ' + newLinks.length + ' new products, parsing prices...');

            // For now, send all new products (price parsing has issues)
            bgLog('Sending all ' + newLinks.length + ' new products (price filter disabled due to parsing issues)');

            const newProducts = newLinks.map(function(link) {
              return { link: link };
            });

            sendToTelegram({ products: newProducts });

            // Add to sent list
            const updatedSentLinks = sentLinks.concat(newLinks);
            chrome.storage.local.set({ sentLinks: updatedSentLinks });

            bgLog('Sent ' + newLinks.length + ' new products to Telegram');
          } else {
            bgLog('No new products found');
          }
        } else {
          bgLog('No products found on monitored page', 'error');
        }

        // Close the tab
        chrome.tabs.remove(tab.id);
      }).catch(function(error) {
        bgLog('Error during monitoring check: ' + error.message, 'error');
        chrome.tabs.remove(tab.id);
      });
    });
  });
}

function parseNextProduct() {
  const link = productLinks[currentIndex];
  console.log(`Parsing product ${currentIndex + 1}: ${link}`);

  chrome.tabs.create({ url: link, active: true }, function(tab) {
    // Immediately make it inactive to not disturb user
    chrome.tabs.update(tab.id, { active: false });

    // Wait for page load
    const loadPromise = new Promise(function(resolve) {
      const listener = function(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    loadPromise.then(function() {
      console.log('Page loaded, injecting detail_content.js');
      // Manually inject detail_content.js
      return chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['detail_content.js']
      });
    }).then(function() {
      console.log('Waiting for detail_ready message');
      // Wait for detail_ready message
      return new Promise(function(resolve, reject) {
        const readyListener = function(msg, sender) {
          if (sender.tab && sender.tab.id === tab.id && msg.action === 'detail_ready') {
            console.log('Received detail_ready from tab', tab.id);
            chrome.runtime.onMessage.removeListener(readyListener);
            resolve();
          }
        };

        chrome.runtime.onMessage.addListener(readyListener);

        // Timeout if detail_ready not received
        setTimeout(function() {
          chrome.runtime.onMessage.removeListener(readyListener);
          reject(new Error('Timeout waiting for detail_ready'));
        }, 10000);
      });
    }).then(function() {
      console.log('Sending parse_detail request');
      // Now send parse request
      chrome.tabs.sendMessage(tab.id, { action: 'parse_detail' }, function(response) {
        console.log('Received parse response:', response);
        handleDetailParsed(response || { error: 'No data received' });
        chrome.tabs.remove(tab.id);
      });
    }).catch(function(error) {
      console.log('Error in parseNextProduct:', error);
      handleDetailParsed({ error: 'Parse failed: ' + error.message, link });
      chrome.tabs.remove(tab.id);
    });
  });
}
