class Logger {
  static info(msg) { console.log(`[INFO] ${msg}`); }
  static warn(msg) { console.warn(`[WARN] ${msg}`); }
  static error(msg) { console.error(`[ERROR] ${msg}`); }
}

module.exports = Logger;
