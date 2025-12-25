// detail_content.js — for product pages

console.log('Detail content script loaded on:', window.location.href);

// Notify background that we're ready
chrome.runtime.sendMessage({ action: 'detail_ready' });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Detail script received message:', request);

  if (request.action === 'parse_detail') {
    console.log('Starting detail parsing...');

    // Give page time to fully load (prices, characteristics)
    setTimeout(() => {
      console.log('Parsing product details...');
      const data = parseDetailPage();
      console.log('Parsed data:', data);
      sendResponse(data);
    }, 3000);

    // Return true to indicate we'll respond asynchronously
    return true;
  }
  return true;
});

function parseDetailPage() {
  const product = {
    name: 'N/A', brand: 'N/A', price: 'N/A', oldPrice: '-', currency: 'RUB',
    rating: 'N/A', reviewsCount: '0', description: '', specs: {}, seller: 'Wildberries',
    link: window.location.href
  };

  // JSON-LD — самый надёжный источник
  document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
    try {
      const data = JSON.parse(script.textContent);
      if (data['@type'] && (data['@type'] === 'Product' || data['@type'].includes('Product'))) {
        product.name = data.name || product.name;
        product.brand = (data.brand && data.brand.name) || data.brand || product.brand;
        if (data.offers) {
          product.price = data.offers.price || product.price;
          product.currency = data.offers.priceCurrency || product.currency;
        }
        if (data.aggregateRating) {
          product.rating = data.aggregateRating.ratingValue || product.rating;
          product.reviewsCount = data.aggregateRating.reviewCount || product.reviewsCount;
        }
        product.description = (data.description || '').substring(0, 300);
      }
    } catch (e) {}
  });

  // DOM fallback
  if (product.name === 'N/A') {
    const h1 = document.querySelector('h1');
    if (h1) product.name = h1.textContent.trim();
  }

  // Try multiple price selectors (including the new one from user)
  const priceSelectors = [
    'h2.mo-typography.mo-typography_variant_title2.mo-typography_variable-weight_title2.mo-typography_color_accent',
    '.price-block__final-price',
    '.final-price',
    '[class*="final-price"]',
    '.price-block__price',
    '.product-price__value'
  ];

  for (const selector of priceSelectors) {
    const priceEl = document.querySelector(selector);
    if (priceEl) {
      const priceText = priceEl.textContent.trim();
      // Extract numeric price, remove currency symbols and spaces
      const priceMatch = priceText.replace(/[^\d]/g, '');
      if (priceMatch && parseInt(priceMatch) > 0) {
        product.price = parseInt(priceMatch);
        console.log('Found price:', product.price, 'from selector:', selector);
        break;
      }
    }
  }

  const oldPriceEl = document.querySelector('.price-block__old-price, [class*="old-price"], del');
  if (oldPriceEl) product.oldPrice = oldPriceEl.textContent.trim();

  const ratingEl = document.querySelector('.address-rate-mini, [class*="rating"]');
  if (ratingEl) product.rating = ratingEl.textContent.trim();

  const reviewsEl = document.querySelector('.product-rate__count, [class*="count"]');
  if (reviewsEl) product.reviewsCount = reviewsEl.textContent.replace(/\D/g, '');

  const descEl = document.querySelector('.collapsable__text, .description-text');
  if (descEl) product.description = descEl.textContent.trim().substring(0, 300);

  // Характеристики
  document.querySelectorAll('.characteristics__item, .params-block__row, tr').forEach(row => {
    const keyEl = row.querySelector('td:first-child, th, .characteristics__name, .params-block__param');
    const valueEl = row.querySelector('td:last-child, .characteristics__value, .params-block__value');
    if (keyEl && valueEl) {
      const key = keyEl.textContent.trim().replace(':', '');
      const value = valueEl.textContent.trim();
      if (key) product.specs[key] = value;
    }
  });

  const sellerEl = document.querySelector('.seller-info__name a, .seller-name');
  if (sellerEl) product.seller = sellerEl.textContent.trim();

  return product;
}
