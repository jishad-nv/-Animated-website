/**
 * Pop Carty Frontend Configuration
 * Dynamically resolves the Backend API URL without hardcoding.
 * 
 * Supports:
 * 1. Global window.__POPCARTY_API_URL__ or window.VITE_API_URL
 * 2. Meta tag: <meta name="api-base-url" content="https://api.popcarty.com">
 * 3. LocalStorage override: localStorage.getItem('POPCARTY_API_URL')
 * 4. Default: '' (relative paths, uses Vercel rewrites or reverse proxy)
 */
(function() {
    function resolveApiBase() {
        // 1. Check window globals (injected by host or SSR)
        if (typeof window.__POPCARTY_API_URL__ === 'string' && window.__POPCARTY_API_URL__.trim()) {
            return window.__POPCARTY_API_URL__.trim().replace(/\/+$/, '');
        }
        if (typeof window.VITE_API_URL === 'string' && window.VITE_API_URL.trim()) {
            return window.VITE_API_URL.trim().replace(/\/+$/, '');
        }

        // 2. Check HTML meta tag
        const metaTag = document.querySelector('meta[name="api-base-url"]');
        if (metaTag && metaTag.content && metaTag.content.trim() && !metaTag.content.startsWith('__')) {
            return metaTag.content.trim().replace(/\/+$/, '');
        }

        // 3. Check LocalStorage for local developer override
        try {
            const stored = localStorage.getItem('POPCARTY_API_URL');
            if (stored && stored.trim()) {
                return stored.trim().replace(/\/+$/, '');
            }
        } catch (e) {}

        // 4. Default to relative (works with Vercel rewrites or same-origin)
        return '';
    }

    const apiBase = resolveApiBase();

    window.POPCARTY_CONFIG = {
        API_BASE: apiBase,
        apiUrl: function(endpoint) {
            const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
            return (apiBase ? apiBase : '') + cleanEndpoint;
        }
    };

    console.log('[Pop Carty] API Base URL configured as:', apiBase || '(relative / same origin)');
})();
