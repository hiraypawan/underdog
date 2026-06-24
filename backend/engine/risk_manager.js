function evaluateCapitalProtection(position, currentBid, currentAsk, pipSize, riskConfig) {
  const pip = pipSize;
  const spread = currentAsk - currentBid;
  const openPrice = parseFloat(position.open_price) || 0;
  const sl = parseFloat(position.sl) || 0;

  if (position.direction === 'BUY') {
    const profitPips = (currentBid - openPrice) / pip;

    if (profitPips >= (spread / pip) + riskConfig.BE_Trigger_Pts && sl < openPrice) {
      const newSL = openPrice + (riskConfig.BE_Entry_Offset * pip);
      return { action: 'MODIFY', ticket: position.ticket, sl: newSL, reason: 'BE_TRIGGER' };
    }

    if (profitPips >= riskConfig.TrailStart_Pts) {
      const targetSL = currentBid - (riskConfig.TrailStep_Pts * pip);
      if (targetSL > sl && targetSL > openPrice) {
        return { action: 'MODIFY', ticket: position.ticket, sl: targetSL, reason: 'TRAILING_STOP' };
      }
    }
  } else if (position.direction === 'SELL') {
    const profitPips = (openPrice - currentAsk) / pip;

    if (profitPips >= (spread / pip) + riskConfig.BE_Trigger_Pts && (sl > openPrice || sl === 0)) {
      const newSL = openPrice - (riskConfig.BE_Entry_Offset * pip);
      return { action: 'MODIFY', ticket: position.ticket, sl: newSL, reason: 'BE_TRIGGER' };
    }

    if (profitPips >= riskConfig.TrailStart_Pts) {
      const targetSL = currentAsk + (riskConfig.TrailStep_Pts * pip);
      if (targetSL < sl || sl === 0) {
        return { action: 'MODIFY', ticket: position.ticket, sl: targetSL, reason: 'TRAILING_STOP' };
      }
    }
  }

  return { action: 'NONE' };
}

function checkStopLossHit(position, currentBid, currentAsk) {
  if (!position.sl || parseFloat(position.sl) === 0) return false;

  const sl = parseFloat(position.sl);
  if (position.direction === 'BUY' && parseFloat(currentBid) <= sl) {
    return true;
  }
  if (position.direction === 'SELL' && parseFloat(currentAsk) >= sl) {
    return true;
  }
  return false;
}

function calculatePnL(position, currentBid, currentAsk) {
  const openPrice = parseFloat(position.open_price) || 0;
  const lots = parseFloat(position.lots) || 0;
  if (position.direction === 'BUY') {
    return ((parseFloat(currentBid) || 0) - openPrice) * lots;
  } else {
    return (openPrice - (parseFloat(currentAsk) || 0)) * lots;
  }
}

module.exports = { evaluateCapitalProtection, checkStopLossHit, calculatePnL };
