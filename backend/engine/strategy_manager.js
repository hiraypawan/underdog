class StrategyManager {
  constructor(config) {
    this.config = config;
    this.cooldowns = { BTCUSD: {}, XAUUSD: {} };
    this._recentBars = { BTCUSD: [], XAUUSD: [] };
    this._lastSignals = { BTCUSD: null, XAUUSD: null };
  }

  setRecentBars(symbol, bars) {
    this._recentBars[symbol] = bars;
  }

  isOn(name) {
    const s = this.config[name];
    return s && s.enabled === true;
  }

  isInCooldown(symbol, tag) {
    const cd = this.cooldowns[symbol]?.[tag];
    if (!cd) return false;
    return Date.now() < cd;
  }

  setCooldown(symbol, tag, ms = 30000) {
    if (!this.cooldowns[symbol]) this.cooldowns[symbol] = {};
    this.cooldowns[symbol][tag] = Date.now() + ms;
  }

  evaluateAll(symbol, liveBar, prevBar, atr, localRange, currentBid, currentAsk, obi) {
    if (!liveBar || !prevBar || !atr || atr === 0) return null;

    const signals = [];

    if (this.isOn('Momentum')) {
      const mom = this.evaluateMomentum(liveBar, prevBar, obi, atr);
      if (mom.signal && !this.isInCooldown(symbol, 'MOM')) {
        signals.push(mom);
      }
    }

    if (this.isOn('Trap')) {
      const trap = this.evaluateTrap(liveBar, localRange.high, localRange.low, obi, atr);
      if (trap.signal && !this.isInCooldown(symbol, 'TRAP')) {
        signals.push(trap);
      }
    }

    if (this.isOn('WickThief')) {
      const wick = this.evaluateWickThief(liveBar, atr, liveBar.volumeDelta, obi);
      if (wick.signal && !this.isInCooldown(symbol, 'WICK')) {
        signals.push(wick);
      }
    }

    if (this.isOn('Compression')) {
      const bars = this._recentBars[symbol] || [];
      if (bars.length >= (this.config.Compression?.CompCoilBars || 5)) {
        const comp = this.evaluateCompression(bars, currentAsk, currentBid, localRange.high, localRange.low, obi, atr);
        if (comp.signal && !this.isInCooldown(symbol, 'COMP')) {
          signals.push(comp);
        }
      }
    }

    if (this.isOn('FlowReversal')) {
      const flow = this.evaluateFlowReversal(liveBar, prevBar, obi, atr);
      if (flow.signal && !this.isInCooldown(symbol, 'FLOW')) {
        signals.push(flow);
      }
    }

    if (signals.length === 0) return null;

    signals.sort((a, b) => b.score - a.score);
    const best = signals[0];
    best.score = Math.min(best.score, 3.0);
    best.symbol = symbol;
    best.timestamp = Date.now();
    best.price = currentBid;
    best.obi = obi || 0;

    this._lastSignals[symbol] = best;

    return best;
  }

  evaluateMomentum(liveBar, prevBar, obi, atr) {
    const prevBody = Math.abs(prevBar.close - prevBar.open);
    const liveBody = Math.abs(liveBar.close - liveBar.open);

    if (prevBody === 0 || atr === 0) return { signal: false };

    const expansion = liveBody / prevBody;
    const barRange = liveBar.high - liveBar.low;
    if (barRange === 0) return { signal: false };

    const bodyRatio = liveBody / barRange;
    const deltaAligned = liveBar.volumeDelta * prevBar.volumeDelta > 0;

    const minExpansion = Math.max(1.4, this.config.Momentum?.MomMultiplier || 1.4);
    if (expansion < minExpansion) return { signal: false };
    if (bodyRatio < 0.4) return { signal: false };

    if (barRange < atr * 0.3) return { signal: false };

    const direction = liveBar.close > liveBar.open ? 'BUY' : 'SELL';
    let score = expansion / minExpansion;

    if (deltaAligned) score *= 1.3;
    if (liveBar.volumeDelta > 0 && direction === 'BUY') score *= 1.2;
    if (liveBar.volumeDelta < 0 && direction === 'SELL') score *= 1.2;

    if (obi > 0.15 && direction === 'BUY') score *= 1.4;
    if (obi < -0.15 && direction === 'SELL') score *= 1.4;
    if (obi < -0.3 && direction === 'BUY') return { signal: false };
    if (obi > 0.3 && direction === 'SELL') return { signal: false };

    return { signal: true, direction, tag: 'MOM', score, meta: { expansion: expansion.toFixed(2), bodyRatio: bodyRatio.toFixed(3) } };
  }

  evaluateTrap(liveBar, localRangeHigh, localRangeLow, obi, atr) {
    const barRange = liveBar.high - liveBar.low;
    if (barRange === 0 || atr === 0) return { signal: false };

    const wickRatio = 0.55;
    const bodyRatio = Math.abs(liveBar.close - liveBar.open) / barRange;
    if (bodyRatio > 0.35) return { signal: false };
    if (barRange < atr * 0.25) return { signal: false };

    if (liveBar.low < localRangeLow && liveBar.close > liveBar.open) {
      const lowerWick = Math.min(liveBar.open, liveBar.close) - liveBar.low;
      const wr = lowerWick / barRange;
      if (wr < wickRatio) return { signal: false };

      let score = wr / wickRatio;
      if (liveBar.volumeDelta > 0) score *= 1.3;
      if (obi > 0.15) score *= 1.4;
      if (obi < -0.3) return { signal: false };
      return { signal: true, direction: 'BUY', tag: 'TRAP', score, meta: { wickRatio: wr.toFixed(3), delta: liveBar.volumeDelta } };
    }

    if (liveBar.high > localRangeHigh && liveBar.close < liveBar.open) {
      const upperWick = liveBar.high - Math.max(liveBar.open, liveBar.close);
      const wr = upperWick / barRange;
      if (wr < wickRatio) return { signal: false };

      let score = wr / wickRatio;
      if (liveBar.volumeDelta < 0) score *= 1.3;
      if (obi < -0.15) score *= 1.4;
      if (obi > 0.3) return { signal: false };
      return { signal: true, direction: 'SELL', tag: 'TRAP', score, meta: { wickRatio: wr.toFixed(3), delta: liveBar.volumeDelta } };
    }
    return { signal: false };
  }

  evaluateWickThief(liveBar, currentATR, volumeDelta, obi) {
    if (currentATR === 0) return { signal: false };

    const wickMult = 0.5;
    const threshold = currentATR * wickMult;

    const barRange = liveBar.high - liveBar.low;
    if (barRange === 0) return { signal: false };

    const bodyRatio = Math.abs(liveBar.close - liveBar.open) / barRange;
    if (bodyRatio > 0.4) return { signal: false };

    if (barRange < currentATR * 0.25) return { signal: false };

    const lowerWick = Math.min(liveBar.open, liveBar.close) - liveBar.low;
    const upperWick = liveBar.high - Math.max(liveBar.open, liveBar.close);

    if (lowerWick > threshold && liveBar.close > liveBar.open) {
      let score = lowerWick / threshold;
      if (volumeDelta > 0) score *= 1.3;
      if (obi > 0.1) score *= 1.3;
      if (obi < -0.25) return { signal: false };
      return { signal: true, direction: 'BUY', tag: 'WICK', score, meta: { wickSize: lowerWick.toFixed(4), threshold: threshold.toFixed(4), delta: volumeDelta } };
    }

    if (upperWick > threshold && liveBar.close < liveBar.open) {
      let score = upperWick / threshold;
      if (volumeDelta < 0) score *= 1.3;
      if (obi < -0.1) score *= 1.3;
      if (obi > 0.25) return { signal: false };
      return { signal: true, direction: 'SELL', tag: 'WICK', score, meta: { wickSize: upperWick.toFixed(4), threshold: threshold.toFixed(4), delta: volumeDelta } };
    }
    return { signal: false };
  }

  evaluateCompression(barsCluster, currentAsk, currentBid, coilHigh, coilLow, obi, atr) {
    const coilBars = this.config.Compression?.CompCoilBars || 5;
    const compRatio = 1.2;

    if (!barsCluster || barsCluster.length < coilBars || atr === 0) {
      return { signal: false };
    }

    const evalBars = barsCluster.slice(-coilBars);

    let cumulativeSize = 0;
    for (const b of evalBars) {
      cumulativeSize += (b.high - b.low);
    }
    const avgSize = cumulativeSize / evalBars.length;
    if (avgSize === 0) return { signal: false };

    if (avgSize > atr * 0.8) return { signal: false };

    let isCoiled = true;
    for (let i = 0; i < evalBars.length; i++) {
      const range = evalBars[i].high - evalBars[i].low;
      if (range >= avgSize * compRatio) {
        isCoiled = false;
        break;
      }
    }

    if (!isCoiled) return { signal: false };

    const coilHighLocal = Math.max(...evalBars.map(b => b.high));
    const coilLowLocal = Math.min(...evalBars.map(b => b.low));

    const buffer = atr * 0.3;

    if (currentAsk >= coilHighLocal + buffer) {
      let score = (currentAsk - coilHighLocal) / buffer;
      if (obi > 0.1) score *= 1.4;
      if (obi < -0.25) return { signal: false };
      return { signal: true, direction: 'BUY', tag: 'COMP', score, meta: { coilHigh: coilHighLocal, breakout: currentAsk, buffer: buffer.toFixed(2) } };
    }

    if (currentBid <= coilLowLocal - buffer) {
      let score = (coilLowLocal - currentBid) / buffer;
      if (obi < -0.1) score *= 1.4;
      if (obi > 0.25) return { signal: false };
      return { signal: true, direction: 'SELL', tag: 'COMP', score, meta: { coilLow: coilLowLocal, breakout: currentBid, buffer: buffer.toFixed(2) } };
    }

    return { signal: false };
  }

  evaluateFlowReversal(liveBar, prevBar, obi, atr) {
    if (!liveBar || !prevBar || atr === 0) return { signal: false };

    const barRange = liveBar.high - liveBar.low;
    if (barRange === 0) return { signal: false };

    if (barRange < atr * 0.3) return { signal: false };

    const deltaShift = liveBar.volumeDelta - prevBar.volumeDelta;
    const priceShift = liveBar.close - prevBar.close;
    const bodyRatio = Math.abs(liveBar.close - liveBar.open) / barRange;

    if (bodyRatio < 0.3) return { signal: false };

    if (deltaShift > atr * 0.3 && priceShift > 0 && obi > 0.2 && bodyRatio > 0.4) {
      let score = (deltaShift / atr) * 2 + obi + bodyRatio;
      return { signal: true, direction: 'BUY', tag: 'FLOW', score, meta: { deltaShift: deltaShift.toFixed(2), obi: obi.toFixed(3), bodyRatio: bodyRatio.toFixed(3) } };
    }

    if (deltaShift < -atr * 0.3 && priceShift < 0 && obi < -0.2 && bodyRatio > 0.4) {
      let score = Math.abs(deltaShift / atr) * 2 + Math.abs(obi) + bodyRatio;
      return { signal: true, direction: 'SELL', tag: 'FLOW', score, meta: { deltaShift: deltaShift.toFixed(2), obi: obi.toFixed(3), bodyRatio: bodyRatio.toFixed(3) } };
    }

    return { signal: false };
  }

  getLastSignal(symbol) {
    return this._lastSignals[symbol];
  }
}

module.exports = StrategyManager;
