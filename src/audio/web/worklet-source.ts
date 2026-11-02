/**
 * Source of the capture AudioWorkletProcessor, kept as a string so it can be
 * loaded from a Blob URL: no extra static asset, so the service worker precache,
 * the build and the single-file package need no change (REQ-AUD-090).
 *
 * The processor batches the 128-sample render quanta of input channel 0 into
 * 2048-sample Float32Arrays and transfers them to the main thread.
 */

export const WORKLET_PROCESSOR_NAME = "qrshare-capture";
export const WORKLET_CHUNK = 2048;

export const WORKLET_SOURCE = `
class QRShareCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(${WORKLET_CHUNK});
    this.n = 0;
  }
  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
          this.buf = new Float32Array(${WORKLET_CHUNK});
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(WORKLET_PROCESSOR_NAME)}, QRShareCaptureProcessor);
`;
