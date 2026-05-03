export interface Logger {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
  debug: (msg: string, ...args: unknown[]) => void;
}

export const consoleLogger: Logger = {
  info: (msg, ...args) => console.log(`[magister] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[magister] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[magister] ${msg}`, ...args),
  debug: (msg, ...args) => {
    if (process.env["MAGISTER_DEBUG"]) console.log(`[magister:debug] ${msg}`, ...args);
  },
};
