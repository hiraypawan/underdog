const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'local_ledger.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_positions (
      ticket INTEGER PRIMARY KEY,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      lots REAL NOT NULL,
      open_price REAL NOT NULL,
      sl REAL DEFAULT 0,
      tp REAL DEFAULT 0,
      comment TEXT DEFAULT '',
      open_time TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'OPEN'
    );

    CREATE TABLE IF NOT EXISTS trade_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      lots REAL NOT NULL,
      open_price REAL NOT NULL,
      close_price REAL,
      pnl REAL DEFAULT 0,
      open_time TEXT,
      close_time TEXT DEFAULT (datetime('now')),
      comment TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const defaultSettings = {
    simulated_spread_points: '100',
    simulated_slippage_points: '10',
    mode: 'DEMO',
    balance: '10000.0',
    daily_pnl: '0.0',
    consecutive_losses: '0'
  };

  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaultSettings)) {
    insert.run(k, v);
  }
}

function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

function getBalance() {
  const val = parseFloat(getSetting('balance') || '10000.0');
  if (isNaN(val) || val <= 0) return 10000.0;
  if (val > 1000000) return 10000.0;
  return val;
}

function setBalance(val) {
  setSetting('balance', val);
}

function insertPosition(ticket, symbol, direction, lots, openPrice, sl, tp, comment) {
  getDb().prepare(`
    INSERT INTO local_positions (ticket, symbol, direction, lots, open_price, sl, tp, comment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(ticket, symbol, direction, lots, openPrice, sl, tp, comment || '');
}

function getOpenPositions() {
  return getDb().prepare('SELECT * FROM local_positions WHERE status = ?').all('OPEN');
}

function getOpenPositionByTicket(ticket) {
  return getDb().prepare('SELECT * FROM local_positions WHERE ticket = ? AND status = ?').get(ticket, 'OPEN');
}

function updatePositionSL(ticket, newSL) {
  getDb().prepare('UPDATE local_positions SET sl = ? WHERE ticket = ?').run(newSL, ticket);
}

function closePosition(ticket, closePrice, pnl) {
  const pos = getOpenPositionByTicket(ticket);
  if (!pos) return;

  const safePnl = parseFloat(pnl) || 0;
  const safeClosePrice = parseFloat(closePrice) || 0;

  getDb().prepare('UPDATE local_positions SET status = ? WHERE ticket = ?').run('CLOSED', ticket);

  getDb().prepare(`
    INSERT INTO trade_history (ticket, symbol, direction, lots, open_price, close_price, pnl, open_time, comment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(pos.ticket, pos.symbol, pos.direction, pos.lots, pos.open_price, safeClosePrice, safePnl, pos.open_time, pos.comment);

  const newBalance = getBalance() + safePnl;
  setBalance(newBalance);

  if (safePnl < 0) {
    setSetting('consecutive_losses', String(parseInt(getSetting('consecutive_losses') || '0') + 1));
  } else {
    setSetting('consecutive_losses', '0');
  }

  const dailyPnl = parseFloat(getSetting('daily_pnl') || '0') + safePnl;
  setSetting('daily_pnl', String(dailyPnl));
}

function getTradeHistory(limit = 50) {
  return getDb().prepare('SELECT * FROM trade_history ORDER BY id DESC LIMIT ?').all(limit);
}

function getStats() {
  const trades = getDb().prepare('SELECT * FROM trade_history').all();
  const wins = trades.filter(t => parseFloat(t.pnl) > 0).length;
  const losses = trades.filter(t => parseFloat(t.pnl) < 0).length;
  const total = trades.length;
  const winRate = total > 0 ? (wins / total) * 100 : 0;
  const totalPnl = trades.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);
  return { total, wins, losses, winRate: winRate.toFixed(1), totalPnl: totalPnl.toFixed(2) };
}

function resetDaily() {
  setSetting('daily_pnl', '0.0');
  setSetting('consecutive_losses', '0');
}

module.exports = {
  getDb, getSetting, setSetting, getBalance, setBalance,
  insertPosition, getOpenPositions, getOpenPositionByTicket,
  updatePositionSL, closePosition, getTradeHistory, getStats, resetDaily
};
