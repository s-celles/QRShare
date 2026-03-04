import { currentRoute } from "./router";
import { toggleTheme, effectiveTheme } from "./theme";
import { t, locale } from "./i18n";
import { APP_VERSION } from "../version";
import { Landing } from "./components/Landing";
import { SenderView } from "./components/SenderView";
import { ReceiverView } from "./components/ReceiverView";
import { WebRTCSenderView } from "./components/WebRTCSenderView";
import { WebRTCReceiverView } from "./components/WebRTCReceiverView";
import { ScannerView } from "./components/ScannerView";
import { CreatorView } from "./components/CreatorView";
import { GuideView } from "./components/GuideView";
import { Settings } from "./components/Settings";
import { WebRTCSettings } from "./components/WebRTCSettings";
import { About } from "./components/About";
import { WebShareSenderView } from "./components/WebShareSenderView";

function RouteView() {
  const route = currentRoute.value;
  switch (route) {
    case "/":
      return <Landing />;
    case "/scan":
      return <ScannerView />;
    case "/create":
      return <CreatorView />;
    case "/send/qr":
      return <SenderView />;
    case "/receive/qr":
      return <ReceiverView />;
    case "/send/webrtc":
      return <WebRTCSenderView />;
    case "/receive/webrtc":
      return <WebRTCReceiverView />;
    case "/send/share":
      return <WebShareSenderView />;
    case "/guide":
      return <GuideView />;
    case "/settings":
      return <Settings />;
    case "/settings/webrtc":
      return <WebRTCSettings />;
    case "/about":
      return <About />;
    default:
      return <Landing />;
  }
}

export function App() {
  // Subscribe to locale for reactivity
  void locale.value;
  return (
    <>
      <header role="banner">
        <nav aria-label="Main navigation">
          <a
            href="#/"
            class="logo-link"
            aria-label={t("app.home")}
          >
            <h1>QRShare <span class="app-version">v{APP_VERSION}</span></h1>
          </a>
          <div class="nav-actions">
            <button
              class="icon-btn"
              onClick={toggleTheme}
              aria-label={effectiveTheme.value === "dark" ? t("app.toggleThemeLight") : t("app.toggleThemeDark")}
              title={t("app.toggleTheme")}
            >
              {effectiveTheme.value === "dark" ? "\u2600" : "\u263E"}
            </button>
            <a
              href="#/guide"
              class="icon-btn"
              aria-label={t("app.guide")}
              title={t("app.guideTitle")}
            >
              ?
            </a>
            <a
              href="#/about"
              class="icon-btn"
              aria-label={t("app.about")}
              title={t("app.aboutTitle")}
            >
              &#x2139;
            </a>
            <a
              href="#/settings"
              class="icon-btn"
              aria-label={t("app.settings")}
              title={t("app.settings")}
            >
              &#x2699;
            </a>
          </div>
        </nav>
      </header>
      <main role="main">
        <RouteView />
      </main>
    </>
  );
}
