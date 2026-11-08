import * as fs from 'fs';

interface BotConfig {
  maxTokenPrice: number;
  minBuyUSD: number;
  maxBuyUSD: number;
  maxGasFeeUSD: number;
  minOrganicScore: number;
  excludeMemecoins: boolean;
  excludeDuplicates: boolean;
  excludeStablecoins: boolean;
  stablecoinMinPrice: number;
  stablecoinMaxPrice: number;
}

interface TokenCandidate {
  symbol: string;
  address: string;
  price: number;
}

interface HistoryRecord {
  timestamp: string;
  symbol: string;
  address: string;
  amountUSD: number;
  price: number;
  txid: string;
  status: string;
}

export function evaluateToken(token: TokenCandidate): { allowed: boolean; reason?: string } {
  const config: BotConfig = JSON.parse(fs.readFileSync('bot-config.json', 'utf-8'));

  // 1. Price Upper Bound Check ($1.10 limit)
  if (token.price > config.maxTokenPrice) {
    return { allowed: false, reason: `Price $${token.price} exceeds max limit of $${config.maxTokenPrice}` };
  }

  // 2. Stablecoin Filter (Blocks assets pegged around $1.00)
  if (config.excludeStablecoins) {
    if (token.price >= config.stablecoinMinPrice && token.price <= config.stablecoinMaxPrice) {
      return { allowed: false, reason: `Blocked stablecoin: ${token.symbol} at $${token.price}` };
    }
  }

  // 3. Duplicate Filter (Guarantees the bot never buys the same coin twice from history)[cite: 1, 4, 5]
  if (config.excludeDuplicates) {
    try {
      if (fs.existsSync('bot-history.json')) {
        const history: HistoryRecord[] = JSON.parse(fs.readFileSync('bot-history.json', 'utf-8'));
        const isDuplicate = history.some(record => record.address.toLowerCase() === token.address.toLowerCase());
        if (isDuplicate) {
          return { allowed: false, reason: `Blocked duplicate token already in portfolio: ${token.symbol}` };
        }
      }
    } catch (error) {
      console.warn('Warning: Could not read bot-history.json for duplicate validation.', error);
    }
  }

  return { allowed: true };
}