/**
 * Application entry point.
 *
 * WalletManager is created ONCE at module scope, outside the component tree.
 * Creating it inside a component would tear down and rebuild the wallet
 * connection on every render, dropping an active Pera session.
 *
 * Verified against @txnlab/use-wallet-react 4.6.0.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { NetworkId, WalletId, WalletManager, WalletProvider } from '@txnlab/use-wallet-react';
import App from './App.js';
import './styles/tokens.css';

/**
 * Wallet configuration.
 *
 * TestNet only. Pera first because it is the wallet most Algorand users have,
 * with Defly and Lute as alternatives so a judge is not blocked if they happen
 * to use something else.
 */
const walletManager = new WalletManager({
  wallets: [WalletId.PERA, WalletId.DEFLY, WalletId.LUTE],
  defaultNetwork: NetworkId.TESTNET,
});

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found. Check index.html.');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <WalletProvider manager={walletManager}>
      <App />
    </WalletProvider>
  </React.StrictMode>,
);