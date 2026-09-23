import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { aplicarTema } from './estilos/aplicarTema';
import './estilos/base.css';
import App from './App';

// Antes de renderizar: as variáveis de cor precisam existir quando o primeiro
// componente é pintado, senão a tela aparece sem cor por um quadro.
aplicarTema();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
