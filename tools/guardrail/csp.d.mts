import type { Plugin } from 'vite';
export declare const CSP: string;
export declare function buildCsp(options?: { localFiles?: boolean }): string;
export declare function cspPlugin(options?: { localFiles?: boolean }): Plugin;
