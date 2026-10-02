import { currentRoute, hashParams } from "./router";
import { rememberReturnUrl } from "@/share/handoff";
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
import { DocsView } from "./components/DocsView";
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

// REQ-HANDOFF-004: remember which application asked to receive a file.
hashParams.subscribe((params) => rememberReturnUrl(params.get("return")));

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
    case "/docs":
      return <DocsView />;
    case "/settings":
      return <Settings />;
    case "/settings/webrtc":
      return <WebRTCSettings />;
    case "/about":
      // The About window opens over the home screen.
      return (
        <>
          <Landing />
          <About />
        </>
      );
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
            <span class="brand" aria-hidden="true">QR</span>
            <h1>QRShare</h1>
          </a>
          {/* Version and build, as in Progressive Web Office: opens the About window. */}
          <a href="#/about" class="app-version" title={t("about.openTitle")}>
            v{APP_VERSION} <span class="build-hash">({BUILD_HASH})</span>
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
              href="#/docs"
              class="icon-btn"
              aria-label={t("app.docs")}
              title={t("app.docsTitle")}
            >
              <svg class="icon-svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                {/* An open book */}
                <path d="M12 6.5C10.2 5.2 7.6 4.5 4 4.5v14c3.6 0 6.2.7 8 2 1.8-1.3 4.4-2 8-2v-14c-3.6 0-6.2.7-8 2Z" />
                <path d="M12 6.5v14" />
              </svg>
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
