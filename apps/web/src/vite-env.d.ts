/// <reference types="vite/client" />

declare const __BUILD_INFO__: { id: string; time: string };

declare module '*?worker' {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}
