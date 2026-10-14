// Uploads a compiled sketch to a REAL Arduino Uno over USB, straight from
// the browser — no Arduino IDE, no PlatformIO, no native app. Two web
// platform features make this possible with nothing else installed:
//   1. Web Serial (navigator.serial) — Chrome/Edge only (desktop), talks
//      to the board's USB-serial chip directly.
//   2. The STK500v1 protocol the Uno's stock bootloader (Optiboot) speaks
//      — the same protocol avrdude uses under the hood when the real
//      Arduino IDE uploads a sketch, reimplemented here in plain JS.
// The .hex this flashes is the exact same one services/arduinoCompileService.js
// already produces for the in-browser simulator (controllers/labController.js's
// compileArduinoSketch, --fqbn arduino:avr:uno) — so what gets simulated
// and what gets flashed are always the same compiled output.
//
// Protocol byte values and sequence cross-checked against a known-working
// reference implementation (dbuezas/js-stk500v1, used by several existing
// browser-based Arduino uploaders) rather than guessed from memory — a
// wrong byte here fails silently on real hardware with no way for a
// student to debug it themselves.
(function () {
  const STK = {
    GET_SYNC: 0x30,
    SET_DEVICE: 0x42,
    ENTER_PROGMODE: 0x50,
    LOAD_ADDRESS: 0x55,
    PROG_PAGE: 0x64,
    READ_PAGE: 0x74,
    LEAVE_PROGMODE: 0x51,
    READ_SIGN: 0x75,
    CRC_EOP: 0x20,
    INSYNC: 0x14,
    OK: 0x10,
  };

  const PAGE_SIZE = 128; // ATmega328P (Uno) flash page size, in bytes
  const UNO_SIGNATURE = [0x1e, 0x95, 0x0f]; // ATmega328P — same chip on every genuine or clone Uno
  const BAUD_RATE = 115200; // Optiboot's standard rate on every Uno shipped since ~2011

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Intel HEX -> a dense byte array sized to the actual program, gaps
  // filled with 0xFF (how erased AVR flash actually reads) — simpler than
  // arduinoLab.js's parseIntelHex (word array, fixed 32KB, used to feed
  // the avr8js CPU emulator) since this only needs to hand STK500 raw
  // byte pages, never execute anything.
  function parseIntelHexBytes(hexString) {
    const sparse = new Map();
    let extendedAddr = 0;
    let maxAddr = -1;

    for (const rawLine of hexString.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line.startsWith(":")) continue;

      const byteCount = parseInt(line.substr(1, 2), 16);
      const address = parseInt(line.substr(3, 4), 16);
      const recordType = parseInt(line.substr(7, 2), 16);

      if (recordType === 1) break; // end-of-file record
      if (recordType === 4) {
        extendedAddr = parseInt(line.substr(9, 4), 16) << 16;
        continue;
      }
      if (recordType !== 0) continue; // only data records matter here

      for (let i = 0; i < byteCount; i++) {
        const addr = extendedAddr + address + i;
        sparse.set(addr, parseInt(line.substr(9 + i * 2, 2), 16));
        if (addr > maxAddr) maxAddr = addr;
      }
    }

    const bytes = new Uint8Array(maxAddr + 1).fill(0xff);
    sparse.forEach((byte, addr) => {
      bytes[addr] = byte;
    });
    return bytes;
  }

  // Continuously drains port.readable into a growing buffer so a slow or
  // late response is never lost — waitForBytes() below just polls that
  // buffer instead of racing reader.read() against a timeout directly,
  // which would silently discard whatever a timed-out read() eventually
  // resolves to (bytes that arrive a few ms "too late" would otherwise
  // vanish instead of showing up for the NEXT command, desyncing every
  // read after it).
  function SerialByteSource(port) {
    this.buffer = new Uint8Array(0);
    this.stopped = false;
    this.reader = port.readable.getReader();
    this._pumpPromise = this._pump();
  }

  SerialByteSource.prototype._pump = async function () {
    try {
      while (!this.stopped) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value && value.length) {
          const merged = new Uint8Array(this.buffer.length + value.length);
          merged.set(this.buffer, 0);
          merged.set(value, this.buffer.length);
          this.buffer = merged;
        }
      }
    } catch (err) {
      // Port closed/disconnected mid-read — the in-flight command's own
      // waitForBytes() will time out on its own and surface a clear error,
      // nothing to do here.
    }
  };

  SerialByteSource.prototype.waitForBytes = async function (n, timeoutMs) {
    const start = Date.now();
    while (this.buffer.length < n) {
      if (Date.now() - start > timeoutMs) return null;
      await sleep(10);
    }
    const out = this.buffer.slice(0, n);
    this.buffer = this.buffer.slice(n);
    return out;
  };

  SerialByteSource.prototype.drain = function () {
    this.buffer = new Uint8Array(0);
  };

  SerialByteSource.prototype.stop = async function () {
    this.stopped = true;
    try {
      await this.reader.cancel();
    } catch (err) {
      /* already closed */
    }
    try {
      this.reader.releaseLock();
    } catch (err) {
      /* already released */
    }
  };

  // Writes one STK500 command frame and validates the standard
  // INSYNC ... OK envelope every response follows, returning whatever
  // payload (if any) came between them.
  async function sendCommand(writer, reader, bytes, expectLen, timeoutMs) {
    await writer.write(new Uint8Array(bytes));
    const resp = await reader.waitForBytes(expectLen, timeoutMs);
    if (!resp) throw new Error("The board stopped responding — check the USB cable and that nothing else (like a Serial Monitor) has the port open.");
    if (resp[0] !== STK.INSYNC) throw new Error("The board's responses got out of sync. Try unplugging and reconnecting it.");
    if (resp[resp.length - 1] !== STK.OK) throw new Error("The board rejected a command during upload.");
    return resp.slice(1, resp.length - 1);
  }

  // Optiboot can still be mid-boot (blinking the onboard LED) when the
  // first sync lands, so this always retries a handful of times rather
  // than failing on the first miss — the same allowance avrdude makes.
  async function sync(writer, reader, attempts) {
    for (let i = 0; i < attempts; i++) {
      try {
        await sendCommand(writer, reader, [STK.GET_SYNC, STK.CRC_EOP], 2, 300);
        return true;
      } catch (err) {
        reader.drain();
      }
    }
    return false;
  }

  async function readSignature(writer, reader) {
    return sendCommand(writer, reader, [STK.READ_SIGN, STK.CRC_EOP], 5, 500);
  }

  // Optiboot ignores nearly every field here (confirmed across every
  // reference implementation checked) — sent anyway for compatibility
  // with any stricter bootloader a clone board might ship.
  async function setDevice(writer, reader) {
    const params = new Array(20).fill(0);
    params[12] = (PAGE_SIZE >> 8) & 0xff; // pagesizehigh
    params[13] = PAGE_SIZE & 0xff; // pagesizelow
    await sendCommand(writer, reader, [STK.SET_DEVICE, ...params, STK.CRC_EOP], 2, 500);
  }

  async function enterProgMode(writer, reader) {
    await sendCommand(writer, reader, [STK.ENTER_PROGMODE, STK.CRC_EOP], 2, 500);
  }

  async function leaveProgMode(writer, reader) {
    await sendCommand(writer, reader, [STK.LEAVE_PROGMODE, STK.CRC_EOP], 2, 500);
  }

  // STK500 addresses flash in 16-bit WORDS, not bytes — every byte offset
  // this file otherwise works in gets halved right before this call.
  async function loadAddress(writer, reader, wordAddr) {
    const low = wordAddr & 0xff;
    const high = (wordAddr >> 8) & 0xff;
    await sendCommand(writer, reader, [STK.LOAD_ADDRESS, low, high, STK.CRC_EOP], 2, 500);
  }

  async function progPage(writer, reader, pageBytes) {
    const sizeHigh = (pageBytes.length >> 8) & 0xff;
    const sizeLow = pageBytes.length & 0xff;
    const cmd = [STK.PROG_PAGE, sizeHigh, sizeLow, 0x46 /* 'F' = flash memtype */, ...pageBytes, STK.CRC_EOP];
    await sendCommand(writer, reader, cmd, 2, 1500);
  }

  async function readPage(writer, reader, size) {
    const sizeHigh = (size >> 8) & 0xff;
    const sizeLow = size & 0xff;
    return sendCommand(writer, reader, [STK.READ_PAGE, sizeHigh, sizeLow, 0x46, STK.CRC_EOP], size + 2, 1500);
  }

  function padToPageSize(slice) {
    if (slice.length === PAGE_SIZE) return slice;
    const padded = new Uint8Array(PAGE_SIZE).fill(0xff); // erased flash reads as 0xFF
    padded.set(slice);
    return padded;
  }

  // The board picked via "Connect" stays open across multiple uploads —
  // without this, every single upload re-triggered Chrome's port picker
  // and paid the full USB open overhead again, which is also what was
  // producing the occasional "out of sync" on a second attempt (a fresh
  // open() can race the OS/driver settling from the previous one before
  // it's fully torn down). connectToBoard()/disconnectFromBoard() below
  // own this lifecycle; uploadToBoard() just uses whatever's here.
  let connectedPort = null;

  function isConnected() {
    return !!connectedPort;
  }

  async function connectToBoard() {
    if (!navigator.serial) {
      throw new Error("Connecting to a real board needs Chrome or Edge on desktop — this browser doesn't support Web Serial.");
    }
    if (connectedPort) return; // already connected — Connect doubles as a no-op here, Disconnect is the explicit opposite

    let port;
    try {
      port = await navigator.serial.requestPort();
    } catch (err) {
      throw new Error("No board selected.");
    }

    try {
      await port.open({ baudRate: BAUD_RATE });
    } catch (err) {
      throw new Error("Couldn't open the USB connection — make sure nothing else (like the Arduino IDE's Serial Monitor) already has it open, then try again.");
    }

    port.addEventListener("disconnect", () => {
      // Fires on physical unplug (or the OS otherwise yanking the
      // device) — navigator.serial's own event, not something this file
      // has to poll for.
      if (connectedPort === port) {
        connectedPort = null;
        notifyConnectionChange();
      }
    });

    connectedPort = port;
    notifyConnectionChange();
  }

  async function disconnectFromBoard() {
    const port = connectedPort;
    connectedPort = null;
    notifyConnectionChange();
    if (port) {
      try {
        await port.close();
      } catch (err) {
        /* already closed / disconnected */
      }
    }
  }

  let connectionListeners = [];
  function onConnectionChange(fn) {
    connectionListeners.push(fn);
  }
  function notifyConnectionChange() {
    const connected = isConnected();
    connectionListeners.forEach((fn) => fn(connected));
  }

  // One full reset -> sync -> verify-signature -> program -> verify ->
  // leave-progmode pass. Split out of uploadToBoard() so that function
  // can retry a WHOLE fresh attempt (its own reset included) rather than
  // just one failed step — a single glitchy sync or a few stray bytes
  // left over from the board's previous sketch only ever affects one
  // attempt, and a clean reset reliably clears it for the next one.
  async function attemptUpload(port, writer, reader, bytes, onProgress) {
    // Connect only opens the port — nothing reads it until this reader
    // exists, so if the board has been sitting connected for a while
    // running its last-flashed sketch (e.g. one that calls
    // Serial.println in loop()), a backlog of stale application output
    // can already be queued up by the OS/browser the moment this reader
    // starts pumping. Give that backlog a moment to actually land in
    // the buffer, then clear it — otherwise some of it can still be
    // arriving (one _pump() read() at a time, across several event-loop
    // ticks) right as the reset-triggered drain() below runs, leaving a
    // few stale bytes sitting in front of the real STK500 response
    // sync() expects next.
    await sleep(150);
    reader.drain();

    // Reset-into-bootloader: toggling DTR/RTS low then high pulses the
    // Uno's RESET line through its auto-reset capacitor — the exact
    // sequence avrdude's "arduino" programmer uses.
    onProgress("Resetting board...");
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    await sleep(250);
    await port.setSignals({ dataTerminalReady: true, requestToSend: true });
    await sleep(50);
    reader.drain();

    onProgress("Connecting...");
    const synced = await sync(writer, reader, 10);
    if (!synced) {
      throw new Error("Couldn't connect to the board. Make sure it's an Arduino Uno, the USB cable is a data cable (not charge-only), and nothing else has the port open.");
    }

    const sig = await readSignature(writer, reader);
    const sigMatches = UNO_SIGNATURE.every((b, i) => sig[i] === b);
    if (!sigMatches) {
      const got = Array.from(sig).map((b) => "0x" + b.toString(16).padStart(2, "0")).join(" ");
      const err = new Error(`This doesn't look like an Arduino Uno (got chip signature ${got}) — stopped before writing anything, to be safe.`);
      err.notRetryable = true; // retrying a reset won't change what chip is actually plugged in
      throw err;
    }

    await setDevice(writer, reader);
    await enterProgMode(writer, reader);

    const totalPages = Math.ceil(bytes.length / PAGE_SIZE);

    onProgress("Uploading... 0%");
    for (let page = 0; page < totalPages; page++) {
      const byteOffset = page * PAGE_SIZE;
      const pageBytes = padToPageSize(bytes.slice(byteOffset, byteOffset + PAGE_SIZE));
      await loadAddress(writer, reader, byteOffset >> 1);
      await progPage(writer, reader, pageBytes);
      onProgress(`Uploading... ${Math.round(((page + 1) / totalPages) * 100)}%`);
    }

    onProgress("Verifying... 0%");
    for (let page = 0; page < totalPages; page++) {
      const byteOffset = page * PAGE_SIZE;
      const expected = padToPageSize(bytes.slice(byteOffset, byteOffset + PAGE_SIZE));
      await loadAddress(writer, reader, byteOffset >> 1);
      const actual = await readPage(writer, reader, PAGE_SIZE);
      for (let i = 0; i < PAGE_SIZE; i++) {
        if (actual[i] !== expected[i]) {
          throw new Error(`Verification failed partway through (byte ${byteOffset + i}) — the upload may not have completed correctly. Try again.`);
        }
      }
      onProgress(`Verifying... ${Math.round(((page + 1) / totalPages) * 100)}%`);
    }

    await leaveProgMode(writer, reader);
  }

  // The whole upload, start to finish. onProgress(message) is called at
  // each phase so the caller can show it in the lab's existing status
  // line — this file owns no UI of its own. Requires connectToBoard()
  // to have already been called — doesn't prompt for a port itself.
  async function uploadToBoard(hexText, options) {
    const onProgress = (options && options.onProgress) || function () {};

    if (!connectedPort) {
      throw new Error("Connect to your board first.");
    }

    const bytes = parseIntelHexBytes(hexText);
    if (!bytes.length) throw new Error("Nothing to upload — the compiled sketch is empty.");

    const port = connectedPort;
    const writer = port.writable.getWriter();
    const reader = new SerialByteSource(port);

    try {
      // One retry (two attempts total), each with its own fresh reset —
      // real-hardware testing found the handshake can fail once after
      // sitting connected for a while (stray bytes left over from
      // whatever the board was last running) and then succeed cleanly
      // on an immediate second try, so this absorbs that automatically
      // instead of making a student manually reconnect and click Upload
      // again. Not retried: a confirmed wrong/no chip (notRetryable) —
      // a fresh reset can't change what's actually plugged in.
      const MAX_ATTEMPTS = 2;
      let lastErr;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          await attemptUpload(port, writer, reader, bytes, onProgress);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (err.notRetryable || attempt === MAX_ATTEMPTS) break;
          onProgress("That attempt didn't sync — retrying...");
          await sleep(300);
        }
      }
      if (lastErr) throw lastErr;
    } finally {
      // Deliberately NOT closing the port here — it stays open/connected
      // for the next upload, so a student iterating on their code isn't
      // re-prompted by Chrome's port picker (and doesn't pay the open()
      // overhead again) every single time they click Upload.
      try {
        writer.releaseLock();
      } catch (err) {
        /* already released */
      }
      await reader.stop();
    }
  }

  window.ArduinoFlash = {
    isSupported: !!navigator.serial,
    isConnected,
    connectToBoard,
    disconnectFromBoard,
    onConnectionChange,
    uploadToBoard,
  };

  // ---------- UI wiring ----------

  document.addEventListener("DOMContentLoaded", () => {
    const connectBtn = document.getElementById("connectBoardBtn");
    const uploadBtn = document.getElementById("uploadBoardBtn");
    if (!connectBtn || !uploadBtn) return;

    if (!navigator.serial) {
      connectBtn.disabled = true;
      connectBtn.title = "Needs Chrome or Edge on desktop — this browser doesn't support connecting to a real board.";
      uploadBtn.disabled = true;
      uploadBtn.title = "Needs Chrome or Edge on desktop — this browser doesn't support uploading to a real board.";
      return;
    }

    // Upload starts disabled — there's nothing to upload to until a
    // board is actually connected.
    uploadBtn.disabled = true;

    onConnectionChange((connected) => {
      connectBtn.classList.toggle("lab-icon-btn--connected", connected);
      connectBtn.title = connected ? "Connected — click to disconnect" : "Connect to an Arduino Uno over USB";
      uploadBtn.disabled = !connected;
      uploadBtn.title = connected
        ? "Upload this sketch to your connected Arduino Uno"
        : "Connect to a board first (Chrome/Edge only)";
    });

    connectBtn.addEventListener("click", async () => {
      if (isConnected()) {
        await disconnectFromBoard();
        if (typeof showToast === "function") showToast("Disconnected from board");
        return;
      }
      connectBtn.disabled = true;
      const setStatusFn = typeof setStatus === "function" ? setStatus : function () {};
      try {
        await connectToBoard();
        setStatusFn("Board connected", "running");
        if (typeof showToast === "function") showToast("Connected to your Arduino Uno");
      } catch (err) {
        console.error("Connect to board failed:", err);
        setStatusFn(err.message || "Couldn't connect.", "error");
      } finally {
        connectBtn.disabled = false;
      }
    });

    uploadBtn.addEventListener("click", async () => {
      if (!isConnected()) return; // disabled should already prevent this, but no-op defensively
      if (!window.ArduinoLab || typeof window.ArduinoLab.getCode !== "function") return;
      // In case a block was edited within the last 300ms (regenerateCodeFromBlocks's
      // own debounce window) and hasn't synced into codeEditor yet — same
      // reason arduinoLab.js's saveProject() forces this before reading
      // the code.
      if (window.ArduinoBlocksLab && typeof window.ArduinoBlocksLab.syncCodeFromBlocks === "function") {
        window.ArduinoBlocksLab.syncCodeFromBlocks();
      }
      const code = window.ArduinoLab.getCode();
      if (!code) return;

      uploadBtn.disabled = true;
      const setStatusFn = typeof setStatus === "function" ? setStatus : function () {};
      setStatusFn("Compiling...", "busy");

      let compileResult;
      try {
        const res = await fetch("/labs/arduino/compile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        compileResult = await res.json();
      } catch (err) {
        setStatusFn("Couldn't reach the compiler — check your connection and try again.", "error");
        uploadBtn.disabled = false;
        return;
      }

      if (!compileResult.success) {
        setStatusFn(compileResult.error || "Compile failed.", "error");
        uploadBtn.disabled = false;
        return;
      }

      try {
        await uploadToBoard(compileResult.hex, { onProgress: (msg) => setStatusFn(msg, "busy") });
        setStatusFn("Uploaded to board!", "running");
        if (typeof showToast === "function") showToast("Sketch uploaded to your Arduino Uno");
      } catch (err) {
        console.error("Upload to board failed:", err);
        setStatusFn(err.message || "Upload failed.", "error");
      } finally {
        uploadBtn.disabled = !isConnected();
      }
    });
  });
})();
