import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initialTheme } from '@/lib/theme';
import { applyLang, initialLocale } from '@/store/locale';
import { App } from '@/ui/App';
import './index.css';

document.documentElement.classList.toggle('dark', initialTheme() === 'dark');
applyLang(initialLocale());

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
