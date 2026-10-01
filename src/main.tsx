import { render } from "preact";
import { App } from "./ui/App";
import { t } from "./ui/i18n";

const root = document.getElementById("app");
if (root) {
  render(<App />, root);
}

/** Offer to reload when a new version has been installed, as Progressive Web Office does. */
function showUpdateBanner(): void {
  if (document.querySelector(".update-banner")) return;
  const banner = document.createElement("div");
  banner.className = "update-banner";
  banner.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = t("pwa.update");
  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "primary";
  reload.textContent = t("common.reload");
  reload.addEventListener("click", () => location.reload());
  const later = document.createElement("button");
  later.type = "button";
  later.textContent = t("common.later");
  later.addEventListener("click", () => banner.remove());
  banner.append(text, reload, later);
  document.body.append(banner);
}

// Register Service Worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // Only a page already run by an older worker has an update to offer;
    // on the first visit the new worker claims the page without any banner.
    const servedByWorker = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const newSW = reg.installing;
        if (!newSW) return;
        newSW.addEventListener("statechange", () => {
          // The new worker takes over at once (skipWaiting); the page still runs the old code.
          if (newSW.state === "activated" && servedByWorker) showUpdateBanner();
        });
      });
      // An installed app can stay open for days: look for a new version when it comes back.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void reg.update().catch(() => {});
      });
    });
  });
}
