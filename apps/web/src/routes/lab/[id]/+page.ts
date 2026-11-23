// Client-only: the workbench is xterm + CodeMirror + live polling, nothing to render on the server.
// (It also keeps the SSR bundle free of editor packages the slim runtime image doesn't ship.)
export const ssr = false;
