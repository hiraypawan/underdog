const { evaluateCapitalProtection, checkStopLossHit, calculatePnL } = require('./risk_manager');

class TradeManager {
  constructor(config, candleFactory, strategyManager, oms, db, broadcast) {
    this.config = config;
    this.candleFactory = candleFactory;
    this.strategyManager = strategyManager;
    this.oms = oms;
    this.db = db;
    this.broadcast = broadcast;
    this.currentPrices = { BTCUSD: { bid: 0, ask: 0, mid: 0 }, XAUUSD: { bid: 0, ask: 0, mid: 0 } };
    this.running = false;
    this.tickCounter = 0;
    this.lastSignalTime = {};
    this.sessionStats = {
      BTCUSD: { signals: 0, trades: 0, wins: 0, losses: 0 },
      XAUUSD: { signals: 0, trades: 0, wins: 0, losses: 0 }
    };
    this._closingPositions = new Set();
    this._volatilityCircuitBreaker = { BTCUSD: false, XAUUSD: false };
    this._consecutiveLosses = { BTCUSD: 0, XAUUSD: 0 };
    this._pauseUntil = { BTCUSD: 0, XAUUSD: 0 };
    this._recentATRs = { BTCUSD: [], XAUUSD: [] };
  }

  start() {
    this.running = true;
    this.candleFactory.onCandleComplete = (symbol, candle) => {
      this._onCandleComplete(symbol, candle);
    };
    console.log('[TRADE_MANAGER] Started — wired to candle factory');
  }

  stop() {
    this.running = false;
    this.candleFactory.onCandleComplete = null;
    console.log('[TRADE_MANAGER] Stopped');
  }

  onTick(symbol, price, side) {
    const symConfig = this.config.symbols[symbol];
    if (!symConfig) return;

    const pipSize = symConfig.pipSize || 0.01;
    const spreadPips = symConfig.spreadPips || 100;
    const spread = spreadPips * pipSize;

    this.currentPrices[symbol] = {
      bid: side === 'BUY' ? price : price - spread / 2,
      ask: side === 'BUY' ? price + spread / 2 : price,
      mid: price,
      spread: spread,
      time: Date.now()
    };

    if (!this.running) return;

    this.tickCounter++;
    this._manageOpenPositions(symbol);

    if (this.tickCounter % 15 === 0) {
      this._evaluateStrategies(symbol);
    }

    if (this.tickCounter % 100 === 0) {
      this._broadcastLivePnL();
    }
  }

  _onCandleComplete(symbol, candle) {
    if (!this.running) return;

    const volSpike = this.candleFactory.detectVolumeSpike(symbol);
    if (volSpike.isSpike) {
      this.broadcast({
        type: 'VOLUME_SPIKE',
        symbol: symbol,
        ratio: volSpike.ratio,
        currentVol: volSpike.currentVol,
        avgVol: volSpike.avgVol
      });
    }

    this._evaluateStrategies(symbol);
  }

  _manageOpenPositions(symbol) {
    try {
      const positions = this.db.getOpenPositions().filter(p => p.symbol === symbol);
      const prices = this.currentPrices[symbol];
      if (!prices || prices.mid === 0) return;

      for (const pos of positions) {
        if (this._closingPositions.has(pos.ticket)) continue;

        if (checkStopLossHit(pos, prices.bid, prices.ask)) {
          this._closingPositions.add(pos.ticket);
          this.oms.closePosition(pos.ticket, pos.symbol, pos.direction, pos.lots).then(result => {
            const closePrice = (result && result.status === 'SUCCESS' && result.closePrice > 0) ? result.closePrice : prices.mid;
            const pnl = calculatePnL(pos, closePrice, closePrice);
            this.db.closePosition(pos.ticket, closePrice, pnl);
            if (pnl >= 0) { this.sessionStats[symbol].wins++; } else {
              this.sessionStats[symbol].losses++;
              this._consecutiveLosses[symbol]++;
              if (this._consecutiveLosses[symbol] >= 3) {
                this._pauseUntil[symbol] = Date.now() + 300000;
                this._consecutiveLosses[symbol] = 0;
                console.log(`[TRADE_MANAGER] PAUSE: ${symbol} — 3 consecutive losses, 5min cooldown`);
              }
            }
            if (pnl >= 0) this._consecutiveLosses[symbol] = 0;
            this.broadcast({
              type: 'POSITION_CLOSED', ticket: pos.ticket,
              closePrice, pnl, reason: 'STOP_LOSS',
              symbol, direction: pos.direction, tag: pos.comment,
              lots: pos.lots, entryPrice: pos.open_price
            });
          }).catch(() => {
            const pnl = calculatePnL(pos, prices.mid, prices.mid);
            this.db.closePosition(pos.ticket, prices.mid, pnl);
            if (pnl < 0) {
              this._consecutiveLosses[symbol]++;
              if (this._consecutiveLosses[symbol] >= 3) {
                this._pauseUntil[symbol] = Date.now() + 300000;
                this._consecutiveLosses[symbol] = 0;
              }
            } else {
              this._consecutiveLosses[symbol] = 0;
            }
            this.broadcast({
              type: 'POSITION_CLOSED', ticket: pos.ticket,
              closePrice: prices.mid, pnl, reason: 'STOP_LOSS',
              symbol, direction: pos.direction, tag: pos.comment,
              lots: pos.lots, entryPrice: pos.open_price
            });
          }).finally(() => {
            this._closingPositions.delete(pos.ticket);
          });
          continue;
        }

        if (pos.tp && parseFloat(pos.tp) > 0) {
          let tpHit = false;
          if (pos.direction === 'BUY' && prices.bid >= parseFloat(pos.tp)) tpHit = true;
          if (pos.direction === 'SELL' && prices.ask <= parseFloat(pos.tp)) tpHit = true;
          if (tpHit) {
            this._closingPositions.add(pos.ticket);
            this.oms.closePosition(pos.ticket, pos.symbol, pos.direction, pos.lots).then(result => {
              const closePrice = (result && result.status === 'SUCCESS' && result.closePrice > 0) ? result.closePrice : prices.mid;
              const pnl = calculatePnL(pos, closePrice, closePrice);
              this.db.closePosition(pos.ticket, closePrice, pnl);
              this.sessionStats[symbol].wins++;
              this.broadcast({
                type: 'POSITION_CLOSED', ticket: pos.ticket,
                closePrice, pnl, reason: 'TAKE_PROFIT',
                symbol, direction: pos.direction, tag: pos.comment,
                lots: pos.lots, entryPrice: pos.open_price
              });
              console.log(`[TRADE_MANAGER] TP HIT: ${pos.direction} ${symbol} @ ${closePrice.toFixed(2)} | PnL: ${pnl.toFixed(4)} | Tag: ${pos.comment}`);
            }).catch(() => {
              const pnl = calculatePnL(pos, prices.mid, prices.mid);
              this.db.closePosition(pos.ticket, prices.mid, pnl);
              this.broadcast({
                type: 'POSITION_CLOSED', ticket: pos.ticket,
                closePrice: prices.mid, pnl, reason: 'TAKE_PROFIT',
                symbol, direction: pos.direction, tag: pos.comment,
                lots: pos.lots, entryPrice: pos.open_price
              });
            }).finally(() => {
              this._closingPositions.delete(pos.ticket);
            });
            continue;
          }
        }

        const pipSize = this.config.symbols[symbol]?.pipSize || 0.01;
      }
    } catch (err) {
      console.error(`[TRADE_MANAGER] Error managing positions for ${symbol}:`, err.message);
    }
  }

  _evaluateStrategies(symbol) {
    const positions = this.db.getOpenPositions().filter(p => p.symbol === symbol);
    if (positions.length >= this.config.risk.maxOpenPositions) return;

    if (this.config.symbols[symbol]?.tradingDisabled) return;

    const prices = this.currentPrices[symbol];
    if (!prices || prices.mid === 0) return;

    const volScore = this.candleFactory.getVolatilityScore(symbol);

    if (volScore > 15) {
      if (!this._volatilityCircuitBreaker[symbol]) {
        this._volatilityCircuitBreaker[symbol] = true;
        this.broadcast({ type: 'VOLATILITY_BREAKER', symbol, activated: true, score: volScore });
      }
      return;
    } else if (this._volatilityCircuitBreaker[symbol] && volScore < 8) {
      this._volatilityCircuitBreaker[symbol] = false;
      this.broadcast({ type: 'VOLATILITY_BREAKER', symbol, activated: false, score: volScore });
    }

    const now = Date.now();

    if (this._pauseUntil[symbol] && now < this._pauseUntil[symbol]) {
      console.log(`[TRADE_MANAGER] PAUSED ${symbol} until ${new Date(this._pauseUntil[symbol]).toLocaleTimeString()}`);
      return;
    }

    const liveBar = this.candleFactory.getLiveBar(symbol);
    const prevBar = this.candleFactory.getPreviousBar(symbol);
    const atr = this.candleFactory.getATR(symbol);
    const localRange = this.candleFactory.getLocalRange(symbol, this.config.strategies.Trap?.LocalRangeLookback || 15);
    const obi = this.candleFactory.calculateOBI(symbol);

    if (!liveBar || !prevBar || !atr || atr === 0) return;

    if (atr < 10) return;

    const recentBars = this.candleFactory.getRecentBars(symbol, 20);
    this.strategyManager.setRecentBars(symbol, recentBars);

    const signal = this.strategyManager.evaluateAll(symbol, liveBar, prevBar, atr, localRange, prices.bid, prices.ask, obi);
    if (!signal) return;

    this.sessionStats[symbol].signals++;

    if (this.lastSignalTime[symbol] && (now - this.lastSignalTime[symbol]) < 30000) return;

    if (signal.score < 1.3) return;

    const m15Bars = this.candleFactory.getRecentBars(symbol, 20, 'M15');
    const m15Live = this.candleFactory.getLiveBar(symbol, 'M15');
    const m15All = [...(m15Bars || [])];
    if (m15Live) m15All.push(m15Live);

    if (m15All.length >= 3) {
      const last3 = m15All.slice(-3);
      let bullish = 0;
      let bearish = 0;
      for (const bar of last3) {
        if (bar.close > bar.open) bullish++;
        else if (bar.close < bar.open) bearish++;
      }
      const trend = bullish >= 2 ? 'BUY' : bearish >= 2 ? 'SELL' : 'NEUTRAL';
      if (trend !== 'NEUTRAL' && signal.direction !== trend) return;

      if (m15All.length >= 8) {
        const closes = m15All.map(b => b.close);
        const sma8 = closes.slice(-8).reduce((s, v) => s + v, 0) / 8;
        const sma20 = closes.slice(-20).reduce((s, v) => s + v, 0) / Math.min(closes.length, 20);
        if (signal.direction === 'BUY' && sma8 < sma20) return;
        if (signal.direction === 'SELL' && sma8 > sma20) return;
      }
    }

    const balance = this.db.getBalance();
    const pipSize = this.config.symbols[symbol]?.pipSize || 0.01;
    const slPips = Math.round(atr * 2.0 / pipSize);
    const slDistance = slPips * pipSize;
    const maxRiskDollars = 5;
    const lots = Math.max(0.001, Math.round((maxRiskDollars / slDistance) * 1000) / 1000);

    if (lots > 0.05) return;

    let sl = 0;
    let tp = 0;
    if (signal.direction === 'BUY') {
      sl = prices.mid - slDistance;
      tp = prices.mid + slDistance * 2.0;
    } else {
      sl = prices.mid + slDistance;
      tp = prices.mid - slDistance * 2.0;
    }

    this.lastSignalTime[symbol] = now;

    const orderParams = {
      symbol: symbol,
      direction: signal.direction,
      lots: lots,
      targetPrice: signal.direction === 'BUY' ? prices.ask : prices.bid,
      sl: sl,
      tp: tp,
      comment: signal.tag,
      pointValue: pipSize
    };

    console.log(`[TRADE_MANAGER] SIGNAL: ${signal.direction} ${symbol} | Tag: ${signal.tag} | Score: ${signal.score.toFixed(2)} | OBI: ${obi.toFixed(3)} | ATR: ${atr.toFixed(2)} | M15: ${m15Trend} | Lots: ${lots} | Risk: $${(lots * slDistance).toFixed(2)}`);

    this.oms.executeOrder(orderParams).then(result => {
      if (result.status === 'SUCCESS') {
        this.strategyManager.setCooldown(symbol, signal.tag, 120000);
        this.sessionStats[symbol].trades++;
        this.broadcast({
          type: 'TRADE_OPENED',
          ticket: result.ticket,
          symbol: symbol,
          direction: signal.direction,
          lots: lots,
          price: result.executionPrice,
          sl: sl,
          tp: tp,
          slPips: slPips,
          tag: signal.tag,
          signal: signal,
          volSpike: this.candleFactory.detectVolumeSpike(symbol).isSpike,
          obi: obi
        });
        console.log(`[TRADE_MANAGER] OPENED: ${signal.direction} ${lots} ${symbol} @ ${result.executionPrice.toFixed(2)} | SL: ${sl.toFixed(2)} | TP: ${tp.toFixed(2)} (${slPips} pips) | Tag: ${signal.tag}`);
      }
    }).catch(err => {
      console.error(`[TRADE_MANAGER] Order execution error:`, err.message);
    });
  }

  _broadcastLivePnL() {
    const positions = this.db.getOpenPositions();
    const pnlMap = {};

    for (const pos of positions) {
      const prices = this.currentPrices[pos.symbol];
      if (!prices || prices.mid === 0) continue;
      pnlMap[pos.ticket] = calculatePnL(pos, prices.bid, prices.ask);
    }

    this.broadcast({ type: 'LIVE_PNL', pnlMap, prices: this.currentPrices });
  }

  getCurrentPrice(symbol) {
    const p = this.currentPrices[symbol];
    return p ? p.mid : null;
  }

  getSessionStats() {
    return this.sessionStats;
  }
}

module.exports = TradeManager;
