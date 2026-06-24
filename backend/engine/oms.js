class OrderManagementSystem {
  constructor(mode, db, config, binanceExecutor) {
    this.mode = mode;
    this.db = db;
    this.config = config || {};
    this.binance = binanceExecutor || null;
  }

  setMode(newMode) {
    this.mode = newMode;
    console.log(`[OMS] Mode switched to: ${newMode}`);
  }

  setBinanceExecutor(executor) {
    this.binance = executor;
  }

  async executeOrder(orderParams) {
    if (this.binance && this.binance.isEnabled()) {
      return this.executeBinance(orderParams);
    } else {
      return this.processSandboxMatch(orderParams);
    }
  }

  async executeBinance(order) {
    console.log(`[OMS-BINANCE] Executing ${order.direction} ${order.lots} ${order.symbol} via Binance...`);

    const result = await this.binance.openOrder({
      symbol: order.symbol,
      direction: order.direction,
      lots: order.lots,
      sl: order.sl,
      tp: order.tp || 0,
      targetPrice: order.targetPrice,
      comment: order.comment || 'UnderdogQT'
    });

    if (result.status === 'SUCCESS') {
      const ticketId = result.ticket;

      this.db.insertPosition(
        ticketId, order.symbol, order.direction, order.lots,
        result.fillPrice, order.sl || 0, order.tp || 0,
        order.comment || ''
      );

      console.log(`[OMS-BINANCE] FILLED: ${order.direction} ${order.lots} ${order.symbol} @ ${result.fillPrice} | Ticket: ${ticketId}`);

      return {
        status: 'SUCCESS',
        ticket: ticketId,
        executionPrice: result.fillPrice,
        requestedPrice: result.requestedPrice,
        slippage: result.slippage,
        spread: result.spread,
        mode: result.mode,
        binanceId: result.binanceId
      };
    } else {
      console.log(`[OMS-BINANCE] REJECTED: ${result.error}`);
      return { status: 'ERROR', error: result.error };
    }
  }

  processSandboxMatch(order) {
    const symConfig = this.config.symbols[order.symbol];
    const pipSize = symConfig?.pipSize || 0.01;
    const spreadPips = parseInt(this.db.getSetting('simulated_spread_points') || String(symConfig?.spreadPips || 100));
    const slippagePips = parseInt(this.db.getSetting('simulated_slippage_points') || String(symConfig?.slippagePips || 10));

    const totalCostPips = spreadPips + slippagePips;
    const totalCostPrice = totalCostPips * pipSize;

    let finalPrice = order.targetPrice;
    if (order.direction === 'BUY') {
      finalPrice += totalCostPrice;
    } else {
      finalPrice -= totalCostPrice;
    }

    const lots = 0.01;
    const ticketId = Math.floor(Math.random() * 9000000) + 1000000;

    this.db.insertPosition(
      ticketId, order.symbol, order.direction, lots,
      finalPrice, order.sl || 0, order.tp || 0, order.comment || ''
    );

    console.log(`[OMS-DEMO] ${order.direction} ${lots} ${order.symbol} @ ${finalPrice.toFixed(2)} | Cost: ${totalCostPips} pips | Ticket: ${ticketId}`);

    return { status: 'SUCCESS', ticket: ticketId, executionPrice: finalPrice, mode: 'DEMO' };
  }

  async closePosition(ticket, symbol, direction, lots) {
    if (this.binance && this.binance.isEnabled()) {
      return await this.binance.closeOrder({ ticket, symbol, direction, lots });
    }
    return { status: 'SUCCESS' };
  }

  async modifySL(ticket, symbol, newSL) {
    return { status: 'SUCCESS' };
  }
}

module.exports = OrderManagementSystem;
