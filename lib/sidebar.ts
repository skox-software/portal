export const SIDEBAR_COOKIE = "skox_admin_sidebar";

/**
 * Runs from the root layout's <head>, before the admin page paints, so a collapsed sidebar never flashes open.
 * (Neon Auth's proxy rebuilds the request cookies, so the server can't read
 * this preference; the browser applies it instead.)
 */
export const SIDEBAR_BOOT = `(function(){try{if(document.cookie.indexOf("${SIDEBAR_COOKIE}=collapsed")>-1){document.documentElement.setAttribute("data-admin-sidebar","collapsed")}}catch(e){}})();`;
