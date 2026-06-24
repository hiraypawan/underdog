<template>
  <div class="position-panel">
    <div class="pos-header">
      <span class="section-title">Positions</span>
      <span class="pos-count">{{ store.positions.length }}</span>
    </div>

    <div class="pos-list">
      <div v-if="store.positions.length === 0" class="no-positions">No open positions</div>
      <div v-for="pos in store.positions" :key="pos.ticket" class="pos-card" :class="pos.direction.toLowerCase()">
        <div class="pos-top">
          <span class="pos-dir">{{ pos.direction }}</span>
          <span class="pos-sym">{{ pos.symbol }}</span>
          <span class="pos-pnl" :class="getPnL(pos) >= 0 ? 'up' : 'dn'">
            {{ getPnL(pos) >= 0 ? '+' : '' }}{{ formatPnL(pos) }}
          </span>
          <button class="pos-close" @click="closePos(pos.ticket)">X</button>
        </div>
        <div class="pos-grid">
          <div class="pos-cell"><span class="lbl">Entry</span><span class="val">{{ pos.open_price?.toFixed(2) }}</span></div>
          <div class="pos-cell"><span class="lbl">SL</span><span class="val sl">{{ pos.sl?.toFixed(2) }}</span></div>
          <div class="pos-cell"><span class="lbl">Size</span><span class="val">{{ pos.lots }}</span></div>
          <div class="pos-cell"><span class="lbl">Tag</span><span class="val tag">{{ pos.comment || '-' }}</span></div>
        </div>
      </div>
    </div>

    <div class="stats-bar" v-if="store.stats.total > 0">
      <div class="stat"><span class="stat-lbl">Trades</span><span class="stat-val">{{ store.stats.total }}</span></div>
      <div class="stat"><span class="stat-lbl">Wins</span><span class="stat-val up">{{ store.stats.wins }}</span></div>
      <div class="stat"><span class="stat-lbl">Losses</span><span class="stat-val dn">{{ store.stats.losses }}</span></div>
      <div class="stat"><span class="stat-lbl">Win%</span><span class="stat-val" :class="parseFloat(store.winRate) >= 50 ? 'up' : 'dn'">{{ store.winRate }}</span></div>
    </div>
  </div>
</template>

<script setup>
import { useTerminalStore } from '../store/terminal_state.js'
const store = useTerminalStore()

function getPnL(pos) {
  return store.livePnL[pos.ticket] || 0
}

function formatPnL(pos) {
  const pnl = getPnL(pos)
  return Math.abs(pnl) >= 1000 ? pnl.toFixed(0) : pnl.toFixed(2)
}

function closePos(ticket) {
  store.sendCommand(`/api/close/${ticket}`, {})
}
</script>

<style scoped>
.position-panel { display: flex; flex-direction: column; gap: 6px; }
.pos-header { display: flex; justify-content: space-between; align-items: center; }
.section-title { font-size: 8px; color: #444; text-transform: uppercase; letter-spacing: 1.5px; }
.pos-count { font-size: 8px; color: #555; background: #1c2333; padding: 1px 5px; border-radius: 8px; }

.pos-list { display: flex; flex-direction: column; gap: 4px; max-height: 250px; overflow-y: auto; }
.no-positions { font-size: 9px; color: #333; text-align: center; padding: 12px; }

.pos-card { background: #111827; border-radius: 3px; padding: 6px 8px; border: 1px solid #1c2333; }
.pos-card.buy { border-left: 3px solid #00ff88; }
.pos-card.sell { border-left: 3px solid #ff5252; }

.pos-top { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; }
.pos-dir { font-size: 8px; font-weight: 700; padding: 1px 4px; border-radius: 2px; }
.buy .pos-dir { background: #0d2818; color: #00ff88; }
.sell .pos-dir { background: #2e1a1a; color: #ff5252; }
.pos-sym { font-size: 9px; font-weight: 700; color: #e1e4e8; }
.pos-pnl { font-size: 10px; font-weight: 700; margin-left: auto; }
.pos-pnl.up { color: #00ff88; }
.pos-pnl.dn { color: #ff5252; }

.pos-close {
  background: none; border: 1px solid #ff525266; color: #ff5252;
  font-size: 7px; width: 16px; height: 16px; border-radius: 2px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  font-family: inherit;
}
.pos-close:hover { background: #ff5252; color: #fff; }

.pos-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 3px; }
.pos-cell { display: flex; flex-direction: column; }
.lbl { font-size: 7px; color: #444; text-transform: uppercase; }
.val { font-size: 9px; color: #aaa; font-weight: 600; }
.val.sl { color: #ffa726; }
.val.tag { color: #4fc3f7; }

.stats-bar {
  display: flex; gap: 4px; padding: 4px 0; border-top: 1px solid #1c2333;
}
.stat { flex: 1; text-align: center; }
.stat-lbl { font-size: 7px; color: #444; display: block; }
.stat-val { font-size: 9px; color: #aaa; font-weight: 600; }
.stat-val.up { color: #00ff88; }
.stat-val.dn { color: #ff5252; }

@media (max-width: 768px) {
  .position-panel {
    padding: 8px;
    gap: 10px;
  }

  .pos-header {
    margin-bottom: 4px;
  }

  .section-title {
    font-size: 11px;
  }

  .pos-count {
    font-size: 11px;
    padding: 3px 8px;
  }

  .pos-grid {
    grid-template-columns: 1fr 1fr;
  }

  .pos-cell {
    padding: 4px 0;
  }

  .lbl {
    font-size: 11px;
  }

  .val {
    font-size: 12px;
  }

  .pos-close {
    width: 44px;
    height: 44px;
    font-size: 12px;
    border-radius: 4px;
  }

  .pos-dir,
  .pos-sym {
    font-size: 11px;
  }

  .pos-pnl {
    font-size: 13px;
  }

  .stat-lbl {
    font-size: 11px;
  }

  .stat-val {
    font-size: 12px;
  }

  .no-positions {
    font-size: 12px;
    padding: 16px;
  }
}
</style>
