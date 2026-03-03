import { currentRoute } from "./router";
import { toggleTheme, effectiveTheme } from "./theme";
import { Landing } from "./components/Landing";
import { SenderView } from "./components/SenderView";
import { ReceiverView } from "./components/ReceiverView";
import { WebRTCSenderView } from "./components/WebRTCSenderView";
import { WebRTCReceiverView } from "./components/WebRTCReceiverView";
import { ScannerView } from "./components/ScannerView";
import { CreatorView } from "./components/CreatorView";
import { GuideView } from "./components/GuideView";
import { Settings } from "./components/Settings";
import { About } from "./components/About";

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
    case "/guide":
      return <GuideView />;
    case "/settings":
      return <Settings />;
    case "/about":
      return <About />;
    default:
      return <Landing />;
  }
}

export function App() {
  return (
    <>
      <header role="banner">
        <nav aria-label="Main navigation">
          <a
            href="#/"
            class="logo-link"
            aria-label="QRShare home"
          >
            <h1>QRShare</h1>
          </a>
          <div class="nav-actions">
            <button
              class="icon-btn"
              onClick={toggleTheme}
              aria-label={`Switch to ${effectiveTheme.value === "dark" ? "light" : "dark"} theme`}
              title="Toggle theme"
            >
              {effectiveTheme.value === "dark" ? "\u2600" : "\u263E"}
            </button>
            <a
              href="#/guide"
              class="icon-btn"
              aria-label="User guide"
              title="Guide"
            >
              ?
            </a>
            <a
              href="#/about"
              class="icon-btn"
              aria-label="About QRShare"
              title="About"
            >
              &#x2139;
            </a>
            <a
              href="#/settings"
              class="icon-btn"
              aria-label="Settings"
              title="Settings"
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
