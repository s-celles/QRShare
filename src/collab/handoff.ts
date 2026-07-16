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
