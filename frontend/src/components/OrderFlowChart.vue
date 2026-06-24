<template>
  <div class="chart-wrapper">
    <div class="chart-header">
      <div class="chart-info">
        <span class="chart-symbol">{{ symbol }}</span>
        <span class="chart-price" :class="priceDir">{{ formatPrice(currentPrice) }}</span>
        <span class="chart-change" :class="priceDir">{{ formatChange() }}</span>
      </div>
      <div class="timeframe-bar">
        <button v-for="tf in timeframes" :key="tf" :class="['tf-btn', { active: activeTf === tf }]" @click="switchTimeframe(tf)">{{ tf }}</button>
      </div>
      <div class="chart-indicators">
        <span class="ind" v-if="currentCandle">
          O:<b>{{ currentCandle.open?.toFixed(2) }}</b>
          H:<b>{{ currentCandle.high?.toFixed(2) }}</b>
          L:<b>{{ currentCandle.low?.toFixed(2) }}</b>
          C:<b :class="currentCandle.close >= currentCandle.open ? 'up' : 'dn'">{{ currentCandle.close?.toFixed(2) }}</b>
        </span>
        <span class="ind vol">Vol: <b>{{ formatVol(currentCandle?.volume) }}</b></span>
        <span class="ind delta" :class="deltaDir">Delta: <b>{{ currentCandle?.volumeDelta?.toFixed(2) || '0' }}</b></span>
        <span class="ind ticks">Ticks: <b>{{ currentCandle?.tickCount || '0' }}</b></span>
      </div>
    </div>
    <div class="chart-body" ref="chartContainer">
      <div ref="chartRef" class="tvcharts"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue'
import { createChart } from 'lightweight-charts'
import { useTerminalStore } from '../store/terminal_state.js'

const props = defineProps({ symbol: { type: String, default: 'BTCUSD' } })
const store = useTerminalStore()

const chartContainer = ref(null)
const chartRef = ref(null)

let chart = null
let candleSeries = null
let volumeSeries = null
let lastCandleTime = 0
let tradeMarkers = []

const timeframes = ['M1', 'M2', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']
const activeTf = ref('M1')

const currentCandle = computed(() => store.liveCandles[props.symbol])
const currentPrice = computed(() => store.livePrices[props.symbol] || 0)
const prevClose = ref(0)

const priceDir = computed(() => {
  const p = currentPrice.value
  if (p === 0) return ''
  return p >= prevClose.value ? 'up' : 'dn'
})
const deltaDir = computed(() => {
  const d = currentCandle.value?.volumeDelta || 0
  return d > 0 ? 'up' : d < 0 ? 'dn' : ''
})

function formatPrice(p) {
  if (!p) return '0.00'
  return p >= 1000 ? p.toFixed(2) : p.toFixed(4)
}
function formatVol(v) {
  if (!v) return '0'
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M'
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K'
  return v.toFixed(2)
}
function formatChange() {
  if (!currentPrice.value || !prevClose.value) return '0.00%'
  const pct = ((currentPrice.value - prevClose.value) / prevClose.value * 100)
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'
}

function initChart() {
  if (!chartRef.value) return
  if (chart) { chart.remove(); chart = null }

  const container = chartContainer.value
  const w = container ? container.clientWidth : 800
  const h = container ? container.clientHeight : 400

  chart = createChart(chartRef.value, {
    autoSize: true,
    layout: {
      background: { type: 'solid', color: '#0a0e17' },
      textColor: '#666',
      fontSize: 11,
      fontFamily: "'JetBrains Mono', monospace"
    },
    grid: {
      vertLines: { color: '#111827' },
      horzLines: { color: '#111827' }
    },
    crosshair: {
      mode: 0,
      vertLine: { color: '#4fc3f766', width: 1, style: 2, labelBackgroundColor: '#1c2333' },
      horzLine: { color: '#4fc3f766', width: 1, style: 2, labelBackgroundColor: '#1c2333' }
    },
    timeScale: {
      timeVisible: true,
      secondsVisible: true,
      borderColor: '#1c2333',
      rightOffset: 5,
      barSpacing: 8
    },
    rightPriceScale: {
      borderColor: '#1c2333',
      scaleMargins: { top: 0.05, bottom: 0.2 }
    },
    width: w,
    height: h
  })

  candleSeries = chart.addCandlestickSeries({
    upColor: '#00ff88',
    downColor: '#ff5252',
    borderUpColor: '#00ff88',
    borderDownColor: '#ff5252',
    wickUpColor: '#00ff88aa',
    wickDownColor: '#ff5252aa',
    lastValueVisible: true,
    priceLineVisible: true,
    priceLineColor: '#4fc3f7',
    priceLineWidth: 1,
    priceLineStyle: 2
  })

  volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'vol',
    lastValueVisible: false,
    priceLineVisible: false
  })

  chart.priceScale('vol').applyOptions({
    scaleMargins: { top: 0.85, bottom: 0 }
  })

  loadHistory()
}

function loadHistory() {
  if (!candleSeries) return
  const sym = props.symbol
  const tf = activeTf.value
  const hist = store.candles[sym]?.[tf] || []
  if (hist.length === 0) return

  for (const c of hist) {
    const time = Math.floor(c.timestamp / 1000)
    candleSeries.update({ time, open: c.open, high: c.high, low: c.low, close: c.close })
    const color = c.close >= c.open ? '#00ff8833' : '#ff525233'
    volumeSeries.update({ time, value: c.volume || 0, color })
    if (prevClose.value === 0 && c.open) prevClose.value = c.open
  }
  lastCandleTime = hist.length > 0 ? Math.floor(hist[hist.length - 1].timestamp / 1000) : 0
}

function updateChart(candle) {
  if (!candleSeries || !candle) return

  const time = Math.floor(candle.timestamp / 1000)

  candleSeries.update({
    time: time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close
  })

  const color = candle.close >= candle.open ? '#00ff8833' : '#ff525233'
  volumeSeries.update({
    time: time,
    value: candle.volume || 0,
    color: color
  })

  if (lastCandleTime !== time) {
    if (prevClose.value === 0 && candle.open) prevClose.value = candle.open
    lastCandleTime = time
  }
}

function switchTimeframe(tf) {
  activeTf.value = tf
  store.setActiveTimeframe(tf)
  lastCandleTime = 0
  prevClose.value = 0
  tradeMarkers = []
  if (chart) { chart.remove(); chart = null }
  nextTick(() => setTimeout(initChart, 100))
}

function addTradeMarker(entry) {
  if (!candleSeries) return
  if (entry.symbol && entry.symbol !== props.symbol) return

  if (entry.action === 'OPENED' && entry.price) {
    const price = parseFloat(entry.price)
    if (isNaN(price)) return
    tradeMarkers.push({
      time: Math.floor(Date.now() / 1000),
      position: entry.direction === 'BUY' ? 'belowBar' : 'aboveBar',
      color: entry.direction === 'BUY' ? '#00ff88' : '#ff5252',
      shape: entry.direction === 'BUY' ? 'arrowUp' : 'arrowDown',
      text: `${entry.direction} ${entry.lots || ''}`
    })
    candleSeries.setMarkers(tradeMarkers)
  }

  if (entry.action === 'CLOSED' && entry.closePrice) {
    const price = parseFloat(entry.closePrice)
    if (isNaN(price)) return
    const pnlNum = parseFloat(entry.pnl)
    const isWin = !isNaN(pnlNum) && pnlNum >= 0
    tradeMarkers.push({
      time: Math.floor(Date.now() / 1000),
      position: 'aboveBar',
      color: isWin ? '#00ff88' : '#ff5252',
      shape: 'circle',
      text: `${isWin ? '+' : ''}$${entry.pnl || '0'}`
    })
    candleSeries.setMarkers(tradeMarkers)
  }
}

onMounted(() => {
  nextTick(() => {
    setTimeout(() => {
      initChart()
    }, 100)
  })
})

onUnmounted(() => {
  if (chart) { chart.remove(); chart = null }
})

watch(() => props.symbol, () => {
  if (chart) { chart.remove(); chart = null }
  lastCandleTime = 0
  prevClose.value = 0
  nextTick(() => setTimeout(initChart, 100))
})

watch(() => store.liveCandles[props.symbol], (newCandle) => {
  if (newCandle && activeTf.value === 'M1') updateChart(newCandle)
})

watch(() => store.tradeLog.length, () => {
  const latest = store.tradeLog[0]
  if (latest) addTradeMarker(latest)
})
</script>

<style scoped>
.chart-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #0a0e17;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: #0d1117;
  border-bottom: 1px solid #1c2333;
  flex-shrink: 0;
  gap: 12px;
}

.chart-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.chart-symbol {
  font-size: 13px;
  font-weight: 700;
  color: #fff;
}

.chart-price {
  font-size: 18px;
  font-weight: 700;
  color: #e1e4e8;
}

.chart-price.up { color: #00ff88; }
.chart-price.dn { color: #ff5252; }

.chart-change {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 600;
}

.chart-change.up { color: #00ff88; background: #0d281833; }
.chart-change.dn { color: #ff5252; background: #2e1a1a33; }

.timeframe-bar {
  display: flex;
  gap: 2px;
}

.tf-btn {
  background: #1c2333;
  border: 1px solid #2a3040;
  color: #666;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.15s;
  font-family: 'JetBrains Mono', monospace;
}

.tf-btn:hover {
  background: #2a3040;
  color: #aaa;
}

.tf-btn.active {
  background: #4fc3f7;
  color: #000;
  border-color: #4fc3f7;
}

.chart-indicators {
  display: flex;
  gap: 12px;
  font-size: 10px;
  color: #666;
}

.ind b { color: #aaa; font-weight: 600; }
.ind.up b { color: #00ff88; }
.ind.dn b { color: #ff5252; }

.chart-body {
  flex: 1;
  min-height: 0;
  position: relative;
}

.tvcharts {
  width: 100%;
  height: 100%;
}

@media (max-width: 768px) {
  .chart-wrapper {
    padding: 0;
  }

  .chart-header {
    flex-direction: column;
    align-items: flex-start;
    padding: 10px 12px;
    gap: 8px;
  }

  .chart-info {
    width: 100%;
    justify-content: space-between;
  }

  .chart-symbol {
    font-size: 13px;
  }

  .chart-price {
    font-size: 16px;
  }

  .chart-change {
    font-size: 11px;
  }

  .timeframe-bar {
    width: 100%;
    flex-wrap: wrap;
    gap: 4px;
  }

  .tf-btn {
    min-height: 44px;
    min-width: 44px;
    padding: 8px 12px;
    font-size: 11px;
  }

  .chart-indicators {
    display: none;
  }

  .chart-body {
    min-height: 300px;
  }
}
</style>
