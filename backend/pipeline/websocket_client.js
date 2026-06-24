const WebSocket = require('ws');

class FreeDataPipeline {
  constructor(symbols, candleFactory, broadcast) {
    this.symbols = symbols;
    this.candleFactory = candleFactory;
    this.broadcast = broadcast;
    this.connections = {};
    this.reconnectTimers = {};
    this.pingIntervals = {};
    this.tickCount = {};
    this.lastTickTime = {};
    this.lastPrice = {};
    this.connectedTime = {};
    this.onTick = null;

    for (const sym of Object.keys(symbols)) {
      this.tickCount[sym] = 0;
      this.lastTickTime[sym] = 0;
      this.lastPrice[sym] = 0;
      this.connectedTime[sym] = 0;
    }
  }

  connect() {
    for (const [symbol, symConfig] of Object.entries(this.symbols)) {
      this.connectSymbol(symbol, symConfig);
    }
  }

  connectSymbol(symbol, symConfig) {
    clearTimeout(this.reconnectTimers[symbol]);
    this._stopPing(symbol);

    if (this.connections[symbol]) {
      try {
        const old = this.connections[symbol];
        old.removeAllListeners();
        if (old.readyState === WebSocket.OPEN || old.readyState === WebSocket.CONNECTING) {
          old.close(1000);
        }
      } catch (e) {}
      this.connections[symbol] = null;
    }

    const url = symConfig.wsUrl;
    if (!url) {
      console.log(`[PIPELINE] ${symbol}: No WS URL, skipping.`);
      return;
    }

    console.log(`[PIPELINE] Connecting ${symbol}: ${url}`);

    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      console.error(`[PIPELINE] ${symbol} connect error:`, e.message);
      this.reconnectTimers[symbol] = setTimeout(() => this.connectSymbol(symbol, symConfig), 5000);
      return;
    }

    this.connections[symbol] = ws;

    ws.on('open', () => {
      console.log(`[PIPELINE] ${symbol} CONNECTED`);
      this.connectedTime[symbol] = Date.now();
      this.broadcast({ type: 'STREAM_STATUS', symbol, connected: true });
      this._startPing(symbol);
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw);

        if (data.e === 'trade') {
          this._handleTrade(symbol, data);
        } else if (data.e === '24hrMiniTicker' || data.e === '24hrTicker') {
          this._handleTicker(symbol, data);
        }
      } catch (e) {}
    });

    ws.on('close', (code) => {
      console.log(`[PIPELINE] ${symbol} closed (code:${code})`);
      this.broadcast({ type: 'STREAM_STATUS', symbol, connected: false });
      this._stopPing(symbol);
      this.connections[symbol] = null;
      const delay = code === 1006 ? 5000 : 2000;
      this.reconnectTimers[symbol] = setTimeout(() => this.connectSymbol(symbol, symConfig), delay);
    });

    ws.on('error', (err) => {
      console.error(`[PIPELINE] ${symbol} error:`, err.message);
    });

    ws.on('ping', (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.pong(data); } catch (e) {}
      }
    });
  }

  _handleTrade(symbol, data) {
    const rawPrice = parseFloat(data.p);
    const offset = this.symbols[symbol]?.priceOffset || 0;
    const parsed = {
      symbol: symbol,
      price: rawPrice + offset,
      rawPrice: rawPrice,
      size: parseFloat(data.q),
      side: data.m ? 'SELL' : 'BUY',
      time: data.E
    };
    this.lastPrice[symbol] = parsed.price;
    this._processTick(symbol, parsed);
  }

  _handleTicker(symbol, data) {
    const currentPrice = parseFloat(data.c);
    if (isNaN(currentPrice) || currentPrice === 0) return;

    const offset = this.symbols[symbol]?.priceOffset || 0;
    const adjustedPrice = currentPrice + offset;

    const prevPrice = this.lastPrice[symbol] || adjustedPrice;
    const side = adjustedPrice >= prevPrice ? 'BUY' : 'SELL';
    this.lastPrice[symbol] = adjustedPrice;

    const parsed = {
      symbol: symbol,
      price: adjustedPrice,
      rawPrice: currentPrice,
      size: parseFloat(data.v || 0),
      side: side,
      time: data.E || Date.now()
    };
    this._processTick(symbol, parsed);
  }

  _processTick(symbol, parsed) {
    this.tickCount[symbol]++;
    this.lastTickTime[symbol] = Date.now();
    this.candleFactory.processInboundTick(parsed);
    if (this.onTick) this.onTick(symbol, parsed.price, parsed.side);
  }

  _startPing(symbol) {
    this._stopPing(symbol);
    this.pingIntervals[symbol] = setInterval(() => {
      const ws = this.connections[symbol];
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.ping(); } catch (e) {}
      }
    }, 60000);
  }

  _stopPing(symbol) {
    if (this.pingIntervals[symbol]) {
      clearInterval(this.pingIntervals[symbol]);
      this.pingIntervals[symbol] = null;
    }
  }

  getStats() {
    const now = Date.now();
    const stats = {};
    for (const symbol of Object.keys(this.symbols)) {
      const ws = this.connections[symbol];
      const isConnected = ws && ws.readyState === WebSocket.OPEN;
      stats[symbol] = {
        connected: isConnected,
        ticks: this.tickCount[symbol] || 0,
        lastPrice: this.lastPrice[symbol] || 0,
        lastAge: this.lastTickTime[symbol] > 0 ? now - this.lastTickTime[symbol] : null,
        connectedFor: this.connectedTime[symbol] > 0 ? now - this.connectedTime[symbol] : 0
      };
    }
    return stats;
  }

  disconnect() {
    for (const symbol of Object.keys(this.symbols)) {
      clearTimeout(this.reconnectTimers[symbol]);
      this._stopPing(symbol);
      if (this.connections[symbol]) {
        try { this.connections[symbol].close(1000); } catch (e) {}
      }
    }
  }
}

module.exports = FreeDataPipeline;
