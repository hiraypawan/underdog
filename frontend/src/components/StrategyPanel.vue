<template>
  <div class="strategy-panel">
    <div class="section-title">Strategies</div>

    <div class="strategy-list">
      <div
        v-for="(strat, key) in strategies"
        :key="key"
        class="strategy-item"
        :class="{ active: store.strategyStates[key] }"
      >
        <div class="strat-header">
          <label class="toggle">
            <input type="checkbox" :checked="store.strategyStates[key]" @change="toggleStrategy(key)" />
            <span class="toggle-slider"></span>
          </label>
          <div class="strat-info">
            <span class="strat-name">{{ strat.name }}</span>
            <span class="strat-tag">{{ strat.tag }}</span>
          </div>
          <span class="strat-status" :class="store.strategyStates[key] ? 'armed' : 'off'">
            {{ store.strategyStates[key] ? 'ARMED' : 'OFF' }}
          </span>
        </div>
        <div class="strat-desc">{{ strat.desc }}</div>
      </div>
    </div>

    <div class="atr-display">
      <div class="section-title">ATR (14)</div>
      <div class="atr-values">
        <div class="atr-row">
          <span>BTCUSD:</span>
          <span>{{ atrValues.BTCUSD }}</span>
        </div>
        <div class="atr-row">
          <span>XAUUSD:</span>
          <span>{{ atrValues.XAUUSD }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useTerminalStore } from '../store/terminal_state.js'

const store = useTerminalStore()

const strategies = {
  UseMomentum: {
    name: 'Momentum Explosion',
    tag: 'MOM',
    desc: 'Detects explosive body expansion with aligned volume delta for high-velocity continuation trades.'
  },
  UseTrap: {
    name: 'Liquidity Sweep Trap',
    tag: 'TRAP',
    desc: 'Identifies institutional wicks that sweep local range highs/lows before reversing sharply.'
  },
  UseWickThief: {
    name: 'Wick Thief',
    tag: 'WICK',
    desc: 'Fades excessive wick extensions that exceed ATR thresholds, targeting structural exhaustion.'
  },
  UseCompression: {
    name: 'Compression Exploder',
    tag: 'COMP',
    desc: 'Detects low-volatility coils and trades breakouts when price escapes the compression zone.'
  }
}

const atrValues = computed(() => ({
  BTCUSD: 'N/A',
  XAUUSD: 'N/A'
}))

function toggleStrategy(key) {
  const newVal = !store.strategyStates[key]
  store.sendCommand('/api/strategy', { name: key, enabled: newVal })
}
</script>

<style scoped>
.strategy-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-title {
  font-size: 10px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 4px;
}

.strategy-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.strategy-item {
  background: #111827;
  border-radius: 6px;
  padding: 10px;
  border: 1px solid #1c2333;
  transition: all 0.2s;
}

.strategy-item.active {
  border-color: #00ff8833;
}

.strat-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle {
  position: relative;
  width: 32px;
  height: 16px;
  cursor: pointer;
}

.toggle input { opacity: 0; width: 0; height: 0; }

.toggle-slider {
  position: absolute;
  inset: 0;
  background: #2d3748;
  border-radius: 8px;
  transition: 0.2s;
}

.toggle-slider::before {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  left: 2px;
  bottom: 2px;
  background: #555;
  border-radius: 50%;
  transition: 0.2s;
}

.toggle input:checked + .toggle-slider {
  background: #0d2818;
}

.toggle input:checked + .toggle-slider::before {
  background: #00ff88;
  transform: translateX(16px);
}

.strat-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.strat-name {
  font-size: 11px;
  font-weight: 700;
  color: #e1e4e8;
}

.strat-tag {
  font-size: 9px;
  color: #555;
}

.strat-status {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
}

.strat-status.armed {
  color: #00ff88;
  background: #0d2818;
}

.strat-status.off {
  color: #555;
  background: #1c2333;
}

.strat-desc {
  font-size: 9px;
  color: #555;
  margin-top: 6px;
  line-height: 1.4;
}

.atr-display {
  background: #111827;
  border-radius: 6px;
  padding: 10px;
}

.atr-values {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.atr-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #888;
}
</style>
