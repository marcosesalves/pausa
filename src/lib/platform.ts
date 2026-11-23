/** Which desktop the app is running on, for wording and for rows that only make sense on one of them. */
const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;

export const isWindows = /Windows/i.test(ua);
export const isMac = /Macintosh|Mac OS X/i.test(ua);

/** "Windows", "macOS" or "your computer". */
export const platformName = isWindows ? "Windows" : isMac ? "macOS" : "your computer";

/** Where Pausa waits when its window is closed. */
export const trayName = isWindows ? "tray" : "menu bar";
