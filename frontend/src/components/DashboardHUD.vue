<template>
  <div class="dashboard-hud">
    <div class="section-title">Dashboard</div>

    <div class="metric-grid">
      <div class="metric">
        <span class="metric-label">Balance</span>
        <span class="metric-value">${{ store.balance.toFixed(2) }}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Win Rate</span>
        <span class="metric-value" :class="parseFloat(store.winRate) >= 50 ? 'green' : 'red'">{{ store.winRate }}%</span>
      </div>
      <div class="metric">
        <span class="metric-label">Total P&L</span>
        <span class="metric-value" :class="parseFloat(store.totalPnl) >= 0 ? 'green' : 'red'">${{ store.totalPnl }}</span>
      </div>
      <div class="metric">
        <span class="metric-label">Open</span>
        <span class="metric-value">{{ store.openCount }}</span>
      </div>
    </div>

    <div v-if="store.binanceStatus.connected && store.binanceStatus.account" class="binance-info">
      <div class="section-title" style="color: #f0b90b;">BINANCE {{ store.binanceStatus.mode }}</div>
      <div class="metric-grid">
        <div class="metric">
          <span class="metric-label">Balance</span>
          <span class="metric-value green">${{ store.binanceStatus.account.balance?.toFixed(2) || '0.00' }}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Equity</span>
          <span class="metric-value">${{ store.binanceStatus.account.equity?.toFixed(2) || '0.00' }}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Unrealized PnL</span>
          <span class="metric-value" :class="(store.binanceStatus.account.pnl || 0) >= 0 ? 'green' : 'red'">${{ store.binanceStatus.account.pnl?.toFixed(2) || '0.00' }}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Available</span>
          <span class="metric-value">${{ store.binanceStatus.account.available?.toFixed(2) || '0.00' }}</span>
        </div>
      </div>
    </div>

    <div class="price-ticker" v-for="sym in ['BTCUSD', 'XAUUSD']" :key="sym">
      <div class="ticker-row">
        <span class="ticker-sym">{{ sym }}</span>
        <span class="ticker-price">${{ formatPrice(store.livePrices[sym]) }}</span>
        <span class="stream-dot" :class="store.streamStatus[sym] ? 'live' : 'down'"></span>
      </div>
      <div class="ticker-sub">
        <span class="ticker-obi" :class="store.orderBooks[sym]?.obi > 0 ? 'bull' : 'bear'">
          OBI {{ store.orderBooks[sym]?.obi?.toFixed(3) || '0.000' }}
        </span>
        <span class="ticker-flow" :class="(store.tickFlows[sym]?.pressure || '').toLowerCase()">
          {{ store.tickFlows[sym]?.pressure || '---' }}
        </span>
        <span v-if="store.volumeSpikes[sym]?.isSpike" class="spike-badge">SPIKE</span>
        <span v-if="store.volatilityBreakers[sym]" class="breaker-badge">BREAKER</span>
      </div>
    </div>

    <div class="mode-control">
      <div class="section-title">Execution Mode</div>
      <div class="mode-toggle">
        <button :class="{ active: store.mode === 'DEMO' }" @click="setMode('DEMO')">DEMO</button>
        <button :class="{ active: store.mode === 'LIVE' }" @click="setMode('LIVE')" :disabled="!store.binanceStatus.connected">LIVE</button>
      </div>
      <div v-if="store.mode === 'LIVE' && !store.binanceStatus.connected" class="binance-warning">
        Binance not connected.
      </div>
    </div>

    <div class="sim-controls" v-if="store.mode === 'DEMO'">
      <div class="section-title">Sim Controls</div>
      <div class="slider-row">
        <label>Spread: {{ store.config.demo?.simulatedSpreadPts || 5 }} pts</label>
        <input type="range" min="0" max="5000" :value="store.config.demo?.simulatedSpreadPts || 5"
          @input="updateConfig('demo.simulatedSpreadPts', parseInt($event.target.value))" />
      </div>
      <div class="slider-row">
        <label>Slippage: {{ store.config.demo?.simulatedSlippagePts || 2 }} pts</label>
        <input type="range" min="0" max="1000" :value="store.config.demo?.simulatedSlippagePts || 2"
          @input="updateConfig('demo.simulatedSlippagePts', parseInt($event.target.value))" />
      </div>
    </div>

    <div class="risk-info">
      <div class="section-title">Risk Settings</div>
      <div class="risk-row"><span>Max Risk</span><span>{{ store.config.risk?.maxRiskPercent || 1 }}%</span></div>
      <div class="risk-row"><span>Max DD</span><span>{{ store.config.risk?.maxDrawdownPercent || 5 }}%</span></div>
      <div class="risk-row"><span>Max Pos</span><span>{{ store.config.risk?.maxOpenPositions || 3 }}</span></div>
      <div class="risk-row"><span>Daily Limit</span><span>${{ store.config.risk?.dailyLossLimit || 50 }}</span></div>
      <div class="risk-row"><span>Trail Start</span><span>{{ store.config.risk?.TrailStart_Pts || 20 }} pts</span></div>
    </div>

    <div class="strategies-status">
      <div class="section-title">Strategies</div>
      <div class="strat-row" v-for="(key, label) in stratMap" :key="key">
        <span class="strat-dot" :class="store.strategyStates[key] ? 'on' : 'off'"></span>
        <span class="strat-label">{{ label }}</span>
        <button class="strat-toggle" @click="toggleStrat(key)">
          {{ store.strategyStates[key] ? 'ON' : 'OFF' }}
        </button>
      </div>
    </div>

    <div class="session-stats">
      <div class="section-title">Session</div>
      <div class="risk-row" v-for="sym in ['BTCUSD', 'XAUUSD']" :key="sym">
        <span>{{ sym }}</span>
        <span>{{ store.sessionStats[sym]?.trades || 0 }}T / {{ store.sessionStats[sym]?.signals || 0 }}S</span>
      </div>
    </div>

    <div class="ist-clock">
      <span class="clock-label">IST</span>
      <span class="clock-time">{{ istTime }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useTerminalStore } from '../store/terminal_state.js'

const store = useTerminalStore()
const istTime = ref('')
let clockInterval = null

const stratMap = {
  'Momentum': 'Momentum',
  'Trap Sweep': 'Trap',
  'Wick Thief': 'WickThief',
  'Compression': 'Compression',
  'Flow Reversal': 'FlowReversal'
}

function formatPrice(p) { return p ? p.toFixed(2) : '0.00' }
function setMode(mode) { store.sendCommand('/api/mode', { mode }) }
function updateConfig(key, value) { store.sendCommand('/api/config', { [key]: value }) }
function toggleStrat(key) { store.sendCommand('/api/strategy', { name: key, enabled: !store.strategyStates[key] }) }

function updateClock() {
  istTime.value = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  })
}

onMounted(() => {
  updateClock()
  clockInterval = setInterval(updateClock, 1000)
})

onUnmounted(() => clearInterval(clockInterval))
</script>

<style scoped>
.dashboard-hud { display: flex; flex-direction: column; gap: 10px; }

.section-title { font-size: 8px; color: #444; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 4px; }

.metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.metric { background: #111827; padding: 6px 8px; border-radius: 3px; }
.metric-label { font-size: 7px; color: #555; text-transform: uppercase; letter-spacing: 1px; display: block; }
.metric-value { font-size: 13px; font-weight: 700; color: #e1e4e8; }
.metric-value.green { color: #00ff88; }
.metric-value.red { color: #ff5252; }

.price-ticker { display: flex; flex-direction: column; gap: 3px; }
.ticker-row { display: flex; align-items: center; gap: 6px; padding: 5px 7px; background: #111827; border-radius: 3px; }
.ticker-sym { font-size: 9px; font-weight: 700; color: #888; min-width: 45px; }
.ticker-price { font-size: 12px; font-weight: 700; color: #e1e4e8; flex: 1; }
.stream-dot { width: 4px; height: 4px; border-radius: 50%; }
.stream-dot.live { background: #00ff88; box-shadow: 0 0 4px #00ff88; }
.stream-dot.down { background: #ff5252; }

.ticker-sub { display: flex; gap: 3px; padding: 0 4px; }
.ticker-obi, .ticker-flow { font-size: 7px; padding: 1px 4px; border-radius: 2px; background: #1c2333; color: #555; }
.ticker-obi.bull { color: #00ff88; }
.ticker-obi.bear { color: #ff5252; }
.ticker-flow.buy { color: #00ff88; }
.ticker-flow.sell { color: #ff5252; }
.spike-badge { font-size: 7px; padding: 1px 4px; border-radius: 2px; background: #ffa726; color: #000; font-weight: 700; }
.breaker-badge { font-size: 7px; padding: 1px 4px; border-radius: 2px; background: #ff5252; color: #fff; font-weight: 700; }

.binance-info { border-top: 1px solid #2e2a0a; padding-top: 6px; margin-top: 6px; }
.binance-info .section-title { font-size: 9px; color: #f0b90b; margin-bottom: 4px; }

.mode-toggle { display: flex; gap: 3px; }
.mode-toggle button {
  flex: 1; padding: 5px; border: 1px solid #2d3748; background: #1c2333;
  color: #888; font-size: 9px; font-family: inherit; font-weight: 700;
  cursor: pointer; border-radius: 2px; transition: all 0.15s;
}
.mode-toggle button.active { border-color: #4fc3f7; color: #4fc3f7; background: #1a1a2e; }
.mode-toggle button.active:last-child { border-color: #ff5252; color: #ff5252; background: #2e1a1a; }
.mode-toggle button:disabled { opacity: 0.4; cursor: not-allowed; }
.binance-warning { font-size: 8px; color: #ff5252; margin-top: 3px; padding: 2px 4px; background: #2e1a1a; border-radius: 2px; }

.sim-controls { display: flex; flex-direction: column; gap: 4px; }
.slider-row { display: flex; flex-direction: column; gap: 2px; }
.slider-row label { font-size: 8px; color: #888; }
.slider-row input[type="range"] { width: 100%; height: 2px; -webkit-appearance: none; background: #1c2333; border-radius: 1px; outline: none; }
.slider-row input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 8px; height: 8px; border-radius: 50%; background: #4fc3f7; cursor: pointer; }

.risk-info, .session-stats { display: flex; flex-direction: column; gap: 2px; }
.risk-row { display: flex; justify-content: space-between; font-size: 9px; color: #888; padding: 1px 0; }

.strategies-status { display: flex; flex-direction: column; gap: 3px; }
.strat-row { display: flex; align-items: center; gap: 5px; }
.strat-dot { width: 4px; height: 4px; border-radius: 50%; }
.strat-dot.on { background: #00ff88; }
.strat-dot.off { background: #ff5252; }
.strat-label { font-size: 9px; color: #888; flex: 1; }
.strat-toggle {
  font-size: 7px; padding: 1px 5px; border: 1px solid #2d3748; background: #1c2333;
  color: #888; font-family: inherit; cursor: pointer; border-radius: 2px;
}
.strat-toggle:hover { border-color: #4fc3f7; }

.ist-clock {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 7px; background: #111827; border-radius: 3px; margin-top: 4px;
}
.clock-label { font-size: 8px; color: #4fc3f7; font-weight: 700; letter-spacing: 1px; }
.clock-time { font-size: 12px; font-weight: 700; color: #e1e4e8; font-variant-numeric: tabular-nums; }

@media (max-width: 768px) {
  .dashboard-hud {
    padding: 8px;
    gap: 12px;
  }

  .metric-grid {
    grid-template-columns: 1fr;
  }

  .metric {
    padding: 10px 12px;
  }

  .metric-label {
    font-size: 11px;
  }

  .metric-value {
    font-size: 14px;
  }

  .section-title {
    font-size: 11px;
  }

  .mode-toggle button,
  .strat-toggle {
    min-height: 44px;
    min-width: 44px;
    font-size: 11px;
  }

  .slider-row input[type="range"] {
    height: 4px;
  }

  .slider-row input[type="range"]::-webkit-slider-thumb {
    width: 16px;
    height: 16px;
  }

  .risk-row,
  .strat-label {
    font-size: 11px;
  }

  .ticker-sym {
    font-size: 11px;
  }

  .ticker-price {
    font-size: 13px;
  }

  .ticker-obi,
  .ticker-flow,
  .spike-badge,
  .breaker-badge {
    font-size: 9px;
    padding: 3px 6px;
  }

  .clock-label,
  .clock-time {
    font-size: 13px;
  }

  .binance-warning {
    font-size: 11px;
    padding: 6px 8px;
  }
}
</style>
