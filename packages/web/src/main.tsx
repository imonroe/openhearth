import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './home/home.css';
import './library/library.css';
import './player/player.css';
import { App } from './App';
import { initCursorVisibility } from './cursorVisibility';

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

// Reveal the OS cursor when a mouse is used; hide it for keyboard/remote use.
initCursorVisibility();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
