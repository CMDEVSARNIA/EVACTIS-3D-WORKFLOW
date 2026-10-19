// pdf.js ships no types for its worker module; the Viewer only hands it back to pdf.js.
declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
