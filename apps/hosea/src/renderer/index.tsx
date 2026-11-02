import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import 'bootstrap/dist/css/bootstrap.min.css';
import '@fontsource-variable/geist';
import '../ui/look-inside/look-inside.css';
import '../ui/markdown/markdown.css';
import '../ui/chat/chat.css';
import '../ui/chat/thinking.css';
import '../ui/context-display/context-display.css';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
