import { currentRoute } from "./router";
import { toggleTheme, theme, type Theme } from "./theme";
import { t, locale } from "./i18n";
import { APP_VERSION, BUILD_HASH } from "../version";
import { Landing } from "./components/Landing";
import { SenderView } from "./components/SenderView";
import { ReceiverView } from "./components/ReceiverView";
import { WebRTCSenderView } from "./components/WebRTCSenderView";
import { WebRTCReceiverView } from "./components/WebRTCReceiverView";
import { CollabEditorView } from "./components/CollabEditorView";
import { ScannerView } from "./components/ScannerView";
import { UniversalScannerView } from "./components/UniversalScannerView";
import { CreatorView } from "./components/CreatorView";
import { GuideView } from "./components/GuideView";
import { Settings } from "./components/Settings";
import { WebRTCSettings } from "./components/WebRTCSettings";
import { About } from "./components/About";
import { WebShareSenderView } from "./components/WebShareSenderView";
import { SendChooserView } from "./components/SendChooserView";
import { UrlCreatorView } from "./components/UrlCreatorView";
import { CimbarView } from "./components/CimbarView";

/** Header theme button: auto (system) → light → dark. */
const THEME_ICONS: Record<Theme, string> = { auto: "\u25D0", light: "\u2600", dark: "\u263E" };
const THEME_LABELS: Record<Theme, string> = { auto: "settings.themeAuto", light: "settings.themeLight", dark: "settings.themeDark" };

function RouteView() {
  const route = currentRoute.value;
  switch (route) {
    case "/":
      return <Landing />;
    case "/scan":
      return <ScannerView />;
    case "/scan/auto":
      return <UniversalScannerView />;
    case "/create":
      return <CreatorView />;
    case "/create/url":
      return <UrlCreatorView />;
    case "/send":
      return <SendChooserView />;
    case "/send/qr":
      return <SenderView />;
    case "/receive/qr":
      return <ReceiverView />;
    case "/send/cimbar":
      return <CimbarView direction="send" />;
    case "/receive/cimbar":
      return <CimbarView direction="receive" />;
    case "/send/webrtc":
      return <WebRTCSenderView />;
    case "/receive/webrtc":
      return <WebRTCReceiverView />;
    case "/collab":
      return <CollabEditorView />;
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
            <h1>QRShare <span class="app-version">v{APP_VERSION} <span class="build-hash">({BUILD_HASH})</span></span></h1>
          </a>
          <div class="nav-actions">
            <button
              class="icon-btn theme-toggle"
              onClick={toggleTheme}
              aria-label={t("app.themeButton", { mode: t(THEME_LABELS[theme.value]) })}
              title={t("app.themeButton", { mode: t(THEME_LABELS[theme.value]) })}
            >
              {THEME_ICONS[theme.value]}
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
