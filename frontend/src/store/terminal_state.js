import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

let _logId = 0

function toIST(date) {
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

export const useTerminalStore = defineStore('terminal', () => {
  const connected = ref(false)
  const mode = ref('DEMO')
  const balance = ref(10000)
  const stats = ref({ total: 0, wins: 0, losses: 0, winRate: '0.0', totalPnl: '0.00' })
  const positions = ref([])
  const config = ref({})
  const streamStatus = ref({ BTCUSD: false, XAUUSD: false })

  const candles = ref({ BTCUSD: {}, XAUUSD: {} })
  const liveCandles = ref({ BTCUSD: null, XAUUSD: null })
  const livePrices = ref({ BTCUSD: 0, XAUUSD: 0 })
  const livePnL = ref({})
  const priceData = ref({ BTCUSD: { bid: 0, ask: 0, spread: 0 }, XAUUSD: { bid: 0, ask: 0, spread: 0 } })

  const orderBooks = ref({
    BTCUSD: { obi: 0, bidDepth: [], askDepth: [], walls: { bidWalls: [], askWalls: [] } },
    XAUUSD: { obi: 0, bidDepth: [], askDepth: [], walls: { bidWalls: [], askWalls: [] } }
  })

  const tickFlows = ref({ BTCUSD: { pressure: 'NEUTRAL', buyRatio: 0.5 }, XAUUSD: { pressure: 'NEUTRAL', buyRatio: 0.5 } })
  const volumeSpikes = ref({ BTCUSD: { isSpike: false, ratio: 0 }, XAUUSD: { isSpike: false, ratio: 0 } })
  const volatilityBreakers = ref({ BTCUSD: false, XAUUSD: false })
  const binanceStatus = ref({ connected: false, mode: 'DEMO', account: null })

  const strategyStates = ref({
    Momentum: true,
    Trap: true,
    WickThief: true,
    Compression: true,
    FlowReversal: true
  })

  const tradeLog = ref([])
  const sessionStats = ref({ BTCUSD: { signals: 0, trades: 0 }, XAUUSD: { signals: 0, trades: 0 } })
  const activeTimeframe = ref('M1')

  const ws = ref(null)
  let reconnectTimer = null

  function connect() {
    const wsUrl = `ws://localhost:3901`
    if (ws.value) { try { ws.value.close(); } catch (e) {} }

    ws.value = new WebSocket(wsUrl)

    ws.value.onopen = () => {
      connected.value = true
      console.log('[WS] Connected')
    }

    ws.value.onclose = () => {
      connected.value = false
      clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(connect, 1500)
    }

    ws.value.onerror = () => {}

    ws.value.onmessage = (event) => {
      try {
        handleMessage(JSON.parse(event.data))
      } catch (e) {}
    }
  }

  function handleMessage(data) {
    switch (data.type) {
      case 'INIT':
        config.value = data.config
        balance.value = data.balance
        stats.value = data.stats
        positions.value = data.positions
        if (data.config.strategies) {
          for (const [k, v] of Object.entries(data.config.strategies)) {
            strategyStates.value[k] = v.enabled !== undefined ? v.enabled : !!v
          }
        }
        if (data.candles) {
          for (const sym of Object.keys(data.candles)) {
            candles.value[sym] = data.candles[sym]
          }
        }
        break

      case 'LIVE_CANDLE':
        liveCandles.value[data.symbol] = data.candle
        livePrices.value[data.symbol] = data.price
        break

      case 'LIVE_CANDLE_TF':
        break

      case 'COMPLETED_CANDLE':
        if (!candles.value[data.symbol]) candles.value[data.symbol] = {}
        if (!candles.value[data.symbol]['M1']) candles.value[data.symbol]['M1'] = []
        candles.value[data.symbol]['M1'].push(data.candle)
        if (candles.value[data.symbol]['M1'].length > 500) candles.value[data.symbol]['M1'].shift()
        if (data.volSpike) volumeSpikes.value[data.symbol] = data.volSpike
        break

      case 'COMPLETED_CANDLE_TF':
        if (!candles.value[data.symbol]) candles.value[data.symbol] = {}
        if (!candles.value[data.symbol][data.timeframe]) candles.value[data.symbol][data.timeframe] = []
        candles.value[data.symbol][data.timeframe].push(data.candle)
        if (candles.value[data.symbol][data.timeframe].length > 500) candles.value[data.symbol][data.timeframe].shift()
        break

      case 'ORDER_BOOK_UPDATE':
        orderBooks.value[data.symbol] = {
          obi: data.obi,
          bidDepth: data.bidDepth,
          askDepth: data.askDepth,
          walls: data.walls || { bidWalls: [], askWalls: [] }
        }
        break

      case 'STREAM_STATUS':
        streamStatus.value[data.symbol] = data.connected
        break

      case 'TICK_FLOW':
        tickFlows.value[data.symbol] = {
          pressure: data.pressure,
          buyRatio: data.buyRatio,
          totalTicks: data.totalTicks
        }
        break

      case 'VOLUME_SPIKE':
        volumeSpikes.value[data.symbol] = { isSpike: true, ratio: data.ratio }
        addTradeLog({ action: 'VOL_SPIKE', symbol: data.symbol, ratio: data.ratio.toFixed(1) + 'x' })
        break

      case 'VOLATILITY_BREAKER':
        volatilityBreakers.value[data.symbol] = data.activated
        if (data.activated) addTradeLog({ action: 'VOL_BREAK', symbol: data.symbol, score: data.score.toFixed(2) })
        break

      case 'CONFIG_UPDATE':
        config.value = data.config
        break

      case 'MODE_CHANGE':
        mode.value = data.mode
        break

      case 'STRATEGY_UPDATE':
        strategyStates.value[data.name] = data.enabled
        break

      case 'TRADE_OPENED':
        addTradeLog({
          action: 'OPENED', ticket: data.ticket, symbol: data.symbol,
          direction: data.direction, lots: data.lots,
          price: (typeof data.price === 'number') ? data.price.toFixed(2) : String(data.price || '0'),
          sl: (typeof data.sl === 'number') ? data.sl.toFixed(2) : String(data.sl || '0'),
          slPips: data.slPips,
          tag: data.tag
        })
        refreshPositions()
        break

      case 'POSITION_CLOSED':
        addTradeLog({
          action: 'CLOSED', ticket: data.ticket, symbol: data.symbol,
          direction: data.direction,
          lots: data.lots,
          entryPrice: data.entryPrice,
          closePrice: data.closePrice,
          pnl: (typeof data.pnl === 'number' && !isNaN(data.pnl)) ? data.pnl.toFixed(2) : '0.00',
          reason: data.reason
        })
        refreshPositions()
        break

      case 'SL_MODIFIED':
        addTradeLog({ action: 'SL_MOVE', ticket: data.ticket, newSL: data.newSL?.toFixed(2), reason: data.reason })
        break

      case 'LIVE_PNL':
        livePnL.value = data.pnlMap || {}
        if (data.prices) {
          if (data.prices.BTCUSD) priceData.value.BTCUSD = data.prices.BTCUSD
          if (data.prices.XAUUSD) priceData.value.XAUUSD = data.prices.XAUUSD
        }
        break

      case 'BINANCE_STATUS':
        binanceStatus.value = { connected: data.connected, mode: data.mode, account: data.account }
        if (data.account) balance.value = data.account.balance
        if (data.connected) mode.value = 'LIVE'
        break

      case 'BALANCE_UPDATE':
        balance.value = data.balance
        if (binanceStatus.value.connected) {
          binanceStatus.value.account = { ...binanceStatus.value.account, balance: data.balance, equity: data.equity, pnl: data.pnl, available: data.available }
        }
        break
    }
  }

  function addTradeLog(entry) {
    entry.time = toIST(new Date())
    entry._id = ++_logId
    tradeLog.value.unshift(entry)
    if (tradeLog.value.length > 200) tradeLog.value.pop()
  }

  function refreshPositions() {
    fetch('/api/status')
      .then(r => r.json())
      .then(data => {
        balance.value = data.balance
        stats.value = data.stats
        positions.value = data.positions
        if (data.session) sessionStats.value = data.session
      })
      .catch(() => {})
  }

  function sendCommand(endpoint, body) {
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(r => r.json()).catch(() => {})
  }

  function setActiveTimeframe(tf) {
    activeTimeframe.value = tf
  }

  const winRate = computed(() => stats.value.winRate || '0.0')
  const totalPnl = computed(() => stats.value.totalPnl || '0.00')
  const openCount = computed(() => positions.value.length)

  return {
    connected, mode, balance, stats, positions, config, streamStatus,
    candles, liveCandles, livePrices, livePnL, priceData, orderBooks,
    tickFlows, volumeSpikes, volatilityBreakers,
    strategyStates, tradeLog, sessionStats, activeTimeframe, binanceStatus,
    ws, winRate, totalPnl, openCount,
    connect, addTradeLog, refreshPositions, sendCommand, setActiveTimeframe
  }
})
