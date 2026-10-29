// Shared by the server layout (inlined in <head>) and the client theme store.
export const THEME_KEY = "rc-theme";

/** Inlined in <head>: resolves the stored or system theme before anything renders. */
export const THEME_SCRIPT = `(function(){try{var m=localStorage.getItem("${THEME_KEY}")||"system";var t=m==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):m;document.documentElement.dataset.theme=t;document.documentElement.dataset.themeMode=m;}catch(e){document.documentElement.dataset.theme="dark";}})();`;
