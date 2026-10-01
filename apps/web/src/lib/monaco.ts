import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Bundle Monaco locally (offline-friendly, CSP-safe — no CDN).
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  }
};

loader.config({ monaco });

/** EplyD dark theme for the editor. */
monaco.editor.defineTheme('eplyd-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '5d6f68', fontStyle: 'italic' },
    { token: 'keyword', foreground: '3ddc97' },
    { token: 'string', foreground: 'a7d7c5' },
    { token: 'number', foreground: 'e5c07b' }
  ],
  colors: {
    'editor.background': '#0D1312',
    'editor.lineHighlightBackground': '#131B19',
    'editorCursor.foreground': '#3DDC97',
    'editorLineNumber.foreground': '#3a4a44',
    'editorLineNumber.activeForeground': '#3DDC97',
    'editor.selectionBackground': '#1c3a2e',
    'editorIndentGuide.background1': '#1a2422',
    'editorGutter.background': '#0D1312'
  }
});
