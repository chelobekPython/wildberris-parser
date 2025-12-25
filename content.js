// content.js — for search pages

chrome.runtime.sendMessage({ action: 'content_ready' });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'get_product_links') {
    const max = request.max || 10;
    const links = getProductLinks(max);
    sendResponse({ links });
  }
  return true;
});

function getProductLinks(maxCount = 10) {
  const links = [];

  // Try multiple selectors for product links (updated for current Wildberries structure)
  const selectors = [
    'a[href*="/catalog/"][href*="detail.aspx"]',  // Original selector
    'a[href*="detail.aspx"]',                     // Any detail.aspx links
    '.product-card a[href*="detail.aspx"]',       // Product card links
    '.goods-card a[href*="detail.aspx"]',         // Alternative card class
    'article a[href*="detail.aspx"]',             // Article elements
    '[data-product-id] a[href*="detail.aspx"]',   // Data attribute
    '.product-card__wrapper a',                   // New card wrapper
    '.product-card__link',                        // Direct link class
    '.j-card-link',                               // JS card link
    '.card__link',                                // Card link
    '.goods-item a[href*="detail.aspx"]'          // Goods item links
  ];

  for (const selector of selectors) {
    if (links.length >= maxCount) break;

    const elements = document.querySelectorAll(selector);
    console.log(`Selector "${selector}" found ${elements.length} elements`);

    for (let i = 0; i < elements.length && links.length < maxCount; i++) {
      const a = elements[i];
      const href = a.href || a.getAttribute('href');
      if (href && href.includes('detail.aspx') && href.includes('wildberries.ru') && !links.includes(href)) {
        // Ensure it's a full URL
        const fullHref = href.startsWith('http') ? href : 'https://www.wildberries.ru' + href;
        links.push(fullHref);
        console.log(`Added link: ${fullHref}`);
      }
    }
  }

  // Additional check: look for product IDs in data attributes
  if (links.length < maxCount) {
    const productElements = document.querySelectorAll('[data-nm-id], [data-product-id]');
    console.log(`Found ${productElements.length} elements with product IDs`);

    for (let i = 0; i < productElements.length && links.length < maxCount; i++) {
      const el = productElements[i];
      const productId = el.getAttribute('data-nm-id') || el.getAttribute('data-product-id');
      if (productId) {
        const href = `https://www.wildberries.ru/catalog/${productId}/detail.aspx`;
        if (!links.includes(href)) {
          links.push(href);
          console.log(`Constructed link from ID: ${href}`);
        }
      }
    }
  }

  // Final fallback: any links that look like product URLs
  if (links.length < maxCount) {
    const allLinks = document.querySelectorAll('a[href]');
    console.log(`Final fallback: checking ${allLinks.length} total links`);

    for (let i = 0; i < allLinks.length && links.length < maxCount; i++) {
      const a = allLinks[i];
      const href = a.href;
      if (href && href.includes('wildberries.ru') && href.includes('detail.aspx') && !links.includes(href)) {
        links.push(href);
        console.log(`Fallback link: ${href}`);
      }
    }
  }

  console.log(`Total product links found: ${links.length}`, links);
  return links;
}
