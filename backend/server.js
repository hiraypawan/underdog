require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

process.on('uncaughtException', (err) => {
  console.error('[UNDERDOG] UNCAUGHT:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[UNDERDOG] UNHANDLED REJECTION:', err?.message || err);
});

const db = require('./database/db');
const FreeDataPipeline = require('./pipeline/websocket_client');
const CandleFactory = require('./pipeline/candle_factory');
const StrategyManager = require('./engine/strategy_manager');
const OrderManagementSystem = require('./engine/oms');
const BinanceExecutor = require('./engine/binance_executor');
const TradeManager = require('./engine/trade_manager');
const { calculatePnL } = require('./engine/risk_manager');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

if (process.env.HTTP_PORT) config.server.httpPort = parseInt(process.env.HTTP_PORT);
if (process.env.WS_PORT) config.server.wsPort = parseInt(process.env.WS_PORT);

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ port: config.server.wsPort });

const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));

  const binanceBalance = (binanceExecutor && binanceExecutor.isEnabled() && binanceExecutor.accountInfo)
    ? parseFloat(binanceExecutor.accountInfo.totalWalletBalance) || db.getBalance() || 10000
    : db.getBalance() || 10000;

  ws.send(JSON.stringify({
    type: 'INIT',
    config: config,
    balance: binanceBalance,
    stats: db.getStats(),
    positions: db.getOpenPositions(),
    candles: {
      BTCUSD: candleFactory.getAllTimeframeHistory('BTCUSD'),
      XAUUSD: candleFactory.getAllTimeframeHistory('XAUUSD')
    }
  }));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.readyState === 1) {
      try { client.send(msg); } catch (e) {}
    }
  }
}

const candleFactory = new CandleFactory(config, broadcast);
const strategyManager = new StrategyManager(config.strategies);
const binanceExecutor = new BinanceExecutor(config);
const oms = new OrderManagementSystem(config.mode, db, config, binanceExecutor);
const tradeManager = new TradeManager(config, candleFactory, strategyManager, oms, db, broadcast);

const pipeline = new FreeDataPipeline(config.symbols, candleFactory, broadcast);

pipeline.onTick = (symbol, price, side) => {
  tradeManager.onTick(symbol, price, side);
  if (tradeManager.tickCounter % 500 === 0 && binanceExecutor.isEnabled()) {
    binanceExecutor.getAccountInfo().then(info => {
      if (info) broadcast({ type: 'BALANCE_UPDATE', balance: info.balance, equity: info.equity, pnl: info.pnl, available: info.available });
    }).catch(() => {});
  }
};

// ===== HTTP API Routes =====

app.get('/api/status', (req, res) => {
  const binanceBalance = (binanceExecutor && binanceExecutor.isEnabled() && binanceExecutor.accountInfo)
    ? parseFloat(binanceExecutor.accountInfo.totalWalletBalance) || db.getBalance() || 10000
    : db.getBalance() || 10000;
  res.json({
    mode: config.mode,
    balance: binanceBalance,
    stats: db.getStats(),
    positions: db.getOpenPositions(),
    pipeline: pipeline.getStats(),
    session: tradeManager.getSessionStats()
  });
});

app.get('/api/debug/candles/:symbol', (req, res) => {
  const symbol = req.params.symbol;
  const liveBar = candleFactory.getLiveBar(symbol);
  const prevBar = candleFactory.getPreviousBar(symbol);
  const atr = candleFactory.getATR(symbol);
  const obi = candleFactory.calculateOBI(symbol);
  const localRange = candleFactory.getLocalRange(symbol, 15);
  const recentBars = candleFactory.getRecentBars(symbol, 5);
  const m15Bars = candleFactory.getRecentBars(symbol, 5, 'M15');
  res.json({ liveBar, prevBar, atr, obi, localRange, recentBars, m15Bars });
});

app.get('/api/positions', (req, res) => {
  res.json(db.getOpenPositions());
});

app.get('/api/history', (req, res) => {
  res.json(db.getTradeHistory(100));
});

app.get('/api/stats', (req, res) => {
  res.json(db.getStats());
});

app.get('/api/config', (req, res) => {
  res.json(config);
});

app.get('/api/prices', (req, res) => {
  res.json(tradeManager.currentPrices);
});

app.get('/api/session-stats', (req, res) => {
  res.json(tradeManager.getSessionStats());
});

// ===== Hacker Tools API =====

app.get('/api/hacker/spread/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  res.json(candleFactory.getSpreadStats(symbol));
});

app.get('/api/hacker/volatility/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  res.json({
    score: candleFactory.getVolatilityScore(symbol),
    atr: candleFactory.getATR(symbol),
    mtfAtr: candleFactory.getMultiTimeframeATR(symbol)
  });
});

app.get('/api/hacker/volume-spike/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  res.json(candleFactory.detectVolumeSpike(symbol));
});

app.get('/api/hacker/walls/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  res.json(candleFactory.detectWalls(symbol));
});

app.get('/api/hacker/obi/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  res.json({ obi: candleFactory.calculateOBI(symbol) });
});

app.get('/api/hacker/tick-flow/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  res.json(candleFactory.tickAccumulator[symbol] || {});
});

app.get('/api/hacker/last-signal/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  res.json(strategyManager.getLastSignal(symbol) || { signal: false });
});

// ===== Config Update Routes =====

app.post('/api/config', (req, res) => {
  const updates = req.body;
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'mode') {
      config.mode = value;
      oms.setMode(value);
    } else if (key.startsWith('strategies.')) {
      const parts = key.split('.');
      let obj = config;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] = value;
    } else if (key.startsWith('risk.')) {
      const parts = key.split('.');
      config.risk[parts[1]] = value;
    } else if (key.startsWith('demo.')) {
      const parts = key.split('.');
      config.demo[parts[1]] = value;
      if (parts[1] === 'simulatedSpreadPts') db.setSetting('simulated_spread_points', value);
      if (parts[1] === 'simulatedSlippagePts') db.setSetting('simulated_slippage_points', value);
    } else if (key.startsWith('symbols.')) {
      const parts = key.split('.');
      if (!config.symbols[parts[1]]) config.symbols[parts[1]] = {};
      config.symbols[parts[1]][parts[2]] = value;
    }
  }
  fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
  broadcast({ type: 'CONFIG_UPDATE', config });
  res.json({ status: 'OK', config });
});

app.post('/api/mode', (req, res) => {
  const { mode } = req.body;
  const normalizedMode = mode === 'LIVE' || mode === 'REAL' ? 'LIVE' : 'DEMO';
  config.mode = normalizedMode;
  oms.setMode(normalizedMode);
  db.setSetting('mode', normalizedMode);
  broadcast({ type: 'MODE_CHANGE', mode: normalizedMode });
  res.json({ status: 'OK', mode: normalizedMode });
});

app.post('/api/strategy', (req, res) => {
  const { name, enabled } = req.body;
  if (name in config.strategies) {
    if (typeof config.strategies[name] === 'object') {
      config.strategies[name].enabled = enabled;
    } else {
      config.strategies[name] = { enabled: enabled };
    }
    fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
    broadcast({ type: 'STRATEGY_UPDATE', name, enabled });
    res.json({ status: 'OK' });
  } else {
    res.status(400).json({ error: 'Unknown strategy' });
  }
});

app.post('/api/close/:ticket', async (req, res) => {
  const ticket = parseInt(req.params.ticket);
  const pos = db.getOpenPositionByTicket(ticket);
  if (!pos) return res.status(404).json({ error: 'Position not found' });

  if (binanceExecutor && binanceExecutor.isEnabled()) {
    const result = await binanceExecutor.closeOrder({
      ticket, symbol: pos.symbol, direction: pos.direction, lots: pos.lots
    });
    if (result.status === 'SUCCESS') {
      const pnl = calculatePnL(pos, result.closePrice, result.closePrice);
      db.closePosition(ticket, result.closePrice, pnl);
      broadcast({ type: 'POSITION_CLOSED', ticket, closePrice: result.closePrice, pnl, reason: 'MANUAL', symbol: pos.symbol, direction: pos.direction, lots: pos.lots, entryPrice: pos.open_price });
      return res.json({ status: 'OK', pnl });
    }
    return res.status(500).json({ error: result.error });
  }

  const currentPrice = tradeManager.getCurrentPrice(pos.symbol);
  if (!currentPrice) return res.status(500).json({ error: 'No price data' });
  const prices = tradeManager.currentPrices[pos.symbol];
  const pnl = calculatePnL(pos, prices.bid, prices.ask);
  db.closePosition(ticket, currentPrice, pnl);
  broadcast({ type: 'POSITION_CLOSED', ticket, closePrice: currentPrice, pnl, reason: 'MANUAL', symbol: pos.symbol, direction: pos.direction, lots: pos.lots, entryPrice: pos.open_price });
  res.json({ status: 'OK', pnl });
});

app.post('/api/reset-daily', (req, res) => {
  db.resetDaily();
  broadcast({ type: 'DAILY_RESET' });
  res.json({ status: 'OK' });
});

app.get('/api/binance/status', async (req, res) => {
  if (!binanceExecutor || !binanceExecutor.isEnabled()) {
    return res.json({ connected: false, mode: 'DEMO', account: null });
  }
  const info = await binanceExecutor.getAccountInfo();
  res.json({ connected: true, mode: binanceExecutor.testnet ? 'TESTNET' : 'LIVE', account: info });
});

// ===== Start =====

async function start() {
  console.log('[UNDERDOG] Starting Quant Terminal...');
  const savedMode = db.getSetting('mode') || 'DEMO';
  config.mode = savedMode;
  console.log(`[UNDERDOG] Mode: ${config.mode}`);
  console.log(`[UNDERDOG] Balance: $${(db.getBalance()).toFixed(2)}`);
  if (db.getBalance() > 100000) {
    db.setBalance(10000);
    console.log('[UNDERDOG] Balance reset to $10000.00 (was corrupted)');
  }

  pipeline.connect();
  tradeManager.start();

  if (config.binance?.apiKey) {
    const connected = await binanceExecutor.connect();
    if (connected) {
      config.mode = 'LIVE';
      oms.setMode('LIVE');
      broadcast({ type: 'MODE_CHANGE', mode: 'LIVE' });

      console.log('[UNDERDOG] Loading historical candles...');
      for (const sym of ['BTCUSD', 'XAUUSD']) {
        try {
          const klines = await binanceExecutor.getKlines(sym, '1m', 500);
          if (klines && klines.length > 0) {
            candleFactory.loadHistoricalCandles(sym, klines);
          }
        } catch (e) {
          console.log(`[UNDERDOG] Failed to load candles for ${sym}: ${e.message}`);
        }
      }

      const info = await binanceExecutor.getAccountInfo();
      broadcast({ type: 'BINANCE_STATUS', connected: true, mode: 'LIVE', account: info });
      broadcast({ type: 'INIT', config, balance: info.balance, stats: db.getStats(), positions: db.getOpenPositions(), candles: { BTCUSD: candleFactory.getAllTimeframeHistory('BTCUSD'), XAUUSD: candleFactory.getAllTimeframeHistory('XAUUSD') } });
      setInterval(async () => {
        if (binanceExecutor.isEnabled()) {
          const info = await binanceExecutor.getAccountInfo();
          broadcast({ type: 'BINANCE_STATUS', connected: true, mode: 'LIVE', account: info });
        }
      }, 10000);
    }
  }

  server.listen(config.server.httpPort, () => {
    console.log(`[UNDERDOG] HTTP API on port ${config.server.httpPort}`);
    console.log(`[UNDERDOG] WebSocket on port ${config.server.wsPort}`);
    console.log('[UNDERDOG] Terminal ONLINE');
    if (config.binance?.apiKey) {
      console.log(`[UNDERDOG] Binance ${config.binance.testnet ? 'TESTNET' : 'LIVE'} ENABLED`);
    } else {
      console.log('[UNDERDOG] Binance: Not configured (DEMO mode only)');
    }
  });
}

start().catch(err => {
  console.error('[UNDERDOG] Fatal error:', err);
  process.exit(1);
});
