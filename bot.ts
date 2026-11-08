import { ethers } from 'ethers';
import axios from 'axios';
import dotenv from 'dotenv';
import * as fs from 'fs';
import { evaluateToken } from './bot-filter';

dotenv.config();

console.log(`\n========================================`);
console.log(`🏢 JO&SNO Automated Trading Bot Starting...`);
console.log(`========================================\n`);

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

const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDC_DECIMALS = 6;
const SWAP_ROUTER_02 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
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

// Axios GET with exponential retry backoff
async function axiosGetWithRetry(url: string, retries = 3, delay = 1500): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url);
    } catch (err: any) {
      if (i === retries - 1) throw err;
      const status = err.response ? err.response.status : 'Network Error';
      console.warn(`⚠️ Request failed (${status}). Retrying in ${delay / 1000}s...`);
      await new Promise((res) => setTimeout(res, delay));
      delay *= 2;
    }
  }
}

function loadConfig() {
  const defaultConfig = {
    maxTokenPrice: 1.10,
    minBuyUSD: 1.00,
    maxBuyUSD: 1.30,
    maxGasFeeUSD: 1.00,
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
    console.log(`🔍 [JO&SNO] Scanning Uniswap verified token directory for a new unique coin...`);
    const response = await axiosGetWithRetry('https://tokens.uniswap.org/');
    const tokens = response.data.tokens;

    const ethTokens = tokens.filter((t: any) => t.chainId === 1 && t.address.toLowerCase() !== USDC_ADDRESS.toLowerCase());
    const shuffledTokens = ethTokens.sort(() => 0.5 - Math.random());
    const candidatesSlice = shuffledTokens.slice(0, 30);

    // Process tokens in batches of 15 using DexScreener API
    const chunkSize = 15;
    for (let i = 0; i < candidatesSlice.length; i += chunkSize) {
      const chunk = candidatesSlice.slice(i, i + chunkSize);
      const addresses = chunk.map((t: any) => t.address.toLowerCase()).join(',');

      try {
        const priceRes = await axiosGetWithRetry(`https://api.dexscreener.com/latest/dex/tokens/${addresses}`);
        const pairs = priceRes.data.pairs || [];

        // Map highest liquidity price per token
        const priceMap: { [address: string]: number } = {};
        for (const pair of pairs) {
          if (pair.baseToken && pair.baseToken.address) {
            const addr = pair.baseToken.address.toLowerCase();
            const priceUsd = parseFloat(pair.priceUsd || '0');
            if (!priceMap[addr] || priceUsd > 0) {
              priceMap[addr] = priceUsd;
            }
          }
        }

        for (const t of chunk) {
          const price = priceMap[t.address.toLowerCase()] || 0;
          if (price > 0) {
            const evalResult = evaluateToken({ symbol: t.symbol, address: t.address, price });
            if (evalResult.allowed) {
              return { address: t.address, symbol: t.symbol, price };
            }
          }
        }
      } catch (err: any) {
        console.error('❌ [JO&SNO] Error fetching token prices via DexScreener:', err.message);
      }

      await new Promise((res) => setTimeout(res, 1000));
    }

    return null;
  } catch (error: any) {
    console.error('❌ [JO&SNO] Error fetching token directory:', error.message);
    return null;
  }
}

async function executeSwap(targetTokenAddress: string, targetSymbol: string, targetPrice: number, config: any) {
  try {
    const buyAmountUSD = +(config.minBuyUSD + Math.random() * (config.maxBuyUSD - config.minBuyUSD)).toFixed(2);
    const amountInUnits = ethers.parseUnits(buyAmountUSD.toString(), USDC_DECIMALS);

    const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);
    const usdcBalance = await usdcContract.balanceOf(wallet.address);
    if (usdcBalance < amountInUnits) {
      console.error(`❌ [JO&SNO] Insufficient USDC balance.`);
      return;
    }

    const routerContract = new ethers.Contract(SWAP_ROUTER_02, ROUTER_ABI, wallet);

    const feeTiers = [3000, 500, 10000];
    let selectedParams: any = null;
    let estimatedGasCostUSD = 0;

    let ethPriceUSD = 3000;
    try {
      const ethPriceRes = await axiosGetWithRetry('https://api.dexscreener.com/latest/dex/tokens/0xc02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
      if (ethPriceRes.data.pairs && ethPriceRes.data.pairs[0]) {
        ethPriceUSD = parseFloat(ethPriceRes.data.pairs[0].priceUsd) || 3000;
      }
    } catch (e) {}

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('20', 'gwei');

    for (const fee of feeTiers) {
      try {
        const params = {
          tokenIn: USDC_ADDRESS,
          tokenOut: targetTokenAddress,
          fee: fee,
          recipient: wallet.address,
          amountIn: amountInUnits,
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0
        };

        const gasEstimate = await routerContract.exactInputSingle.estimateGas(params);
        const totalGasWei = gasEstimate * gasPrice;
        const totalGasETH = parseFloat(ethers.formatEther(totalGasWei));
        estimatedGasCostUSD = totalGasETH * ethPriceUSD;

        if (estimatedGasCostUSD <= config.maxGasFeeUSD) {
          selectedParams = params;
          break;
        }
      } catch (e) {}
    }

    if (!selectedParams) {
      console.log(`❌ [JO&SNO] Skipping trade for ${targetSymbol}: Gas cost exceeds max limit ($${config.maxGasFeeUSD}).`);
      return;
    }

    console.log(`🚀 [JO&SNO] Executing trade: Buying ~$${buyAmountUSD} of ${targetSymbol} (Gas fee: ~$${estimatedGasCostUSD.toFixed(2)})...`);

    const allowance = await usdcContract.allowance(wallet.address, SWAP_ROUTER_02);
    if (allowance < amountInUnits) {
      const approveTx = await usdcContract.approve(SWAP_ROUTER_02, ethers.MaxUint256);
      await approveTx.wait();
    }

    const tx = await routerContract.exactInputSingle(selectedParams, { gasLimit: 300000 });
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

runTradingCycle();
setInterval(runTradingCycle, 60 * 60 * 1000);