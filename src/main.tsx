import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initialTheme } from '@/lib/theme';
import { App } from '@/ui/App';
import './index.css';

document.documentElement.classList.toggle('dark', initialTheme() === 'dark');

const root = document.getElementById('root');
if (!root) throw new Error('#root 를 찾을 수 없다');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
