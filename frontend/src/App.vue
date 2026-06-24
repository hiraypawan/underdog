<template>
  <div class="terminal">
    <header class="top-bar">
      <div class="brand">
        <span class="logo">&#9650;</span>
        <span class="title">UNDERDOG QUANT TERMINAL</span>
        <span class="version">v1.0.0</span>
      </div>
      <div class="status-bar">
        <div class="connection" :class="{ online: store.connected }">
          <span class="dot"></span>{{ store.connected ? 'CONNECTED' : 'OFFLINE' }}
        </div>
        <div class="stream-status">
          <span class="stream-tag" :class="{ active: store.streamStatus.BTCUSD }">BTC {{ store.streamStatus.BTCUSD ? 'LIVE' : 'DOWN' }}</span>
          <span class="stream-tag" :class="{ active: store.streamStatus.XAUUSD }">XAU {{ store.streamStatus.XAUUSD ? 'LIVE' : 'DOWN' }}</span>
        </div>
        <div v-if="store.binanceStatus.connected" class="binance-tag connected">
          BINANCE {{ store.binanceStatus.mode || 'TESTNET' }}
        </div>
        <div v-else class="binance-tag disconnected">
          BINANCE OFFLINE
        </div>
        <div class="mode-badge" :class="store.mode.toLowerCase()">
          {{ store.mode }} MODE
        </div>
      </div>
    </header>

    <!-- Desktop layout -->
    <div class="main-grid desktop-only">
      <aside class="left-panel">
        <DashboardHUD />
      </aside>

      <main class="center-panel">
        <div class="chart-tabs">
          <button
            v-for="sym in ['BTCUSD', 'XAUUSD']"
            :key="sym"
            :class="{ active: activeSymbol === sym }"
            @click="activeSymbol = sym"
          >{{ sym }}</button>
        </div>
        <OrderFlowChart :symbol="activeSymbol" />
      </main>

      <aside class="right-panel">
        <div class="right-top">
          <PositionPanel />
        </div>
        <div class="right-bottom">
          <div class="trade-log">
            <div class="log-header">
              <span class="log-title">Trade Log</span>
              <span class="log-count">{{ store.tradeLog.length }}</span>
            </div>
            <div class="log-entries">
              <div v-for="entry in store.tradeLog" :key="entry._id" class="log-entry" :class="logClass(entry)">
                <span class="log-time">{{ entry.time }}</span>
                <span class="log-action" :class="logClass(entry)">{{ entry.action }}</span>
                <span class="log-detail">{{ logDetail(entry) }}</span>
              </div>
              <div v-if="store.tradeLog.length === 0" class="no-data">Waiting for trades...</div>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- Mobile layout -->
    <div class="mobile-layout mobile-only">
      <!-- Chart tab content -->
      <div v-if="mobileTab === 'chart'" class="mobile-tab-content">
        <div class="chart-tabs">
          <button
            v-for="sym in ['BTCUSD', 'XAUUSD']"
            :key="sym"
            :class="{ active: activeSymbol === sym }"
            @click="activeSymbol = sym"
          >{{ sym }}</button>
        </div>
        <div class="chart-container">
          <OrderFlowChart :symbol="activeSymbol" />
        </div>
      </div>

      <!-- Dashboard tab content -->
      <div v-if="mobileTab === 'dashboard'" class="mobile-tab-content">
        <DashboardHUD />
      </div>

      <!-- Positions tab content -->
      <div v-if="mobileTab === 'positions'" class="mobile-tab-content">
        <PositionPanel />
      </div>

      <!-- Log tab content -->
      <div v-if="mobileTab === 'log'" class="mobile-tab-content">
        <div class="trade-log">
          <div class="log-header">
            <span class="log-title">Trade Log</span>
            <span class="log-count">{{ store.tradeLog.length }}</span>
          </div>
          <div class="log-entries">
            <div v-for="entry in store.tradeLog" :key="entry._id" class="log-entry" :class="logClass(entry)">
              <span class="log-time">{{ entry.time }}</span>
              <span class="log-action" :class="logClass(entry)">{{ entry.action }}</span>
              <span class="log-detail">{{ logDetail(entry) }}</span>
            </div>
            <div v-if="store.tradeLog.length === 0" class="no-data">Waiting for trades...</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Mobile bottom navigation -->
    <nav class="bottom-nav mobile-only">
      <button
        class="nav-tab"
        :class="{ active: mobileTab === 'chart' }"
        @click="mobileTab = 'chart'"
      >
        <span class="nav-icon">&#9650;</span>
        <span class="nav-label">Chart</span>
      </button>
      <button
        class="nav-tab"
        :class="{ active: mobileTab === 'dashboard' }"
        @click="mobileTab = 'dashboard'"
      >
        <span class="nav-icon">&#9632;</span>
        <span class="nav-label">Dashboard</span>
      </button>
      <button
        class="nav-tab"
        :class="{ active: mobileTab === 'positions' }"
        @click="mobileTab = 'positions'"
      >
        <span class="nav-icon">&#9654;</span>
        <span class="nav-label">Positions</span>
      </button>
      <button
        class="nav-tab"
        :class="{ active: mobileTab === 'log' }"
        @click="mobileTab = 'log'"
      >
        <span class="nav-icon">&#9776;</span>
        <span class="nav-label">Log</span>
      </button>
    </nav>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useTerminalStore } from './store/terminal_state.js'
import DashboardHUD from './components/DashboardHUD.vue'
import OrderFlowChart from './components/OrderFlowChart.vue'
import PositionPanel from './components/PositionPanel.vue'

const store = useTerminalStore()
const activeSymbol = ref('BTCUSD')
const mobileTab = ref('chart')
let pollInterval = null

onMounted(() => {
  store.connect()
  pollInterval = setInterval(() => store.refreshPositions(), 3000)
})

onUnmounted(() => {
  clearInterval(pollInterval)
})

function logClass(entry) {
  return entry.action?.toLowerCase().replace('_', '-')
}

function logDetail(e) {
  if (e.action === 'OPENED') return `${e.symbol} ${e.direction} ${e.lots || ''} @${e.price} SL:${e.sl || '0'} [${e.tag || ''}]`
  if (e.action === 'CLOSED') return `${e.symbol} ${e.direction || ''} PnL:$${e.pnl || '0.00'} (${e.reason || ''})`
  if (e.action === 'SL_MOVE') return `#${e.ticket} SL:${e.newSL} ${e.reason}`
  if (e.action === 'VOL_SPIKE') return `${e.symbol} ${e.ratio}`
  if (e.action === 'VOL_BREAK') return `${e.symbol} score:${e.score}`
  return `${e.symbol || ''} ${e.direction || ''} ${e.tag || ''}`
}
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  background: #0a0e17;
  color: #e1e4e8;
  font-family: 'JetBrains Mono', 'Segoe UI', monospace;
  overflow: hidden;
  -webkit-text-size-adjust: 100%;
  -webkit-tap-highlight-color: transparent;
}

#app {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.terminal {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}

/* ==================== TOP BAR ==================== */
.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 16px;
  background: #0d1117;
  border-bottom: 1px solid #1c2333;
  height: 40px;
  flex-shrink: 0;
}

.brand { display: flex; align-items: center; gap: 10px; }
.logo { color: #00ff88; font-size: 16px; }
.title { font-weight: 700; font-size: 12px; letter-spacing: 2px; color: #00ff88; }
.version { font-size: 9px; color: #444; }

.status-bar { display: flex; align-items: center; gap: 12px; }

.connection { display: flex; align-items: center; gap: 5px; font-size: 10px; color: #ff4444; }
.connection.online { color: #00ff88; }
.dot { width: 5px; height: 5px; border-radius: 50%; background: #ff4444; }
.connection.online .dot { background: #00ff88; box-shadow: 0 0 5px #00ff88; }

.stream-status { display: flex; gap: 6px; }
.stream-tag { font-size: 9px; padding: 2px 6px; border-radius: 2px; background: #1c2333; color: #555; }
.stream-tag.active { background: #0d281833; color: #00ff88; }

.mode-badge { font-size: 10px; font-weight: 700; padding: 3px 10px; border-radius: 3px; letter-spacing: 1px; }
.mode-badge.demo { background: #1a1a2e; color: #4fc3f7; border: 1px solid #4fc3f7; }
.mode-badge.real { background: #2e1a1a; color: #ff5252; border: 1px solid #ff5252; }

.binance-tag { font-size: 9px; font-weight: 700; padding: 3px 8px; border-radius: 3px; letter-spacing: 0.5px; }
.binance-tag.connected { background: #2e2a0a; color: #f0b90b; border: 1px solid #f0b90b; }
.binance-tag.disconnected { background: #1a1a1a; color: #666; border: 1px solid #333; }

/* ==================== DESKTOP GRID ==================== */
.main-grid {
  display: grid;
  grid-template-columns: 260px 1fr 280px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.left-panel {
  background: #0d1117;
  border-right: 1px solid #1c2333;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.center-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.chart-tabs {
  display: flex;
  gap: 4px;
  padding: 6px 10px;
  background: #0d1117;
  border-bottom: 1px solid #1c2333;
  flex-shrink: 0;
}

.chart-tabs button {
  background: #1c2333;
  border: 1px solid #2d3748;
  color: #888;
  padding: 5px 14px;
  font-size: 10px;
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  border-radius: 3px;
  transition: all 0.15s;
}

.chart-tabs button:hover { border-color: #4fc3f766; color: #aaa; }
.chart-tabs button.active { background: #0d281833; color: #00ff88; border-color: #00ff88; }

.right-panel {
  background: #0d1117;
  border-left: 1px solid #1c2333;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.right-top {
  max-height: 45%;
  overflow-y: auto;
  padding: 10px;
  border-bottom: 1px solid #1c2333;
}

.right-bottom {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 10px;
}

.trade-log { display: flex; flex-direction: column; height: 100%; min-height: 0; }

.log-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.log-title { font-size: 9px; color: #444; text-transform: uppercase; letter-spacing: 1.5px; }
.log-count { font-size: 9px; color: #555; background: #1c2333; padding: 1px 5px; border-radius: 8px; }

.log-entries {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 0;
}

.log-entry {
  display: flex;
  gap: 6px;
  font-size: 9px;
  padding: 3px 6px;
  border-radius: 2px;
  background: #111827;
  align-items: center;
  flex-shrink: 0;
}

.log-entry.opened { border-left: 2px solid #00ff88; }
.log-entry.closed { border-left: 2px solid #ff5252; }
.log-entry.sl-move { border-left: 2px solid #ffa726; }
.log-entry.vol-spike { border-left: 2px solid #ffa726; background: #1a150033; }
.log-entry.vol-break { border-left: 2px solid #ff5252; background: #1a000033; }

.log-time { color: #444; min-width: 55px; flex-shrink: 0; }
.log-action { font-weight: 600; min-width: 60px; flex-shrink: 0; color: #888; }
.log-action.opened { color: #00ff88; }
.log-action.closed { color: #ff5252; }
.log-action.sl-move { color: #ffa726; }
.log-detail { color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.no-data { color: #333; font-size: 10px; text-align: center; padding: 20px; }

::-webkit-scrollbar { width: 3px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #2d3748; border-radius: 2px; }

/* ==================== MOBILE LAYOUT ==================== */
.mobile-only { display: none !important; }
.desktop-only { display: grid !important; }

@media (max-width: 767px) {
  .mobile-only { display: flex !important; }
  .desktop-only { display: none !important; }

  .top-bar {
    padding: 0 10px;
    height: 44px;
    padding-top: env(safe-area-inset-top, 0);
  }

  .brand { gap: 6px; }
  .title { font-size: 10px; letter-spacing: 1px; }
  .version { display: none; }

  .status-bar { gap: 6px; }
  .stream-status { display: none; }
  .mode-badge { font-size: 8px; padding: 2px 6px; }
  .binance-tag { font-size: 8px; padding: 2px 6px; }

  .mobile-layout {
    flex: 1;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .mobile-tab-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .mobile-tab-content .chart-container {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .mobile-tab-content .chart-tabs {
    flex-shrink: 0;
    padding: 6px 10px;
    padding-bottom: calc(6px + env(safe-area-inset-bottom, 0));
  }

  .chart-tabs button {
    min-height: 44px;
    min-width: 44px;
    padding: 8px 16px;
    font-size: 12px;
  }

  .mobile-tab-content .trade-log,
  .mobile-tab-content .left-panel,
  .mobile-tab-content .right-panel {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
    padding-bottom: calc(10px + env(safe-area-inset-bottom, 0));
  }

  .mobile-tab-content .log-entry {
    padding: 6px 8px;
    min-height: 44px;
  }

  .mobile-tab-content .log-time {
    font-size: 8px;
    min-width: 45px;
  }

  .mobile-tab-content .log-action {
    font-size: 9px;
    min-width: 50px;
  }

  .mobile-tab-content .log-detail {
    font-size: 8px;
  }

  /* Bottom navigation */
  .bottom-nav {
    display: flex;
    justify-content: space-around;
    align-items: center;
    background: #0d1117;
    border-top: 1px solid #1c2333;
    padding-bottom: env(safe-area-inset-bottom, 0);
    flex-shrink: 0;
  }

  .nav-tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    background: none;
    border: none;
    color: #555;
    padding: 8px 0;
    min-height: 48px;
    min-width: 44px;
    cursor: pointer;
    transition: color 0.15s;
    font-family: inherit;
  }

  .nav-tab.active {
    color: #00ff88;
  }

  .nav-icon {
    font-size: 16px;
    line-height: 1;
  }

  .nav-label {
    font-size: 9px;
    letter-spacing: 0.5px;
  }
}

/* Extra small screens */
@media (max-width: 380px) {
  .top-bar { padding: 0 8px; height: 40px; }
  .brand { gap: 4px; }
  .title { font-size: 8px; letter-spacing: 0.5px; }
  .logo { font-size: 14px; }
  .connection { font-size: 8px; }
  .status-bar { gap: 4px; }
}
</style>
