/** Vite's `?raw` suffix: the file's text, so a test can read configuration without Node's `fs`. */
declare module '*?raw' {
  const content: string;
  export default content;
}
