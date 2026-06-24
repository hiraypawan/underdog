const crypto = require('crypto');
const https = require('https');

class BinanceExecutor {
  constructor(config) {
    this.config = config.binance || {};
    this.apiKey = this.config.apiKey || '';
    this.apiSecret = this.config.apiSecret || '';
    this.demo = this.config.demo !== false;
    this.baseURL = 'https://demo-fapi.binance.com';
    this.connected = false;
    this.accountInfo = null;
  }

  _sign(params) {
    const queryString = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
    return { queryString: queryString + '&signature=' + signature, signature };
  }

  _request(method, path, params = {}, signed = true) {
    return new Promise((resolve, reject) => {
      if (signed) {
        params.timestamp = Date.now();
        params.recvWindow = 10000;
      }

      let queryString;
      if (signed) {
        ({ queryString } = this._sign(params));
      } else {
        queryString = Object.entries(params)
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
          .join('&');
      }
      const url = new URL(path, this.baseURL);
      if (method === 'GET' && queryString) {
        url.search = '?' + queryString;
      }

      const headers = {
        'X-MBX-APIKEY': this.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      };

      if (this.demo) {
        headers['demo'] = 'true';
      }

      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: method,
        headers: headers
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.code && json.code !== 200) {
              reject(new Error(`Binance API error ${json.code}: ${json.msg}`));
            } else {
              resolve(json);
            }
          } catch (e) {
            reject(new Error(`Parse error: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (e) => reject(new Error(`Network error: ${e.message}`)));
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });

      if (method === 'POST') {
        req.write(queryString);
      }
      req.end();
    });
  }

  async connect() {
    if (!this.apiKey || !this.apiSecret) {
      console.log('[BINANCE] No API keys configured. Running in DEMO/LOCAL mode.');
      return false;
    }

    try {
      this.accountInfo = await this._request('GET', '/fapi/v2/account');
      this.connected = true;
      console.log(`[BINANCE] Connected to ${this.demo ? 'DEMO' : 'LIVE'}`);
      console.log(`[BINANCE] Balance: ${this.accountInfo.totalWalletBalance}`);
      console.log(`[BINANCE] PnL: ${this.accountInfo.totalUnrealizedProfit}`);
      return true;
    } catch (e) {
      console.log(`[BINANCE] Connection failed: ${e.message}`);
      console.log(`[BINANCE] URL: ${this.baseURL}/fapi/v2/account`);
      console.log(`[BINANCE] Demo mode: ${this.demo}`);
      this.connected = false;
      return false;
    }
  }

  async getAccountInfo() {
    if (!this.connected) return null;
    try {
      this.accountInfo = await this._request('GET', '/fapi/v2/account');
      return {
        balance: parseFloat(this.accountInfo.totalWalletBalance),
        equity: parseFloat(this.accountInfo.totalWalletBalance) + parseFloat(this.accountInfo.totalUnrealizedProfit),
        pnl: parseFloat(this.accountInfo.totalUnrealizedProfit),
        available: parseFloat(this.accountInfo.availableBalance),
        margin: parseFloat(this.accountInfo.totalMarginBalance),
        server: this.demo ? 'Binance Demo' : 'Binance Live',
        login: this.apiKey.substring(0, 8) + '...',
        currency: 'USDT'
      };
    } catch (e) {
      console.error('[BINANCE] Account info error:', e.message);
      return null;
    }
  }

  async openOrder(params) {
    if (!this.connected) {
      return { status: 'ERROR', error: 'Binance not connected' };
    }

    try {
      const symbol = params.symbol.replace('USD', 'USDT');
      const side = params.direction === 'BUY' ? 'BUY' : 'SELL';
      const quantity = params.lots || 0.001;

      const orderParams = {
        symbol: symbol,
        side: side,
        type: 'MARKET',
        quantity: quantity
      };

      const result = await this._request('POST', '/fapi/v1/order', orderParams);

      let fillPrice = parseFloat(result.avgPrice || 0);

      if (!fillPrice || fillPrice === 0) {
        try {
          const orderStatus = await this._request('GET', '/fapi/v1/order', {
            symbol: symbol,
            orderId: result.orderId
          });
          fillPrice = parseFloat(orderStatus.avgPrice || orderStatus.price || 0);
        } catch (e) {}
      }

      if (!fillPrice || fillPrice === 0) {
        try {
          const trades = await this._request('GET', '/fapi/v1/userTrades', {
            symbol: symbol,
            limit: 1
          });
          if (trades && trades.length > 0) {
            fillPrice = parseFloat(trades[0].price || 0);
          }
        } catch (e) {}
      }

      if (!fillPrice || fillPrice === 0) {
        const tick = await this._request('GET', '/fapi/v1/ticker/24hr', { symbol: symbol }, false);
        fillPrice = side === 'BUY' ? parseFloat(tick.askPrice) : parseFloat(tick.bidPrice);
      }

      const requestedPrice = params.targetPrice || 0;
      const slippage = Math.abs(fillPrice - requestedPrice);

      try {
        await this._request('DELETE', '/fapi/v1/algoOpenOrders', { symbol: symbol });
      } catch (e) {}

      await new Promise(r => setTimeout(r, 200));

      if (params.sl && parseFloat(params.sl) > 0) {
        try {
          const slSide = side === 'BUY' ? 'SELL' : 'BUY';
          const slPrice = parseFloat(params.sl);
          const roundedSl = Math.round(slPrice * 10) / 10;
          await this._request('POST', '/fapi/v1/algoOrder', {
            algoType: 'CONDITIONAL',
            symbol: symbol,
            side: slSide,
            type: 'STOP_MARKET',
            triggerPrice: roundedSl,
            closePosition: 'true',
            workingType: 'MARK_PRICE'
          });
        } catch (e) {
          console.error(`[BINANCE] SL order error: ${e.message}`);
        }
      }

      if (params.tp && parseFloat(params.tp) > 0) {
        try {
          const tpSide = side === 'BUY' ? 'SELL' : 'BUY';
          const tpPrice = parseFloat(params.tp);
          const roundedTp = Math.round(tpPrice * 10) / 10;
          await this._request('POST', '/fapi/v1/algoOrder', {
            algoType: 'CONDITIONAL',
            symbol: symbol,
            side: tpSide,
            type: 'TAKE_PROFIT_MARKET',
            triggerPrice: roundedTp,
            closePosition: 'true',
            workingType: 'MARK_PRICE'
          });
        } catch (e) {
          console.error(`[BINANCE] TP order error: ${e.message}`);
        }
      }

      return {
        status: 'SUCCESS',
        ticket: result.orderId,
        symbol: symbol,
        direction: params.direction,
        lots: quantity,
        fillPrice: fillPrice,
        requestedPrice: requestedPrice,
        slippage: slippage,
        spread: 0,
        mode: this.demo ? 'DEMO' : 'LIVE',
        binanceId: result.clientOrderId
      };
    } catch (e) {
      console.error('[BINANCE] Order error:', e.message);
      return { status: 'ERROR', error: e.message };
    }
  }

  async closeOrder(params) {
    if (!this.connected) {
      return { status: 'ERROR', error: 'Binance not connected' };
    }

    try {
      const symbol = (params.symbol || '').replace('USD', 'USDT');

      const positions = await this._request('GET', '/fapi/v2/positionRisk');
      const pos = positions.find(p =>
        p.symbol === symbol && parseFloat(p.positionAmt) !== 0
      );

      if (!pos) {
        return { status: 'ERROR', error: `No position found for ${symbol}` };
      }

      const closeSide = parseFloat(pos.positionAmt) > 0 ? 'SELL' : 'BUY';
      const qty = Math.abs(parseFloat(pos.positionAmt));

      try {
        await this._request('DELETE', '/fapi/v1/algoOpenOrders', { symbol: symbol });
      } catch (e) {}

      const result = await this._request('POST', '/fapi/v1/order', {
        symbol: symbol,
        side: closeSide,
        type: 'MARKET',
        quantity: qty
      });

      let closePrice = parseFloat(result.avgPrice || 0);

      if (!closePrice || closePrice === 0) {
        try {
          const orderStatus = await this._request('GET', '/fapi/v1/order', {
            symbol: symbol,
            orderId: result.orderId
          });
          closePrice = parseFloat(orderStatus.avgPrice || orderStatus.price || 0);
        } catch (e) {}
      }

      if (!closePrice || closePrice === 0) {
        try {
          const trades = await this._request('GET', '/fapi/v1/userTrades', {
            symbol: symbol,
            limit: 1
          });
          if (trades && trades.length > 0) {
            closePrice = parseFloat(trades[0].price || 0);
          }
        } catch (e) {}
      }

      if (!closePrice || closePrice === 0) {
        const tick = await this._request('GET', '/fapi/v1/ticker/24hr', { symbol: symbol }, false);
        closePrice = closeSide === 'BUY' ? parseFloat(tick.askPrice) : parseFloat(tick.bidPrice);
      }

      return {
        status: 'SUCCESS',
        ticket: params.ticket || result.orderId,
        closePrice: closePrice,
        lots: qty,
        symbol: symbol
      };
    } catch (e) {
      console.error('[BINANCE] Close error:', e.message);
      return { status: 'ERROR', error: e.message };
    }
  }

  async getPositions() {
    if (!this.connected) return [];
    try {
      const positions = await this._request('GET', '/fapi/v2/positionRisk');
      return positions
        .filter(p => parseFloat(p.positionAmt) !== 0)
        .map(p => ({
          ticket: p.symbol,
          symbol: p.symbol,
          direction: parseFloat(p.positionAmt) > 0 ? 'BUY' : 'SELL',
          lots: Math.abs(parseFloat(p.positionAmt)),
          openPrice: parseFloat(p.entryPrice),
          currentPrice: parseFloat(p.markPrice),
          sl: parseFloat(p.stopPrice) || 0,
          tp: 0,
          pnl: parseFloat(p.unRealizedProfit),
          swap: 0,
          commission: 0,
          time: Date.now()
        }));
    } catch (e) {
      return [];
    }
  }

  async getKlines(symbol, interval = '1m', limit = 500) {
    try {
      const sym = symbol.replace('USD', 'USDT');
      const result = await this._request('GET', '/fapi/v1/klines', {
        symbol: sym,
        interval: interval,
        limit: limit
      }, false);
      return result;
    } catch (e) {
      console.error(`[BINANCE] Klines error for ${symbol}: ${e.message}`);
      return [];
    }
  }

  isEnabled() {
    return this.connected;
  }

  disconnect() {
    this.connected = false;
  }
}

module.exports = BinanceExecutor;
