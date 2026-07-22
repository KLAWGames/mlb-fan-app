import React from 'react';
import { createRoot } from 'react-dom/client';
import { RecapContainer } from './RecapContainer.jsx';

export function mountRecapApp(container, props) {
  const root = createRoot(container);
  
  // Provide a clean unmount wrapper to prevent memory leaks when returning to the dashboard
  const originalOnClose = props.onClose;
  const wrappedOnClose = () => {
    root.unmount();
    originalOnClose();
  };

  root.render(
    <React.StrictMode>
      <RecapContainer {...props} onClose={wrappedOnClose} />
    </React.StrictMode>
  );
}
