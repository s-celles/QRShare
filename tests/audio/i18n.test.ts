import { describe, expect, it } from "bun:test";
import { en } from "@/ui/translations/en";
import { fr } from "@/ui/translations/fr";

const audioKeys = (dict: Record<string, string>) =>
  Object.keys(dict).filter((k) => k.startsWith("audio.") || /^(landing|sendChooser)\.\w*[aA]udio/.test(k)).sort();

describe("audio translations (REQ-AUD-120)", () => {
  it("defines the same audio keys in English and French", () => {
    expect(audioKeys(fr)).toEqual(audioKeys(en));
  });

  it("covers the keys listed in the design", () => {
    const required = [
      "landing.audioGroup", "landing.sendAudioTitle", "landing.sendAudioDesc", "landing.sendAudioAria",
      "landing.receiveAudioTitle", "landing.receiveAudioDesc", "landing.receiveAudioAria",
      "sendChooser.audio", "sendChooser.audioDesc", "sendChooser.audioSuitable", "sendChooser.audioSlow",
      "audio.experimentalHint", "audio.profile", "audio.profileRobust", "audio.profileFast", "audio.profileUltrasonic",
      "audio.ultrasonicWarning", "audio.advanced", "audio.codec", "audio.codecAuto", "audio.codecLt", "audio.play",
      "audio.stop", "audio.volumeHint", "audio.tooLarge", "audio.estimate", "audio.packetsSent", "audio.symbolsSent",
      "audio.startListening", "audio.micDenied", "audio.micUnavailable", "audio.tapToStart", "audio.level",
      "audio.tooQuiet", "audio.clipping", "audio.signalDetected", "audio.detectedProfile", "audio.packetsAccepted",
      "audio.packetsRejected", "audio.wirehairUnavailable", "audio.complete",
    ];
    for (const key of required) {
      expect(en[key]).toBeDefined();
      expect(fr[key]).toBeDefined();
    }
  });

  it("marks every audio heading and label as Experimental", () => {
    for (const key of ["landing.audioGroup", "landing.sendAudioTitle", "landing.receiveAudioTitle", "sendChooser.audio", "audio.sendHeading", "audio.receiveHeading"]) {
      expect(en[key]).toContain("Experimental");
      expect(fr[key]).toContain("Expérimental");
    }
  });

  it("keeps the same placeholders in both languages", () => {
    for (const key of audioKeys(en)) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(fr[key])).toEqual(ph(en[key]));
    }
  });
});
