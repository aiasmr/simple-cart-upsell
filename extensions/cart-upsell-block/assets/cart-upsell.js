(function() {
  'use strict';

  // Get API URL from block settings, or use app proxy path as fallback
  const cartUpsellData = document.getElementById('cart-upsell-data');
  const configuredUrl = cartUpsellData?.dataset.apiUrl;

  // If no URL configured, use app proxy path (works automatically in dev and prod)
  const API_BASE = configuredUrl || '/apps/simple-cart-upsell';
  const SHOP_DOMAIN = window.Shopify?.shop || '';

  // Session ID for analytics (stored in sessionStorage)
  function getSessionId() {
    let sessionId = sessionStorage.getItem('cart_upsell_session');
    if (!sessionId) {
      sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      sessionStorage.setItem('cart_upsell_session', sessionId);
    }
    return sessionId;
  }

  // Track analytics event
  async function trackEvent(eventType, ruleId, productPrice = null) {
    const cartToken = getCookie('cart');

    try {
      // Use different paths depending on whether we're using proxy or direct URL
      const endpoint = configuredUrl ? '/api/storefront/track' : '/track';
      await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType,
          ruleId,
          shopDomain: SHOP_DOMAIN,
          cartToken,
          sessionId: getSessionId(),
          productPrice
        })
      });
    } catch (err) {
      console.error('Analytics tracking failed:', err);
    }
  }

  // Get cookie value
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
  }

  // Fetch current cart
  async function getCart() {
    try {
      const response = await fetch('/cart.js');
      return await response.json();
    } catch (err) {
      console.error('Failed to fetch cart:', err);
      return { items: [] };
    }
  }

  // Fetch free shipping settings
  async function fetchShippingSettings() {
    if (!SHOP_DOMAIN) return { enabled: false, threshold: 0 };

    const params = new URLSearchParams({
      shop: SHOP_DOMAIN
    });

    try {
      // Use different paths depending on whether we're using proxy or direct URL
      const endpoint = configuredUrl ? '/api/storefront/shipping' : '/shipping';
      const response = await fetch(`${API_BASE}${endpoint}?${params}`);
      const data = await response.json();
      return data;
    } catch (err) {
      console.error('Failed to fetch shipping settings:', err);
      return { enabled: false, threshold: 0 };
    }
  }

  // Format money with currency
  function formatMoneyWithCurrency(amount, currency) {
    const currencySymbols = {
      'USD': '$',
      'EUR': '€',
      'GBP': '£',
      'CAD': 'CA$',
      'AUD': 'A$',
      'JPY': '¥',
      'CNY': '¥',
      'INR': '₹'
    };

    const symbol = currencySymbols[currency] || currency;
    return `${symbol}${amount.toFixed(2)}`;
  }

  // Fetch upsell offers
  async function fetchUpsells(productIds, cartToken) {
    if (!productIds.length || !SHOP_DOMAIN) return [];

    const params = new URLSearchParams({
      shop: SHOP_DOMAIN,
      products: productIds.join(','),
      cartToken: cartToken || ''
    });

    try {
      // Use different paths depending on whether we're using proxy or direct URL
      const endpoint = configuredUrl ? '/api/storefront/upsells' : '/upsells';
      const response = await fetch(`${API_BASE}${endpoint}?${params}`);
      const data = await response.json();
      return data.offers || [];
    } catch (err) {
      console.error('Failed to fetch upsells:', err);
      return [];
    }
  }

  // Add product to cart
  async function addToCart(variantId, quantity = 1) {
    // Extract numeric ID from Shopify GID if needed
    const numericId = variantId.includes('gid://')
      ? variantId.split('/').pop()
      : variantId;

    try {
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{
            id: numericId,
            quantity: quantity
          }]
        })
      });

      if (response.ok) {
        // Trigger cart update event
        document.dispatchEvent(new CustomEvent('cart:updated'));

        // Refresh the page to show updated cart
        window.location.reload();
        return true;
      }
      return false;
    } catch (err) {
      console.error('Add to cart failed:', err);
      return false;
    }
  }

  // Format price
  function formatMoney(cents) {
    const amount = (cents / 100).toFixed(2);
    return window.Shopify?.currency?.active
      ? `${window.Shopify.currency.active} ${amount}`
      : `$${amount}`;
  }

  // Calculate discount percentage
  function getDiscountPercent(price, compareAtPrice) {
    if (!compareAtPrice || compareAtPrice <= price) return null;
    return Math.round(((compareAtPrice - price) / compareAtPrice) * 100);
  }

  // Render offers
  function renderOffers(offers, container) {
    if (!offers.length) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';

    const offersHTML = offers.map(offer => {
      const discountPercent = getDiscountPercent(
        offer.product.price,
        offer.product.compareAtPrice
      );

      const hasSale = discountPercent && discountPercent > 0;

      return `
      <div class="cart-upsell__item" data-rule-id="${offer.ruleId}">
        ${hasSale ? `<span class="cart-upsell__badge cart-upsell__badge--sale">${discountPercent}% OFF</span>` : ''}
        <div class="cart-upsell__image">
          ${offer.product.image
            ? `<img src="${offer.product.image}" alt="${offer.product.title}" loading="lazy">`
            : '<div class="cart-upsell__no-image">No image</div>'
          }
        </div>
        <div class="cart-upsell__details">
          <h4 class="cart-upsell__title">${offer.product.title}</h4>
          <div class="cart-upsell__price ${hasSale ? 'cart-upsell__price--sale' : ''}">
            ${hasSale ? `<span class="cart-upsell__compare-price">${formatMoney(offer.product.compareAtPrice)}</span>` : ''}
            <span>${formatMoney(offer.product.price)}</span>
          </div>
          <button
            class="cart-upsell__add-btn"
            data-variant-id="${offer.product.variantId}"
            data-rule-id="${offer.ruleId}"
            data-price="${offer.product.price}">
            Add to Cart
          </button>
        </div>
      </div>
    `;
    }).join('');

    const listContainer = container.querySelector('.cart-upsell__list');
    if (listContainer) {
      listContainer.innerHTML = offersHTML;
    }

    // Track impressions
    offers.forEach(offer => {
      trackEvent('IMPRESSION', offer.ruleId);
    });

    // Attach click handlers
    container.querySelectorAll('.cart-upsell__add-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const button = e.target;
        const variantId = button.dataset.variantId;
        const ruleId = button.dataset.ruleId;
        const price = parseFloat(button.dataset.price);

        button.disabled = true;
        button.textContent = 'Adding...';

        const success = await addToCart(variantId);

        if (success) {
          // Track conversion
          trackEvent('CONVERSION', ruleId, price);
          button.textContent = 'Added!';
        } else {
          button.disabled = false;
          button.textContent = 'Try Again';
        }
      });
    });
  }

  // Detect if we're in a cart drawer context
  function isInCartDrawer() {
    // Check common cart drawer selectors used by Shopify themes
    const drawerSelectors = [
      'cart-drawer',
      '.cart-drawer',
      '#cart-drawer',
      '#CartDrawer',
      '.drawer--cart',
      '[id*="drawer"]',
      '[class*="drawer"]',
      'aside[aria-label*="cart" i]',
      'aside[role="dialog"]',
      '.mini-cart',
      '#mini-cart'
    ];

    for (const selector of drawerSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        // Check if our script is running inside this element
        const scriptTag = document.currentScript || document.querySelector('script[src*="cart-upsell.js"]');
        if (scriptTag && element.contains(scriptTag)) {
          return element;
        }
        // Or check if there's a cart form inside
        if (element.querySelector('form[action="/cart"]')) {
          return element;
        }
      }
    }
    return null;
  }

  // Inject free shipping bar into cart drawer
  function injectShippingBarIntoDrawer(drawer) {
    // Check if bar already exists in drawer
    if (drawer.querySelector('#free-shipping-bar')) return;

    // Create the shipping bar HTML
    const shippingBarHTML = `
      <div class="free-shipping-bar" id="free-shipping-bar-drawer" style="display: none; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; padding: 1.25rem; margin: 1rem 0; border: none; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);">
        <div class="free-shipping-bar__message" id="free-shipping-message-drawer" style="font-size: 1rem; font-weight: 700; margin-bottom: 0.75rem; text-align: center; color: #ffffff; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);"></div>
        <div class="free-shipping-bar__progress-container" style="width: 100%; height: 12px; background: rgba(255, 255, 255, 0.3); border-radius: 20px; overflow: hidden; position: relative; box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);">
          <div class="free-shipping-bar__progress" id="free-shipping-progress-drawer" style="height: 100%; background: linear-gradient(90deg, #ffffff 0%, #f0f0f0 100%); border-radius: 20px; transition: width 0.5s ease; width: 0%; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);"></div>
        </div>
      </div>
    `;

    // Find the best place to inject it (top of cart items or drawer header)
    const cartForm = drawer.querySelector('form[action="/cart"]');
    const cartItems = drawer.querySelector('.cart-items, .cart__items, [class*="items"]');
    const drawerHeader = drawer.querySelector('.drawer__header, .cart-drawer__header, header');

    if (cartItems) {
      // Insert before cart items
      cartItems.insertAdjacentHTML('beforebegin', shippingBarHTML);
    } else if (cartForm) {
      // Insert at top of cart form
      cartForm.insertAdjacentHTML('afterbegin', shippingBarHTML);
    } else if (drawerHeader) {
      // Insert after header
      drawerHeader.insertAdjacentHTML('afterend', shippingBarHTML);
    } else {
      // Insert at top of drawer as fallback
      drawer.insertAdjacentHTML('afterbegin', shippingBarHTML);
    }
  }

  // Update shipping progress (works for both page and drawer)
  function updateShippingProgressBar(cartTotal, threshold, currency, isDrawer = false) {
    const suffix = isDrawer ? '-drawer' : '';
    const barElement = document.getElementById(`free-shipping-bar${suffix}`);
    const messageElement = document.getElementById(`free-shipping-message${suffix}`);
    const progressElement = document.getElementById(`free-shipping-progress${suffix}`);

    if (!barElement || !messageElement || !progressElement) return;

    const remaining = threshold - cartTotal;
    const progress = Math.min((cartTotal / threshold) * 100, 100);

    if (remaining > 0) {
      // Not yet reached threshold
      const remainingFormatted = formatMoneyWithCurrency(remaining, currency || 'USD');
      messageElement.textContent = `Add ${remainingFormatted} more for free shipping!`;
      messageElement.classList.remove('success');
      progressElement.classList.remove('complete');
    } else {
      // Threshold reached!
      messageElement.textContent = '🎉 You\'ve unlocked free shipping!';
      messageElement.classList.add('success');
      progressElement.classList.add('complete');
      // Update progress element style for complete state
      progressElement.style.background = 'linear-gradient(90deg, #4caf50 0%, #66bb6a 100%)';
      progressElement.style.boxShadow = '0 0 12px rgba(76, 175, 80, 0.5)';
    }

    progressElement.style.width = `${progress}%`;
    barElement.style.display = 'block';
  }

  // Initialize upsells
  async function initUpsells() {
    const containers = document.querySelectorAll('[data-cart-upsell]');
    const drawer = isInCartDrawer();

    // If we're in a drawer, inject the shipping bar
    if (drawer) {
      injectShippingBarIntoDrawer(drawer);
    }

    const cart = await getCart();
    const productIds = cart.items.map(item => item.product_id.toString());
    const cartToken = getCookie('cart');

    // Fetch and update free shipping progress
    const shippingSettings = await fetchShippingSettings();
    if (shippingSettings.enabled && shippingSettings.threshold > 0) {
      // Cart total is in cents, convert to dollars
      const cartTotal = cart.total_price / 100;

      // Update both page and drawer if they exist
      updateShippingProgressBar(cartTotal, shippingSettings.threshold, shippingSettings.currency, false);
      if (drawer) {
        updateShippingProgressBar(cartTotal, shippingSettings.threshold, shippingSettings.currency, true);
      }
    }

    if (!containers.length) return;

    if (!productIds.length) {
      containers.forEach(container => {
        container.style.display = 'none';
      });
      return;
    }

    const offers = await fetchUpsells(productIds, cartToken);

    containers.forEach(container => {
      renderOffers(offers, container);
    });
  }

  // Watch for cart drawer being added to DOM
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) { // Element node
            // Check if the added node or its children contain a cart drawer
            const drawerSelectors = [
              'cart-drawer',
              '.cart-drawer',
              '#cart-drawer',
              '#CartDrawer',
              '.drawer--cart',
              '.mini-cart',
              '#mini-cart'
            ];

            for (const selector of drawerSelectors) {
              if (node.matches && node.matches(selector)) {
                setTimeout(initUpsells, 100); // Small delay to ensure drawer is fully rendered
                return;
              }
              if (node.querySelector && node.querySelector(selector)) {
                setTimeout(initUpsells, 100);
                return;
              }
            }
          }
        }
      }
    }
  });

  // Start observing the document for cart drawer additions
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUpsells);
  } else {
    initUpsells();
  }

  // Re-run when cart updates (handle various cart event types)
  document.addEventListener('cart:updated', initUpsells);
  document.addEventListener('cart:refresh', initUpsells);
  document.addEventListener('cart:change', initUpsells);

  // Listen for drawer open events
  document.addEventListener('drawer:open', initUpsells);
  document.addEventListener('cart-drawer:open', initUpsells);
})();
