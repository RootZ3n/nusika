export interface Logger {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
  debug: (msg: string, ...args: unknown[]) => void;
}

export const consoleLogger: Logger = {
  info: (msg, ...args) => console.log(`[nusika] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[nusika] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[nusika] ${msg}`, ...args),
  debug: (msg, ...args) => {
    if (process.env["NUSIKA_DEBUG"] ?? process.env["MAGISTER_DEBUG"]) console.log(`[nusika:debug] ${msg}`, ...args);
  },
};
