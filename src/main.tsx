import { render } from "preact";
import { App } from "./ui/App";

const root = document.getElementById("app");
if (root) {
  render(<App />, root);
}

// Register Service Worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const newSW = reg.installing;
        if (!newSW) return;
        newSW.addEventListener("statechange", () => {
          if (newSW.state === "activated" && navigator.serviceWorker.controller) {
            // New version available - could prompt user to refresh
            console.info("[QRShare] New version available. Refresh to update.");
          }
        });
      });
    });
  });
}
