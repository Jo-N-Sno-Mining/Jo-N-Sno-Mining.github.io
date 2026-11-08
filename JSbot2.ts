import { ethers } from 'ethers';
import axios from 'axios';
import dotenv from 'dotenv';
import * as fs from 'fs';
import { evaluateToken } from './bot-filter';

dotenv.config();

console.log(`\n========================================`);
console.log(`🏢 JO&SNO Automated Trading Bot Starting...`);
console.log(`========================================\n`);

// 1. Setup Ethereum Provider & Wallet
const RPC_URL = process.env.ETH_RPC_URL || 'https://mainnet.infura.io/v3/YOUR_INFURA_KEY';
const provider = new ethers.JsonRpcProvider(RPC_URL);

const rawKey = process.env.WALLET_PRIVATE_KEY || '';
if (!rawKey || rawKey.includes('your_wallet')) {
  console.error("❌ ERROR: Set your actual 'WALLET_PRIVATE_KEY' in your .env file!");
  process.exit(1);
}

let wallet: ethers.Wallet;
try {
  wallet = new ethers.Wallet(rawKey.trim(), provider);
} catch (e: any) {
  console.error("❌ ERROR loading wallet from .env:", e.message || e);
  process.exit(1);
}

console.log(`🔑 JO&SNO Wallet Loaded: ${wallet.address}`);

// Constants for Ethereum Mainnet
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDC_DECIMALS = 6;
const SWAP_ROUTER_02 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'; // Uniswap V3 SwapRouter02

// Minimal ABIs
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

const ROUTER_ABI = [
  {
    "inputs": [
      {
        "components": [
          {"internalType": "address", "name": "tokenIn", "type": "address"},
          {"internalType": "address", "name": "tokenOut", "type": "address"},
          {"internalType": "uint24", "name": "fee", "type": "uint24"},
          {"internalType": "address", "name": "recipient", "type": "address"},
          {"internalType": "uint256", "name": "amountIn", "type": "uint256"},
          {"internalType": "uint256", "name": "amountOutMinimum", "type": "uint256"},
          {"internalType": "uint160", "name": "sqrtPriceLimitX96", "type": "uint160"}
        ],
        "internalType": "struct ISwapRouter.ExactInputSingleParams",
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "exactInputSingle",
    "outputs": [{"internalType": "uint256", "name": "amountOut", "type": "uint256"}],
    "stateMutability": "payable",
    "type": "function"
  }
];

function loadConfig() {
  const defaultConfig = {
    maxTokenPrice: 1.10,
    minBuyUSD: 1.00,
    maxBuyUSD: 1.30,
    minOrganicScore: 75,
    excludeMemecoins: true,
    excludeDuplicates: true,
    excludeStablecoins: true,
    stablecoinMinPrice: 0.98,
    stablecoinMaxPrice: 1.02
  };
  if (fs.existsSync('bot-config.json')) {
    try { return { ...defaultConfig, ...JSON.parse(fs.readFileSync('bot-config.json', 'utf-8')) }; } catch (e) { return defaultConfig; }
  }
  return defaultConfig;
}

interface TradeRecord {
  timestamp: string;
  symbol: string;
  address: string;
  amountUSD: number;
  price: number;
  txid: string;
  status: string;
}

function logTrade(record: TradeRecord) {
  let history: TradeRecord[] = [];
  if (fs.existsSync('bot-history.json')) {
    try { history = JSON.parse(fs.readFileSync('bot-history.json', 'utf-8')); } catch (e) { history = []; }
  }
  history.unshift(record);
  fs.writeFileSync('bot-history.json', JSON.stringify(history, null, 2));
}

async function findTargetGem(config: any): Promise<{ address: string; symbol: string; price: number } | null> {
  try {
    console.log(`🔍 [JO&SNO] Scanning Uniswap verified token directory (Max Price: $${config.maxTokenPrice})...`);
    const response = await axios.get('https://tokens.uniswap.org/');
    const tokens = response.data.tokens;

    const ethTokens = tokens.filter((t: any) => t.chainId === 1 && t.address.toLowerCase() !== USDC_ADDRESS.toLowerCase());
    
    const candidates = [];
    for (const t of ethTokens.slice(0, 40)) {
      try {
        const priceRes = await axios.get(`https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${t.address}&vs_currencies=usd`);
        const price = priceRes.data[t.address.toLowerCase()]?.usd || 0;

        if (price > 0) {
          const evalResult = evaluateToken({ symbol: t.symbol, address: t.address, price });
          if (evalResult.allowed) {
            candidates.push({ address: t.address, symbol: t.symbol, price });
          }
        }
      } catch (err) {
        // Skip token if price fetch fails
      }
    }

    if (candidates.length === 0) {
      console.log('⚠️ [JO&SNO] No eligible tokens matching filters found in this scan cycle.');
      return null;
    }

    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    return selected;
  } catch (error: any) {
    console.error('❌ [JO&SNO] Error fetching token directory:', error.message);
    return null;
  }
}

async function executeSwap(targetTokenAddress: string, targetSymbol: string, targetPrice: number, config: any) {
  try {
    const buyAmountUSD = +(config.minBuyUSD + Math.random() * (config.maxBuyUSD - config.minBuyUSD)).toFixed(2);
    const amountInUnits = ethers.parseUnits(buyAmountUSD.toString(), USDC_DECIMALS);

    console.log(`🚀 [JO&SNO] Executing Uniswap trade: Buying ~$${buyAmountUSD} of ${targetSymbol} (Price: $${targetPrice})...`);

    const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);
    const routerContract = new ethers.Contract(SWAP_ROUTER_02, ROUTER_ABI, wallet);

    const allowance = await usdcContract.allowance(wallet.address, SWAP_ROUTER_02);
    if (allowance < amountInUnits) {
      console.log("🔓 [JO&SNO] Approving USDC spending for Uniswap Router...");
      const approveTx = await usdcContract.approve(SWAP_ROUTER_02, ethers.MaxUint256);
      await approveTx.wait();
      console.log("✅ [JO&SNO] Approval confirmed.");
    }

    const params = {
      tokenIn: USDC_ADDRESS,
      tokenOut: targetTokenAddress,
      fee: 3000, 
      recipient: wallet.address,
      amountIn: amountInUnits,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0
    };

    console.log("📡 [JO&SNO] Submitting swap transaction to Ethereum network...");
    const tx = await routerContract.exactInputSingle(params, {
      gasLimit: 300000
    });

    console.log(`⏳ [JO&SNO] Transaction submitted! Hash: ${tx.hash}`);
    const receipt = await tx.wait();

    if (receipt.status === 1) {
      console.log(`🎉 [JO&SNO] SUCCESS! Swapped $${buyAmountUSD} USDC for ${targetSymbol}. TxHash: ${tx.hash}`);
      logTrade({
        timestamp: new Date().toISOString(),
        symbol: targetSymbol,
        address: targetTokenAddress,
        amountUSD: buyAmountUSD,
        price: targetPrice,
        txid: tx.hash,
        status: 'Success'
      });
    } else {
      console.error(`❌ [JO&SNO] Transaction reverted on-chain.`);
    }

  } catch (error: any) {
    console.error('❌ [JO&SNO] Swap execution failed:', error.reason || error.message);
  }
}

async function runTradingCycle() {
  console.log(`\n========================================`);
  console.log(`⏰ [JO&SNO] [${new Date().toISOString()}] Executing trade cycle...`);

  const config = loadConfig();
  const gem = await findTargetGem(config);

  if (gem) {
    console.log(`🎯 [JO&SNO] Target Selected: ${gem.symbol} at $${gem.price}`);
    await executeSwap(gem.address, gem.symbol, gem.price, config);
  } else {
    console.log('Skipping trade this cycle. Retrying next hour.');
  }
}

// 1. INITIATE TRADE IMMEDIATELY ON LOAD
runTradingCycle();

// 2. REPEAT EVERY 1 HOUR UNTIL FUNDS RUN OUT
setInterval(runTradingCycle, 60 * 60 * 1000);