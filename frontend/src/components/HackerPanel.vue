<template>
  <div class="hacker-panel">
    <div class="section-title">Hacker Tools</div>

    <div class="tool-grid">
      <div class="tool-card" v-for="tool in tools" :key="tool.name">
        <div class="tool-header">
          <span class="tool-icon">{{ tool.icon }}</span>
          <span class="tool-name">{{ tool.name }}</span>
        </div>
        <div class="tool-value" :class="tool.class">{{ tool.value }}</div>
        <div class="tool-desc">{{ tool.desc }}</div>
      </div>
    </div>

    <div class="walls-section">
      <div class="section-title">Institutional Walls</div>
      <div class="wall-row" v-for="wall in currentWalls.bidWalls?.slice(0, 3)" :key="wall.price">
        <span class="wall-dir buy">BID</span>
        <span class="wall-price">{{ wall.price?.toFixed(2) }}</span>
        <span class="wall-vol">{{ wall.volume?.toFixed(1) }}</span>
        <span class="wall-ratio">{{ wall.ratio?.toFixed(1) }}x avg</span>
      </div>
      <div class="wall-row" v-for="wall in currentWalls.askWalls?.slice(0, 3)" :key="wall.price">
        <span class="wall-dir sell">ASK</span>
        <span class="wall-price">{{ wall.price?.toFixed(2) }}</span>
        <span class="wall-vol">{{ wall.volume?.toFixed(1) }}</span>
        <span class="wall-ratio">{{ wall.ratio?.toFixed(1) }}x avg</span>
      </div>
      <div v-if="!currentWalls.bidWalls?.length && !currentWalls.askWalls?.length" class="no-walls">
        No walls detected
      </div>
    </div>

    <div class="last-signal" v-if="lastSignal?.signal">
      <div class="section-title">Last Signal</div>
      <div class="signal-card" :class="lastSignal.direction?.toLowerCase()">
        <span class="sig-tag">{{ lastSignal.tag }}</span>
        <span class="sig-dir">{{ lastSignal.direction }}</span>
        <span class="sig-score">{{ lastSignal.score?.toFixed(2) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useTerminalStore } from '../store/terminal_state.js'

const props = defineProps({ symbol: { type: String, default: 'BTCUSD' } })
const store = useTerminalStore()

const currentWalls = computed(() => {
  return store.orderBooks[props.symbol]?.walls || { bidWalls: [], askWalls: [] }
})

const lastSignal = computed(() => {
  return null
})

const tools = computed(() => {
  const obi = store.orderBooks[props.symbol]?.obi || 0
  const tickFlow = store.tickFlows[props.symbol] || {}
  const volSpike = store.volumeSpikes[props.symbol] || {}
  const breaker = store.volatilityBreakers[props.symbol] || false
  const liveCandle = store.liveCandles[props.symbol]

  return [
    {
      icon: 'OB', name: 'Order Book Imbalance',
      value: obi.toFixed(4),
      class: obi > 0.1 ? 'bull' : obi < -0.1 ? 'bear' : 'neutral',
      desc: obi > 0.3 ? 'Strong buying pressure' : obi < -0.3 ? 'Strong selling pressure' : 'Balanced book'
    },
    {
      icon: 'TF', name: 'Tick Flow Pressure',
      value: tickFlow.pressure || '---',
      class: tickFlow.pressure === 'BUY' ? 'bull' : tickFlow.pressure === 'SELL' ? 'bear' : 'neutral',
      desc: `Buy ratio: ${((tickFlow.buyRatio || 0.5) * 100).toFixed(0)}%`
    },
    {
      icon: 'VS', name: 'Volume Spike',
      value: volSpike.isSpike ? `${volSpike.ratio?.toFixed(1)}x` : 'Normal',
      class: volSpike.isSpike ? 'warn' : 'neutral',
      desc: volSpike.isSpike ? 'Institutional volume detected' : 'No unusual volume'
    },
    {
      icon: 'VB', name: 'Volatility Breaker',
      value: breaker ? 'ACTIVE' : 'OFF',
      class: breaker ? 'danger' : 'neutral',
      desc: breaker ? 'Trading paused — extreme volatility' : 'Normal volatility range'
    },
    {
      icon: 'DL', name: 'Delta (Live)',
      value: liveCandle?.volumeDelta?.toFixed(2) || '0',
      class: (liveCandle?.volumeDelta || 0) > 0 ? 'bull' : 'bear',
      desc: 'Buy volume - Sell volume'
    },
    {
      icon: 'TC', name: 'Tick Count',
      value: liveCandle?.tickCount || '0',
      class: 'neutral',
      desc: 'Ticks in current candle'
    }
  ]
})
</script>

<style scoped>
.hacker-panel { display: flex; flex-direction: column; gap: 10px; }
.section-title { font-size: 9px; color: #444; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 4px; }

.tool-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }

.tool-card {
  background: #0d1117; border: 1px solid #1c2333; border-radius: 4px;
  padding: 6px; display: flex; flex-direction: column; gap: 2px;
}
.tool-header { display: flex; align-items: center; gap: 4px; }
.tool-icon {
  font-size: 8px; font-weight: 700; color: #000; background: #4fc3f7;
  padding: 1px 3px; border-radius: 2px;
}
.tool-name { font-size: 8px; color: #555; }
.tool-value { font-size: 12px; font-weight: 700; color: #888; }
.tool-desc { font-size: 7px; color: #444; line-height: 1.3; }

.tool-value.bull { color: #00ff88; }
.tool-value.bear { color: #ff5252; }
.tool-value.neutral { color: #888; }
.tool-value.warn { color: #ffa726; }
.tool-value.danger { color: #ff5252; }

.walls-section { display: flex; flex-direction: column; gap: 4px; }
.wall-row {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 6px; background: #0d1117; border-radius: 3px;
  font-size: 9px;
}
.wall-dir { font-weight: 700; padding: 1px 4px; border-radius: 2px; font-size: 8px; }
.wall-dir.buy { background: #0d2818; color: #00ff88; }
.wall-dir.sell { background: #2e1a1a; color: #ff5252; }
.wall-price { color: #e1e4e8; flex: 1; }
.wall-vol { color: #888; }
.wall-ratio { color: #555; font-size: 8px; }
.no-walls { font-size: 9px; color: #333; text-align: center; padding: 8px; }

.signal-card {
  display: flex; gap: 6px; align-items: center;
  padding: 6px 8px; background: #0d1117; border-radius: 4px;
}
.signal-card.buy { border-left: 3px solid #00ff88; }
.signal-card.sell { border-left: 3px solid #ff5252; }
.sig-tag { font-size: 9px; font-weight: 700; color: #4fc3f7; }
.sig-dir { font-size: 10px; font-weight: 700; color: #e1e4e8; }
.sig-score { font-size: 10px; color: #888; margin-left: auto; }
</style>
