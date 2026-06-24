class CandleFactory {
  constructor(config, broadcast) {
    this.config = config;
    this.broadcast = broadcast;
    this.baseTimeframeMs = (config.candle.timeframeMinutes || 1) * 60000;
    this.maxCandles = config.candle.maxCandlesStored || 500;

    this.timeframes = {
      M1: 1 * 60000,
      M2: 2 * 60000,
      M5: 5 * 60000,
      M15: 15 * 60000,
      M30: 30 * 60000,
      H1: 60 * 60000,
      H4: 240 * 60000,
      D1: 1440 * 60000
    };

    this.candles = {};
    this.liveBars = {};
    this.atrBuffers = {};
    this.volumeBuffers = {};
    this.priceBuffers = {};
    this.spreadHistory = {};
    this.tickAccumulator = {};
    this.orderBooks = {};

    for (const sym of ['BTCUSD', 'XAUUSD']) {
      this.candles[sym] = {};
      this.liveBars[sym] = {};
      this.atrBuffers[sym] = {};
      this.volumeBuffers[sym] = [];
      this.priceBuffers[sym] = [];
      this.spreadHistory[sym] = [];
      this.tickAccumulator[sym] = { buyTicks: 0, sellTicks: 0, totalTicks: 0, lastReset: Date.now() };
      this.orderBooks[sym] = { bids: [], asks: [] };

      for (const [tf, ms] of Object.entries(this.timeframes)) {
        this.candles[sym][tf] = { current: null, history: [] };
        this.liveBars[sym][tf] = null;
        this.atrBuffers[sym][tf] = [];
      }
    }

    this.onCandleComplete = null;
    this.onTick = null;
  }

  processInboundTick(tick) {
    const symbol = tick.symbol;
    if (!this.candles[symbol]) return;

    if (this.onTick) this.onTick(symbol, tick);

    this._accumulateTick(symbol, tick);

    for (const [tf, ms] of Object.entries(this.timeframes)) {
      const timestamp = Math.floor(tick.time / ms) * ms;
      const state = this.candles[symbol][tf];

      if (!state.current || state.current.timestamp !== timestamp) {
        if (state.current && state.current.timestamp !== null) {
          this._finalizeCandle(symbol, tf, state.current);
        }
        state.current = {
          open: tick.price,
          high: tick.price,
          low: tick.price,
          close: tick.price,
          volume: tick.size,
          buyVolume: tick.side === 'BUY' ? tick.size : 0,
          sellVolume: tick.side === 'SELL' ? tick.size : 0,
          volumeDelta: 0,
          timestamp: timestamp,
          tickCount: 1,
          buyTicks: tick.side === 'BUY' ? 1 : 0,
          sellTicks: tick.side === 'SELL' ? 1 : 0
        };
      } else {
        const c = state.current;
        if (tick.price > c.high) c.high = tick.price;
        if (tick.price < c.low) c.low = tick.price;
        c.close = tick.price;
        c.volume += tick.size;
        c.tickCount++;
        if (tick.side === 'BUY') {
          c.buyVolume += tick.size;
          c.buyTicks++;
        } else {
          c.sellVolume += tick.size;
          c.sellTicks++;
        }
      }

      state.current.volumeDelta = state.current.buyVolume - state.current.sellVolume;
      this.liveBars[symbol][tf] = { ...state.current };
    }

    this._updatePriceBuffer(symbol, tick.price);

    this.broadcast({
      type: 'LIVE_CANDLE',
      symbol: symbol,
      candle: this.liveBars[symbol]['M1'],
      price: tick.price,
      side: tick.side,
      time: tick.time
    });

    for (const tf of Object.keys(this.timeframes)) {
      if (tf === 'M1') continue;
      this.broadcast({
        type: 'LIVE_CANDLE_TF',
        symbol: symbol,
        timeframe: tf,
        candle: this.liveBars[symbol][tf],
        price: tick.price,
        time: tick.time
      });
    }
  }

  _accumulateTick(symbol, tick) {
    const acc = this.tickAccumulator[symbol];
    acc.totalTicks++;
    if (tick.side === 'BUY') acc.buyTicks++;
    else acc.sellTicks++;

    if (Date.now() - acc.lastReset > 5000) {
      const buyRatio = acc.totalTicks > 0 ? acc.buyTicks / acc.totalTicks : 0.5;
      this.broadcast({
        type: 'TICK_FLOW',
        symbol: symbol,
        buyRatio: buyRatio,
        totalTicks: acc.totalTicks,
        buyTicks: acc.buyTicks,
        sellTicks: acc.sellTicks,
        pressure: buyRatio > 0.6 ? 'BUY' : buyRatio < 0.4 ? 'SELL' : 'NEUTRAL'
      });
      this.tickAccumulator[symbol] = { buyTicks: 0, sellTicks: 0, totalTicks: 0, lastReset: Date.now() };
    }
  }

  _updatePriceBuffer(symbol, price) {
    const buf = this.priceBuffers[symbol];
    buf.push(price);
    if (buf.length > 100) buf.shift();
  }

  _finalizeCandle(symbol, tf, candle) {
    const state = this.candles[symbol][tf];
    state.history.push({ ...candle });
    if (state.history.length > this.maxCandles) {
      state.history.shift();
    }

    if (tf === 'M1') {
      this._updateATR(symbol, tf, candle);
      const volBuf = this.volumeBuffers[symbol];
      volBuf.push(candle.volume);
      if (volBuf.length > 100) volBuf.shift();
      const volSpike = this.detectVolumeSpike(symbol);
      this.broadcast({
        type: 'COMPLETED_CANDLE',
        symbol: symbol,
        timeframe: tf,
        candle: candle,
        volSpike: volSpike
      });
    } else {
      this._updateATR(symbol, tf, candle);
      this.broadcast({
        type: 'COMPLETED_CANDLE_TF',
        symbol: symbol,
        timeframe: tf,
        candle: candle
      });
    }

    if (tf === 'M1' && this.onCandleComplete) {
      this.onCandleComplete(symbol, candle);
    }
  }

  _updateATR(symbol, tf, candle) {
    const buf = this.atrBuffers[symbol][tf];
    const tr = candle.high - candle.low;
    buf.push(tr);
    if (buf.length > 14) buf.shift();
  }

  getATR(symbol, tf = 'M1') {
    const buf = this.atrBuffers[symbol]?.[tf];
    if (!buf || buf.length === 0) return 0;
    return buf.reduce((s, v) => s + v, 0) / buf.length;
  }

  getHistory(symbol, tf = 'M1') {
    return this.candles[symbol]?.[tf] ? this.candles[symbol][tf].history : [];
  }

  loadHistoricalCandles(symbol, klines) {
    if (!klines || klines.length === 0) return 0;
    let count = 0;
    for (const k of klines) {
      const candle = {
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        buyVolume: parseFloat(k[5]) * 0.5,
        sellVolume: parseFloat(k[5]) * 0.5,
        volumeDelta: 0,
        timestamp: k[0],
        tickCount: 1,
        buyTicks: 1,
        sellTicks: 1
      };
      this._finalizeCandle(symbol, 'M1', candle);
      count++;
    }
    console.log(`[CANDLE] Loaded ${count} historical candles for ${symbol}`);
    return count;
  }

  getAllTimeframeHistory(symbol) {
    const result = {};
    for (const tf of Object.keys(this.timeframes)) {
      result[tf] = this.getHistory(symbol, tf);
    }
    return result;
  }

  getLiveBar(symbol, tf = 'M1') {
    return this.liveBars[symbol]?.[tf] || null;
  }

  getPreviousBar(symbol, tf = 'M1') {
    const hist = this.candles[symbol]?.[tf]?.history;
    if (!hist || hist.length < 2) return null;
    return hist[hist.length - 1];
  }

  getRecentBars(symbol, count, tf = 'M1') {
    const hist = this.candles[symbol]?.[tf]?.history;
    if (!hist) return [];
    return hist.slice(-count);
  }

  getLocalRange(symbol, lookback = 20, tf = 'M1') {
    const bars = this.getRecentBars(symbol, lookback, tf);
    if (bars.length === 0) return { high: 0, low: 0 };
    let high = -Infinity, low = Infinity;
    for (const b of bars) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
    }
    return { high, low };
  }

  detectVolumeSpike(symbol) {
    const buf = this.volumeBuffers[symbol];
    if (!buf || buf.length < 20) return { isSpike: false, ratio: 0 };

    const currentVol = buf[buf.length - 1] || 0;
    const recentAvg = buf.slice(-20).reduce((s, v) => s + v, 0) / 20;
    const ratio = recentAvg > 0 ? currentVol / recentAvg : 0;

    return {
      isSpike: ratio > 2.5,
      ratio: ratio,
      currentVol: currentVol,
      avgVol: recentAvg
    };
  }

  getVolatilityScore(symbol) {
    const priceBuf = this.priceBuffers[symbol];
    if (!priceBuf || priceBuf.length < 10) return 0;

    const recent = priceBuf.slice(-10);
    let changes = [];
    for (let i = 1; i < recent.length; i++) {
      changes.push(Math.abs(recent[i] - recent[i - 1]) / recent[i - 1]);
    }
    const avgChange = changes.reduce((s, v) => s + v, 0) / changes.length;
    return avgChange * 10000;
  }

  getSpreadStats(symbol) {
    const buf = this.spreadHistory[symbol];
    if (!buf || buf.length === 0) return { avg: 0, min: 0, max: 0 };
    const sorted = [...buf].sort((a, b) => a - b);
    const avg = buf.reduce((s, v) => s + v, 0) / buf.length;
    return {
      avg: avg,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      current: buf[buf.length - 1]
    };
  }

  updateOrderBook(symbol, data) {
    if (!this.orderBooks[symbol]) return;
    if (data.bids) this.orderBooks[symbol].bids = data.bids;
    if (data.asks) this.orderBooks[symbol].asks = data.asks;

    const obi = this.calculateOBI(symbol);
    const wallInfo = this.detectWalls(symbol);

    this.broadcast({
      type: 'ORDER_BOOK_UPDATE',
      symbol: symbol,
      obi: obi,
      bidDepth: this.orderBooks[symbol].bids.slice(0, 10),
      askDepth: this.orderBooks[symbol].asks.slice(0, 10),
      walls: wallInfo
    });
  }

  detectWalls(symbol) {
    const ob = this.orderBooks[symbol];
    if (!ob) return { bidWalls: [], askWalls: [] };

    const bidVols = ob.bids.slice(0, 20).map(b => b.volume || b[1] || 0);
    const askVols = ob.asks.slice(0, 20).map(a => a.volume || a[1] || 0);

    const avgBidVol = bidVols.length > 0 ? bidVols.reduce((s, v) => s + v, 0) / bidVols.length : 0;
    const avgAskVol = askVols.length > 0 ? askVols.reduce((s, v) => s + v, 0) / askVols.length : 0;

    const bidWalls = [];
    const askWalls = [];

    ob.bids.slice(0, 20).forEach((b) => {
      const vol = b.volume || b[1] || 0;
      if (vol > avgBidVol * 2.5 && vol > 0) {
        bidWalls.push({ price: b.price || b[0], volume: vol, ratio: vol / (avgBidVol || 1) });
      }
    });

    ob.asks.slice(0, 20).forEach((a) => {
      const vol = a.volume || a[1] || 0;
      if (vol > avgAskVol * 2.5 && vol > 0) {
        askWalls.push({ price: a.price || a[0], volume: vol, ratio: vol / (avgAskVol || 1) });
      }
    });

    return { bidWalls, askWalls };
  }

  calculateOBI(symbol) {
    const ob = this.orderBooks[symbol];
    if (ob && (ob.bids.length > 0 || ob.asks.length > 0)) {
      const topBids = ob.bids.slice(0, 10);
      const topAsks = ob.asks.slice(0, 10);
      const bidVol = topBids.reduce((s, b) => s + (b.volume || b[1] || 0), 0);
      const askVol = topAsks.reduce((s, a) => s + (a.volume || a[1] || 0), 0);
      const total = bidVol + askVol;
      if (total > 0) return (bidVol - askVol) / total;
    }

    const ta = this.tickAccumulator[symbol];
    if (ta && ta.totalTicks > 10) {
      return (ta.buyTicks - ta.sellTicks) / ta.totalTicks;
    }

    const hist = this.candles[symbol]?.M1?.history;
    if (hist && hist.length >= 5) {
      const recent = hist.slice(-5);
      let totalDelta = 0;
      for (const c of recent) {
        totalDelta += (c.volumeDelta || 0);
      }
      const maxVol = Math.max(...recent.map(c => c.volume || 1));
      if (maxVol > 0) return totalDelta / (maxVol * 5);
    }

    return 0;
  }

  getMultiTimeframeATR(symbol) {
    const result = {};
    for (const [tf, ms] of Object.entries(this.timeframes)) {
      result[tf] = this.getATR(symbol, tf);
    }
    return result;
  }
}

module.exports = CandleFactory;
