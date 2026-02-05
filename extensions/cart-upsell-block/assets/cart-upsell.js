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

  // Render offers
  function renderOffers(offers, container) {
    if (!offers.length) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';

    const offersHTML = offers.map(offer => `
      <div class="cart-upsell__item" data-rule-id="${offer.ruleId}">
        <div class="cart-upsell__image">
          ${offer.product.image
            ? `<img src="${offer.product.image}" alt="${offer.product.title}" loading="lazy">`
            : '<div class="cart-upsell__no-image">No image</div>'
          }
        </div>
        <div class="cart-upsell__details">
          <h4 class="cart-upsell__title">${offer.product.title}</h4>
          <p class="cart-upsell__price">${formatMoney(offer.product.price)}</p>
          <button
            class="cart-upsell__add-btn"
            data-variant-id="${offer.product.variantId}"
            data-rule-id="${offer.ruleId}"
            data-price="${offer.product.price}">
            Add to Cart
          </button>
        </div>
      </div>
    `).join('');

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

  // Initialize upsells
  async function initUpsells() {
    const containers = document.querySelectorAll('[data-cart-upsell]');
    if (!containers.length) return;

    const cart = await getCart();
    const productIds = cart.items.map(item => item.product_id.toString());
    const cartToken = getCookie('cart');

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

  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUpsells);
  } else {
    initUpsells();
  }

  // Re-run when cart updates
  document.addEventListener('cart:updated', initUpsells);
})();
