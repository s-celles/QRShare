import { signal } from "@preact/signals";
import { navigate } from "@/ui/router";
import type { WebRTCService } from "@/webrtc/service";

/**
 * The live {@link WebRTCService} promoted for handoff to the collaborative editor.
 *
 * Both the WebRTC sender and receiver views own their own service instance. When a
 * user starts a collaborative session, the connected service is published here so
 * {@link CollabEditorView} can reuse the already-established trystero room instead
 * of reconnecting (approved decision 3 / REQ-COLLAB-004).
 */
export const activeCollabService = signal<WebRTCService | null>(null);

/** The roomId of the active collaborative session, used as the persistence key. */
export const activeCollabRoomId = signal<string>("");

/**
 * Hand off the live WebRTC connection to the collaborative editor and navigate to
 * `/collab`. When `initiate` is true this peer started the session and signals the
 * remote peer (REQ-COLLAB-005); when false this peer is following a remote start.
 */
export function enterCollab(
  service: WebRTCService,
  roomId: string,
  initiate: boolean,
): void {
  activeCollabService.value = service;
  activeCollabRoomId.value = roomId;
  if (initiate) service.startCollab();
  else service.enterEditing();
  navigate("/collab");
}

/**
 * Whether a WebRTC view may tear its service down as it unmounts.
 *
 * It may not, once that service has been handed off: `enterCollab` navigates to
 * `/collab`, which unmounts the sender/receiver view, and its cleanup would call
 * `disconnect()` — closing the very room the editor is about to adopt and leaving
 * `getRoom()` null. Ownership passes to the editor, which releases it via
 * {@link leaveCollab}.
 */
export function shouldDisconnectOnUnmount(
  service: WebRTCService | null,
  handedOff: WebRTCService | null,
): boolean {
  return service !== null && service !== handedOff;
}

/**
 * End the collaborative session: drop the handoff and close the connection the
 * editor owned. Called when the editor unmounts.
 */
export function leaveCollab(): void {
  activeCollabService.value?.disconnect();
  activeCollabService.value = null;
  activeCollabRoomId.value = "";
}
