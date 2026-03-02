import { currentRoute } from "./router";
import { toggleTheme, effectiveTheme } from "./theme";
import { Landing } from "./components/Landing";
import { SenderView } from "./components/SenderView";
import { ReceiverView } from "./components/ReceiverView";
import { WebRTCSenderView } from "./components/WebRTCSenderView";
import { WebRTCReceiverView } from "./components/WebRTCReceiverView";
import { Settings } from "./components/Settings";

function RouteView() {
  const route = currentRoute.value;
  switch (route) {
    case "/":
      return <Landing />;
    case "/send/qr":
      return <SenderView />;
    case "/receive/qr":
      return <ReceiverView />;
    case "/send/webrtc":
      return <WebRTCSenderView />;
    case "/receive/webrtc":
      return <WebRTCReceiverView />;
    case "/settings":
      return <Settings />;
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
